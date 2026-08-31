/**
 * dsh-cost-gauge 宿主半身 —— 提供 DeepSeek 余额查询 + 会话花费统计 + 峰谷费率判定的 HTTP 端点。
 *
 * 浏览器半身（./client）通过同源 `/api/cost-gauge/state` 一次性拉取：
 *   - balance：DeepSeek 账户余额（官方 GET /user/balance）
 *   - cost：当前会话的 token 用量换算出的花费
 *   - rate：当前处于「标准（空闲）」还是「翻倍（高峰）」费率，以及距下一次切换的秒数
 *   - threshold：余额报警阈值
 *
 * API Key 永远只在宿主侧解析（credentials 接缝 / 环境变量），不会下发到浏览器。
 *
 * 纯 ESM、零依赖：不 import 任何运行时包，服务全部通过 ctx 注入名解析。
 */

export const name = 'cost-gauge'

/** 宿主侧需要的服务：webServer（注册 HTTP 路由）、sessions（读取当前会话）。 */
export const inject = ['webServer', 'sessions']

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
const DEFAULT_THRESHOLD = 10
const DEFAULT_REFRESH_SECONDS = 30
const BALANCE_TIMEOUT_MS = 15000

/**
 * DeepSeek 官方 2026-08-17 起生效的峰谷价（人民币 / 每百万 token）。
 * 空闲时段（标准）价格为高峰时段（翻倍）的一半。
 * 高峰时段：北京时间周一至周五 09:00–12:00、14:00–18:00；
 * 周六、周日全天按标准价（空闲）计费，其余时间为空闲时段。
 */
const PRICING = {
  flash: {
    offPeak: { miss: 1.5, hit: 0.05, output: 4.5 },
    peak: { miss: 3.0, hit: 0.1, output: 9.0 },
  },
  pro: {
    offPeak: { miss: 4.5, hit: 0.15, output: 13.5 },
    peak: { miss: 9.0, hit: 0.3, output: 27.0 },
  },
}

/** 取北京时间的年月日时分秒与星期（0=周日 … 6=周六）。 */
function beijingParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const get = (type) => Number(parts.find((p) => p.type === type)?.value) || 0
  const year = get('year')
  const month = get('month')
  const day = get('day')
  return {
    year,
    month,
    day,
    // 北京时间日历日期对应的星期几（0=周日 … 6=周六）。
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/** 当前是否处于高峰（翻倍）时段：周一至周五 09:00–12:00、14:00–18:00（北京时间）；周末全天标准价。 */
function isPeak(now = new Date()) {
  const { hour, weekday } = beijingParts(now)
  if (weekday === 0 || weekday === 6) return false // 周六、周日全天按标准（空闲）费率
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

/** 下一个费率切换时刻（epoch ms）。工作日费率在北京时间 9/12/14/18 点整切换；周末全天标准价，下一次切换为下周一 09:00。 */
function nextSwitchAt(now = new Date()) {
  const p = beijingParts(now)
  const boundaries = [9, 12, 14, 18]
  let nextHour = boundaries.find((b) => b > p.hour)
  let dayAdd = 0
  if (nextHour === undefined) {
    nextHour = 9
    dayAdd = 1
  }
  // 切换日若落在周六/周日，顺延到下周一 09:00（北京时间）。
  const switchDow = new Date(Date.UTC(p.year, p.month - 1, p.day + dayAdd)).getUTCDay()
  if (switchDow === 0 || switchDow === 6) {
    dayAdd += switchDow === 6 ? 2 : 1
    nextHour = 9
  }
  // 北京时间 = UTC+8，减掉偏移换算成 UTC epoch。
  return Date.UTC(p.year, p.month - 1, p.day + dayAdd, nextHour, 0, 0) - 8 * 3600 * 1000
}

/** 按模型 id 选择 flash / pro 价目，并取对应峰谷档。 */
function pickPrice(modelId, peak) {
  const lower = String(modelId || '').toLowerCase()
  const key = lower.includes('pro') ? 'pro' : 'flash'
  const band = PRICING[key]
  return peak ? band.peak : band.offPeak
}

/** 把四个 token 桶换算成费用（人民币）。缓存写入不单独计费（与官方口径一致）。 */
function costOfUsage(usage, price) {
  const miss = (Number(usage.uncachedInputTokens) || 0) / 1e6 * price.miss
  const hit = (Number(usage.cacheReadTokens) || 0) / 1e6 * price.hit
  const out = (Number(usage.outputTokens) || 0) / 1e6 * price.output
  return miss + hit + out
}

class CostGaugeService {
  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL
    this.apiKeyEnv = config.apiKeyEnv ?? DEFAULT_API_KEY_ENV
    this.threshold = Number(config.threshold ?? DEFAULT_THRESHOLD)
    this.refreshMs = Math.max(0, (Number(config.refreshSeconds) || DEFAULT_REFRESH_SECONDS) * 1000)
    this.cached = undefined
    this.cachedAt = 0
    this.inflight = undefined
  }

  /** 读取余额视图；在刷新间隔内返回缓存，失败视图永不当作新鲜缓存复用。 */
  async view() {
    const now = Date.now()
    if (this.cached && !this.cached.error && this.refreshMs > 0 && now - this.cachedAt < this.refreshMs) {
      return this.cached
    }
    if (this.inflight) return this.inflight
    this.inflight = this.queryBalance()
      .then((v) => {
        this.cached = v
        this.cachedAt = Date.now()
        return v
      })
      .finally(() => {
        this.inflight = undefined
      })
    return this.inflight
  }

  /** 强制刷新余额。 */
  async refresh() {
    const v = await this.queryBalance()
    this.cached = v
    this.cachedAt = Date.now()
    return v
  }

  /** 通过 credentials 接缝 / 环境变量解析 API Key。 */
  async resolveApiKey() {
    try {
      const credentials = this.ctx.get('credentials')
      if (credentials) {
        const hit = await credentials.resolve(this.apiKeyEnv)
        if (hit && typeof hit.value === 'string' && hit.value.length > 0) return hit.value
      }
    } catch {}
    const env = process.env[this.apiKeyEnv]
    if (typeof env === 'string' && env.length > 0) return env
    return undefined
  }

  /** 调用官方 GET /user/balance。 */
  async queryBalance() {
    const fetchedAt = Date.now()
    const key = await this.resolveApiKey()
    if (!key) {
      return { fetchedAt, available: false, total: undefined, currency: 'CNY', error: '未配置 DeepSeek API Key' }
    }
    try {
      const url = new URL(this.baseUrl)
      const prefix = url.pathname.replace(/\/+$/, '')
      const endpoint = `${url.origin}${prefix}/user/balance`
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), BALANCE_TIMEOUT_MS)
      let res
      try {
        res = await fetch(endpoint, {
          method: 'GET',
          headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { fetchedAt, available: false, total: undefined, currency: 'CNY', error: `HTTP ${res.status}${body ? ' ' + body.slice(0, 120) : ''}` }
      }
      const payload = await res.json()
      const infos = Array.isArray(payload.balance_infos) ? payload.balance_infos : []
      const buckets = infos
        .map((b) => ({ currency: String(b.currency ?? ''), total: Number(b.total_balance ?? 0) }))
        .filter((b) => b.currency !== '')
      const total = buckets.length === 0
        ? undefined
        : buckets.reduce((sum, b) => sum + (Number.isFinite(b.total) ? b.total : 0), 0)
      const currency = buckets.length === 1 ? buckets[0].currency : 'CNY'
      return { fetchedAt, available: payload.is_available !== false, total, currency, error: undefined }
    } catch (error) {
      return { fetchedAt, available: false, total: undefined, currency: 'CNY', error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 读取某个会话的 tokenUsage 投影并换算花费。 */
  sessionCost(session) {
    const usage = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    try {
      const registry = this.ctx.get('sessionProjections')
      const snap = registry && registry.snapshot(session)
      const value = snap && snap.values && snap.values.tokenUsage
      if (value && typeof value === 'object') {
        usage.uncachedInputTokens = Number(value.uncachedInputTokens) || 0
        usage.outputTokens = Number(value.outputTokens) || 0
        usage.cacheReadTokens = Number(value.cacheReadTokens) || 0
        usage.cacheWriteTokens = Number(value.cacheWriteTokens) || 0
      }
    } catch {}
    let modelId
    try {
      modelId = typeof session.requestHeader === 'function' ? session.requestHeader()?.config?.model : undefined
    } catch {}
    const peak = isPeak()
    const price = pickPrice(modelId, peak)
    const cost = costOfUsage(usage, price)
    const pricingKey = String(modelId || '').toLowerCase().includes('pro') ? 'pro' : 'flash'
    return {
      cost,
      currency: 'CNY',
      model: modelId,
      pricingKey,
      peak,
      tokens: { ...usage },
    }
  }

  /** 汇总状态：余额 + 当前会话花费 + 费率 + 阈值 + 日程（供前端画外圈）。 */
  async state(sessionId) {
    const balance = await this.view()
    const now = new Date()
    const parts = beijingParts(now)
    const peak = isPeak(now)
    const next = nextSwitchAt(now)
    let cost = null
    if (sessionId) {
      try {
        const sessions = this.ctx.get('sessions')
        const session = sessions && sessions.get(sessionId)
        if (session) cost = this.sessionCost(session)
      } catch {}
    }
    return {
      balance,
      cost,
      rate: {
        peak,
        label: peak ? 'peak' : 'standard',
        nextSwitchAt: next,
        countdownSeconds: Math.max(0, Math.round((next - Date.now()) / 1000)),
      },
      schedule: {
        // 今天是否为周末（北京时间周六/周日）；周末全天按标准（空闲）计费。
        isWeekend: parts.weekday === 0 || parts.weekday === 6,
        // 工作日高峰（繁忙）时段：小时区间，含首不含尾，按北京时间 0–24。
        peakWindows: [[9, 12], [14, 18]],
      },
      threshold: this.threshold,
    }
  }
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function getRoute(path, handler) {
  return {
    kind: 'exact',
    path,
    handler: (req, res) => {
      if (req.method !== 'GET') {
        json(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      Promise.resolve(handler(req)).then(
        (value) => json(res, 200, value),
        (error) => json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }),
      )
    },
  }
}

function sessionParam(req) {
  const raw = req.url ?? ''
  const q = raw.indexOf('?')
  if (q < 0) return undefined
  const params = new URLSearchParams(raw.slice(q + 1))
  const value = params.get('session')
  return value === null || value === '' ? undefined : value
}

export function apply(ctx, config = {}) {
  const service = new CostGaugeService(ctx, config)
  ctx.effect(() => {
    const routes = [
      getRoute('/api/cost-gauge/state', (req) => service.state(sessionParam(req))),
      getRoute('/api/cost-gauge/balance', () => service.view()),
      getRoute('/api/cost-gauge/refresh', () => service.refresh()),
    ]
    const disposers = routes.map((route) => ctx.webServer.register(route))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'cost-gauge: routes')
}
