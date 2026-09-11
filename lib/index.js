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
 * 纯 ESM、零第三方依赖：只用 node: 内置模块（文件记账见 ./ledger.js），服务通过 ctx 注入名解析。
 */
import * as ledger from './ledger.js'

export const name = 'cost-gauge'

/** 宿主侧需要的服务：webServer（注册 HTTP 路由）、sessions（读取当前会话）。 */
export const inject = ['webServer', 'sessions']

const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
const DEFAULT_THRESHOLD = 10
const DEFAULT_REFRESH_SECONDS = 30
const BALANCE_TIMEOUT_MS = 15000
const LEDGER_TICK_MS = 15000 // 宿主侧记账周期（毫秒）

/**
 * DeepSeek 官方峰谷价（人民币 / 每百万 token）。
 * 空闲时段（标准）价格为高峰时段（翻倍）的一半。
 * 高峰时段：北京时间周一至周五 09:00–12:00、14:00–18:00；
 * 周六、周日全天按标准价（空闲）计费，其余时间为空闲时段。
 *
 * 价格沿革：
 * - 2026-08-17 起：V4 系列峰谷价生效（flash / pro 两档，即下方 legacy 价目）。
 * - 2026-08-23 起：周六、周日全天不再区分峰谷（本实现恒按空闲价处理周末）。
 * - 2026-09-10 12:00（北京时间）起：Flash 系列降价；同日 V4.1 Flash 正式上线后，
 *   发往 V4 Pro 的请求被路由到 V4.1 Flash 并按 Flash 价计费（V4.1 Flash 与 Flash 同价）。
 *   因此 2026-09-10 12:00 之前按旧价，之后 flash 与已路由的 pro 都按新价估算。
 */
const FLASH_NEW_PRICE_SINCE = Date.UTC(2026, 8, 10, 4, 0, 0) // 北京时间 2026-09-10 12:00（= UTC 04:00）
const PRICING = {
  flash: {
    // 2026-08-17 ~ 2026-09-10 12:00（北京时间）
    legacy: {
      offPeak: { miss: 1.5, hit: 0.05, output: 4.5 },
      peak: { miss: 3.0, hit: 0.1, output: 9.0 },
    },
    // 2026-09-10 12:00（北京时间）起
    current: {
      offPeak: { miss: 1.0, hit: 0.02, output: 4.0 },
      peak: { miss: 2.0, hit: 0.04, output: 8.0 },
    },
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

/** 上一个费率切换时刻（epoch ms，≤ now）。与 nextSwitchAt 对称：取最近一次 ≤ 当前时间的工作日边界。 */
function previousSwitchAt(now = new Date()) {
  const p = beijingParts(now)
  const boundaries = [18, 14, 12, 9] // 逆序扫描：优先最近的边界
  for (let dayAdd = 0; dayAdd >= -8; dayAdd--) {
    const wd = new Date(Date.UTC(p.year, p.month - 1, p.day + dayAdd)).getUTCDay()
    if (wd === 0 || wd === 6) continue // 跳过周末（周末内无边界）
    for (const bh of boundaries) {
      if (dayAdd === 0 && bh > p.hour) continue // 当天只取 ≤ 当前小时的边界
      return Date.UTC(p.year, p.month - 1, p.day + dayAdd, bh, 0, 0) - 8 * 3600 * 1000
    }
  }
  return Date.now() // 不可达
}

/** 取指定时刻应生效的 flash 档位（2026-09-10 12:00 北京时间起为新价，此前为旧价）。 */
function flashBandAt(peak, when) {
  const tier = when >= FLASH_NEW_PRICE_SINCE ? PRICING.flash.current : PRICING.flash.legacy
  return peak ? tier.peak : tier.offPeak
}

/**
 * 按模型 id 与时刻选择价目，并取对应峰谷档：
 * - 非 pro（flash / v4.1-flash / vision 等）按 flash 档；9/10 12:00 后自动用新价。
 * - pro 在 9/10 12:00 前按 pro 原价；之后 V4 Pro 请求被路由到 V4.1 Flash，按 flash 新价计费。
 */
function pickPrice(modelId, peak, when = Date.now()) {
  const lower = String(modelId || '').toLowerCase()
  const proUnrouted = lower.includes('pro') && when < FLASH_NEW_PRICE_SINCE
  if (proUnrouted) return peak ? PRICING.pro.peak : PRICING.pro.offPeak
  return flashBandAt(peak, when)
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
    this.ledger = undefined
    this.ledgerSaving = undefined
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

  /** 懒加载记账文件（~/.dsh/cost-gauge/ledger.json）；并发调用只加载一次。 */
  async ensureLedger() {
    if (this.ledger) return this.ledger
    if (!this.ledgerLoading) {
      this.ledgerLoading = ledger.loadLedger()
        .then((loaded) => {
          this.ledger = loaded
          return loaded
        })
        .finally(() => { this.ledgerLoading = undefined })
    }
    return this.ledgerLoading
  }

  /** 合并写盘：1 秒内的多次变更只落盘一次。 */
  scheduleSave() {
    if (this.ledgerSaving) return this.ledgerSaving
    this.ledgerSaving = new Promise((resolve) => setTimeout(resolve, 1000))
      .then(() => ledger.saveLedger(this.ledger))
      .catch(() => {})
      .then(() => { this.ledgerSaving = undefined })
    return this.ledgerSaving
  }

  /** 读取会话的 tokenUsage 投影快照。 */
  readUsage(session) {
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
    return usage
  }

  /** 会话当前使用的模型 id。 */
  readModel(session) {
    try {
      return typeof session.requestHeader === 'function' ? session.requestHeader()?.config?.model : undefined
    } catch {
      return undefined
    }
  }

  /** 读取会话事件（只取未折叠的新事件）。 */
  readEvents(session, fromSeq) {
    try {
      const from = Math.max(0, Number(fromSeq) || 0)
      if (typeof session.snapshotEvents === 'function') {
        const end = typeof session.seq === 'number' ? session.seq : undefined
        return end === undefined ? session.snapshotEvents(from) : session.snapshotEvents(from, end)
      }
      if (Array.isArray(session.log)) return session.log.slice(from)
      if (typeof session.ownEvents === 'function') return session.ownEvents()
    } catch {}
    return []
  }

  /** 推进一个会话的记账：回放新事件，按「事件时刻的费率 + 当时的模型」逐笔计价。 */
  async accountSession(session, sessionId) {
    const l = await this.ensureLedger()
    const st = ledger.sessionState(l, sessionId)
    const events = this.readEvents(session, st.cursor)
    if (!events.length) return { folded: 0, added: 0 }
    const result = ledger.foldEvents(l, {
      sessionId,
      events,
      priceAt: (model, time) => pickPrice(model, isPeak(new Date(time)), time),
      peakAt: (time) => isPeak(new Date(time)),
    })
    if (result.folded > 0) this.scheduleSave()
    return result
  }

  /** 遍历所有在线会话记账（宿主侧定时调用，仪表盘没打开时也在记）。 */
  async accountAll() {
    let sessions = []
    try {
      const service = this.ctx.get('sessions')
      if (service && typeof service.list === 'function') sessions = service.list() || []
    } catch {}
    for (const session of sessions) {
      try {
        const id = session && session.id
        if (id) await this.accountSession(session, id)
      } catch {}
    }
  }

  /** 会话花费视图：归零后累计的花费（人民币）+ 归零时刻 + token 快照。 */
  async sessionCostView(session, sessionId) {
    const l = await this.ensureLedger()
    await this.accountSession(session, sessionId)
    const view = ledger.recordsView(l, sessionId)
    const st = l.sessions[sessionId]
    const model = (st && st.model) || this.readModel(session)
    const now = Date.now()
    const peak = isPeak()
    // 实际计费档：pro 在 9/10 12:00 后被路由到 V4.1 Flash，随 flash 计费。
    const pricingKey = String(model || '').toLowerCase().includes('pro') && now < FLASH_NEW_PRICE_SINCE ? 'pro' : 'flash'
    return {
      cost: view.sinceReset,
      currency: 'CNY',
      model,
      pricingKey,
      peak,
      resetAt: view.resetAt,
      tokens: this.readUsage(session),
    }
  }

  /** 会话花费归零：记住当前累计，之后只显示新增部分。 */
  async reset(sessionId) {
    if (!sessionId) return { ok: false, error: 'missing-session' }
    const l = await this.ensureLedger()
    try {
      const service = this.ctx.get('sessions')
      const session = service && service.get(sessionId)
      if (session) await this.accountSession(session, sessionId)
    } catch {}
    const result = ledger.resetSession(l, { sessionId, now: new Date() })
    await ledger.saveLedger(l)
    return { ok: true, resetAt: result.resetAt }
  }

  /** 读取会话标题（dsh-session-title 的 title 投影；没有则回退模型/ID）。 */
  readTitle(session, sessionId) {
    try {
      const registry = this.ctx.get('sessionProjections')
      const snap = registry && registry.snapshot(session)
      const value = snap && snap.values && snap.values.title
      if (typeof value === 'string' && value.trim()) return value.trim()
    } catch {}
    const id = String(sessionId || (session && session.id) || '')
    return id ? '会话-' + id.slice(0, 8) : '会话'
  }

  /** 每日花费记录：scope='all' 时为全部会话合并。 */
  async records(sessionId, scope) {
    const l = await this.ensureLedger()
    if (scope === 'all') {
      const view = ledger.recordsAllView(l)
      return {
        ok: true, scope: 'all', title: '全部会话', sessionCount: view.sessionCount,
        resetAt: null, sinceReset: view.sinceReset, days: view.days,
      }
    }
    let title = ''
    if (sessionId) {
      try {
        const service = this.ctx.get('sessions')
        const session = service && service.get(sessionId)
        if (session) {
          await this.accountSession(session, sessionId)
          title = this.readTitle(session, sessionId)
        }
      } catch {}
    }
    const view = ledger.recordsView(l, sessionId)
    return { ok: true, scope: 'session', title: title || '会话', resetAt: view.resetAt, sinceReset: view.sinceReset, days: view.days }
  }

  /** 读取导出相关偏好（默认保存位置 / 最近一次导出文件）。 */
  async prefs() {
    const l = await this.ensureLedger()
    return { ok: true, excelDir: l.prefs.excelDir || '', lastExport: l.prefs.lastExport || '' }
  }

  /** 更新偏好：excelDir 传空字符串表示清除默认保存位置。 */
  async setPrefs(body) {
    const l = await this.ensureLedger()
    const dir = String((body && body.excelDir) || '')
    if (dir) {
      try {
        await ledger.ensureDir(dir)
      } catch (error) {
        return { ok: false, error: '目录不可用：' + (error instanceof Error ? error.message : String(error)) }
      }
    }
    l.prefs.excelDir = dir
    await ledger.saveLedger(l)
    return { ok: true, excelDir: dir }
  }

  /** 弹原生文件夹选择框并记为默认保存位置。 */
  async chooseFolder() {
    const dir = await ledger.pickFolder({ title: '选择 dsh-cost-gauge 导出 Excel 的默认保存位置' })
    if (!dir) return { ok: false, cancelled: true }
    try {
      await ledger.ensureDir(dir)
    } catch (error) {
      return { ok: false, error: '目录不可用：' + (error instanceof Error ? error.message : String(error)) }
    }
    const l = await this.ensureLedger()
    l.prefs.excelDir = dir
    await ledger.saveLedger(l)
    return { ok: true, excelDir: dir }
  }

  /**
   * 导出 Excel（两个工作表：按峰谷拆分 / 按模型拆分）。
   * 已配置默认保存位置就直接写入；没有则弹原生选择框，选完记为默认。
   * 客户端把当前筛选范围的表格数据传上来，宿主只负责落盘。
   */
  async exportRecords(body) {
    const l = await this.ensureLedger()
    let dir = l.prefs.excelDir || ''
    if (!dir) {
      dir = await ledger.pickFolder({ title: '选择 Excel 保存位置（将记为默认保存位置）' })
      if (!dir) return { ok: false, cancelled: true }
      l.prefs.excelDir = dir
    }
    try {
      await ledger.ensureDir(dir)
    } catch (error) {
      return { ok: false, error: '目录不可用：' + (error instanceof Error ? error.message : String(error)) }
    }
    const rangeLabel = String((body && body.rangeLabel) || '总时间')
    const content = ledger.buildXlsx({
      note: String((body && body.note) || ''),
      bandHead: Array.isArray(body && body.bandHead) ? body.bandHead : ['时段', '空闲（标准）', '高峰（翻倍）', '合计'],
      bandRows: Array.isArray(body && body.bandRows) ? body.bandRows : [],
      modelHead: Array.isArray(body && body.modelHead) ? body.modelHead : ['时段', 'v4-pro', 'v4-flash', 'flash-vision', '合计'],
      modelRows: Array.isArray(body && body.modelRows) ? body.modelRows : [],
    })
    // 默认文件名由客户端给出（会话名称_计费时间段），这里只做安全化与后缀兜底（真正的 .xlsx）
    const wanted = ledger.safeFileName(String((body && body.fileName) || ''))
    const fileName = (wanted && wanted !== '记录' ? wanted : 'dsh-cost-gauge-花费记录-' + ledger.sanitizeFileName(rangeLabel))
      .replace(/\.(xlsx|xls)$/i, '') + '.xlsx'
    const target = await ledger.writeExportFile(dir, fileName, content)
    l.prefs.lastExport = target
    await ledger.saveLedger(l)
    return { ok: true, path: target, dir }
  }

  /** 在资源管理器中定位最近一次导出的文件（只允许打开记录里的那一个）。 */
  async openFolder(body) {
    const l = await this.ensureLedger()
    const wanted = String((body && body.path) || '')
    const last = l.prefs.lastExport || ''
    if (!wanted || wanted !== last) return { ok: false, error: '仅允许打开最近一次导出的文件' }
    ledger.revealInExplorer(wanted)
    return { ok: true, path: wanted }
  }

  /** 汇总状态：余额 + 当前会话花费 + 费率 + 阈值。 */
  async state(sessionId) {
    const balance = await this.view()
    const now = new Date()
    const peak = isPeak(now)
    const next = nextSwitchAt(now)
    const prev = previousSwitchAt(now)
    let cost = null
    if (sessionId) {
      try {
        const sessions = this.ctx.get('sessions')
        const session = sessions && sessions.get(sessionId)
        if (session) cost = await this.sessionCostView(session, sessionId)
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
        // 当前费率时段总长（秒），供倒计时饼图计算“剩余比例”。
        periodSeconds: Math.max(60, Math.round((next - prev) / 1000)),
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

/** 读取 JSON 请求体（限流 1MB）。 */
function readJson(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > limit) {
        reject(new Error('body-too-large'))
        try { req.destroy() } catch {}
      }
    })
    req.on('end', () => {
      if (!data) { resolve({}); return }
      try { resolve(JSON.parse(data)) } catch (error) { reject(error) }
    })
    req.on('error', reject)
  })
}

function postRoute(path, handler) {
  return {
    kind: 'exact',
    path,
    handler: (req, res) => {
      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      readJson(req).then((body) => handler(body, req)).then(
        (value) => json(res, 200, value),
        (error) => json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }),
      )
    },
  }
}

/**
 * 同一路径按方法分发（路由表按 path 精确匹配，同 path 注册两条会被先注册的拦截）。
 * handlers: { GET?: (req) => any, POST?: (body, req) => any }
 */
function methodRoute(path, handlers) {
  return {
    kind: 'exact',
    path,
    handler: (req, res) => {
      const fn = handlers[req.method || 'GET']
      if (!fn) {
        json(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      const run = req.method === 'POST'
        ? readJson(req).then((body) => fn(body, req))
        : Promise.resolve().then(() => fn(req))
      run.then(
        (value) => json(res, 200, value),
        (error) => json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) }),
      )
    },
  }
}

function queryParam(req, name) {
  const raw = req.url ?? ''
  const q = raw.indexOf('?')
  if (q < 0) return undefined
  const value = new URLSearchParams(raw.slice(q + 1)).get(name)
  return value === null || value === '' ? undefined : value
}

function sessionParam(req) {
  return queryParam(req, 'session')
}

export function apply(ctx, config = {}) {
  const service = new CostGaugeService(ctx, config)
  ctx.effect(() => {
    const routes = [
      getRoute('/api/cost-gauge/state', (req) => service.state(sessionParam(req))),
      getRoute('/api/cost-gauge/balance', () => service.view()),
      getRoute('/api/cost-gauge/refresh', () => service.refresh()),
      getRoute('/api/cost-gauge/records', (req) => service.records(sessionParam(req), queryParam(req, 'scope'))),
      methodRoute('/api/cost-gauge/prefs', {
        GET: () => service.prefs(),
        POST: (body) => service.setPrefs(body),
      }),
      postRoute('/api/cost-gauge/reset', (body) => service.reset(body && body.session)),
      postRoute('/api/cost-gauge/pick-folder', () => service.chooseFolder()),
      postRoute('/api/cost-gauge/export', (body) => service.exportRecords(body)),
      postRoute('/api/cost-gauge/open-folder', (body) => service.openFolder(body)),
    ]
    const disposers = routes.map((route) => ctx.webServer.register(route))

    // 宿主侧定时记账：仪表盘页面没打开时也持续累计（记录才不会丢）。
    const tick = setInterval(() => { service.accountAll().catch(() => {}) }, LEDGER_TICK_MS)
    service.ensureLedger().then(() => service.accountAll()).catch(() => {})

    return () => {
      clearInterval(tick)
      for (const dispose of disposers) dispose()
    }
  }, 'cost-gauge: routes')
}
