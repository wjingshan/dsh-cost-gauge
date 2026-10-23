/**
 * MiniMax M Plan（订阅）额度查询。
 *
 * 官方规则（2026-09 核对 platform.minimax.cn/docs/m-plan/usage-rules）：
 *  - 两个独立窗口：**5 小时**（非视频模型）与**周窗口**（所有模型，7 天）；
 *  - 窗口**从第一次使用时起算**，到期即恢复该档位上限，未用完不累积、不结转；
 *  - 5 小时刷新**不**恢复本周额度；两个窗口都需有余额才能调用非视频模型。
 *
 * 接口（实测 2026-10-23）：
 *  - GET {origin}/v1/token_plan/remains，Key 走 Authorization 头；
 *  - 三个官方 origin 依次回退：www.minimax.cn → www.minimax.io → www.minimaxi.com；
 *  - 认证失败(401/403)不重试换域名，其余错误才回退；解析成功即停；
 *  - redirect: 'manual' —— 拒绝跟随重定向，避免把 Key 带到第三方。
 *
 * 字段处理约定（对齐 dsh-cost-meter 的实现，避免重复踩坑）：
 *  - 百分比以 `*_remaining_percent` 为准；`*_total_count` 常常是 0，只作兜底；
 *  - `*_status === 3` 表示该窗口不限量（∞）；**缺失窗口或查询失败绝不推断为无限量**；
 *  - 取 `general` 行，跳过 video/speech/audio/image 专用的无限量行；
 *  - 重置时刻取 `end_time` / `weekly_end_time`。
 */

/** 官方 origin 回退链（按顺序尝试）。 */
export const MINIMAX_ORIGINS = [
  'https://www.minimax.cn',
  'https://www.minimax.io',
  'https://www.minimaxi.com',
]

/** 每次请求的超时与尝试次数（对齐参考实现）。 */
const REQUEST_TIMEOUT_MS = 15000
const REQUEST_ATTEMPTS = 2

/** 归一化用户填写的 origin：必须是 https、无路径/查询/片段；非法返回 null。 */
export function normalizeOrigin(input) {
  const raw = String(input ?? '').trim()
  if (raw === '') return null
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (url.search || url.hash) return null
  if (url.pathname !== '/' && url.pathname !== '') return null
  return url.origin
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
const clampPct = (v) => Math.min(100, Math.max(0, v))

/** 把剩余百分比换算成「已用百分比」，与其它厂商的口径保持一致。 */
function usedPercentFrom(row, remainKey, totalKey, usedKey, remainCountKey) {
  const remain = num(row?.[remainKey])
  if (remain !== null) return clampPct(100 - remain)
  const total = num(row?.[totalKey])
  const used = num(row?.[usedKey])
  const left = num(row?.[remainCountKey])
  if (total !== null && total > 0) {
    if (left !== null) return clampPct(100 - (left / total) * 100)
    if (used !== null) return clampPct((used / total) * 100)
  }
  return null
}

/**
 * 从单条记录抽出 5h / 7d 两个窗口。
 * @returns {{five?: object, week?: object}} 缺失的窗口不出现在结果里。
 */
export function windowsFromRecord(row) {
  const out = {}
  if (row === null || typeof row !== 'object') return out

  if (Number(row.current_interval_status) === 3) {
    out.five = { unlimited: true, usedPercent: null, resetsAt: num(row.end_time), startAt: num(row.start_time) }
  } else {
    const used = usedPercentFrom(
      row,
      'current_interval_remaining_percent',
      'current_interval_total_count',
      'current_interval_usage_count',
      'current_interval_remain_count',
    )
    if (used !== null) {
      out.five = { unlimited: false, usedPercent: used, resetsAt: num(row.end_time), startAt: num(row.start_time) }
    }
  }

  if (Number(row.current_weekly_status) === 3) {
    out.week = { unlimited: true, usedPercent: null, resetsAt: num(row.weekly_end_time), startAt: num(row.weekly_start_time) }
  } else {
    const used = usedPercentFrom(
      row,
      'current_weekly_remaining_percent',
      'current_weekly_total_count',
      'current_weekly_usage_count',
      'current_weekly_remain_count',
    )
    if (used !== null) {
      out.week = { unlimited: false, usedPercent: used, resetsAt: num(row.weekly_end_time), startAt: num(row.weekly_start_time) }
    }
  }

  return out
}

/** 选 chat/通用额度行：general → minimax-m* → 第一条能解析出窗口的记录。 */
export function pickModelRow(rows) {
  const list = (Array.isArray(rows) ? rows : []).filter(
    (r) => r !== null && typeof r === 'object' && !/^(video|speech|audio|image)(?:$|[-_])/i.test(String(r.model_name ?? '')),
  )
  const byName = (n) => list.find((r) => String(r.model_name ?? '').toLowerCase() === n)
  return (
    byName('general') ??
    list.find((r) => /^minimax-m/i.test(String(r.model_name ?? ''))) ??
    list.find((r) => Object.keys(windowsFromRecord(r)).length > 0) ??
    list[0] ??
    null
  )
}

/** 解析响应体，兼容 model_remains 数组与根节点平铺两种形态。 */
export function parseResponse(data) {
  if (data === null || typeof data !== 'object') return null
  const base = data.base_resp
  if (base && Number(base.status_code) !== 0) {
    return { ok: false, message: String(base.status_msg || `status ${base.status_code}`), code: Number(base.status_code) }
  }
  const payload = data.data !== null && typeof data.data === 'object' && !Array.isArray(data.data) ? data.data : data
  const rows = Array.isArray(payload.model_remains)
    ? payload.model_remains
    : Array.isArray(payload.plan_remains)
      ? payload.plan_remains
      : Array.isArray(payload.remains)
        ? payload.remains
        : Array.isArray(payload.windows)
          ? payload.windows
          : []
  const row = rows.length > 0 ? pickModelRow(rows) : (Object.keys(windowsFromRecord(payload)).length ? payload : null)
  if (!row) return { ok: false, message: '响应中没有可解析的额度窗口', code: undefined }
  const windows = windowsFromRecord(row)
  if (Object.keys(windows).length === 0) return { ok: false, message: '响应中没有可解析的额度窗口', code: undefined }
  return { ok: true, windows, modelName: String(row.model_name ?? '') || undefined }
}

/** 单次 GET，附带超时；不做重试（重试在调用层按域名回退）。 */
async function getJson(url, key, signal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      redirect: 'manual',
      signal: controller.signal,
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch {}
    return { status: res.status, json, text }
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', onAbort)
  }
}

/**
 * 查询 MiniMax 额度。
 * @param {string} key 订阅 Key（sk-cp-…）
 * @param {{origin?: string, signal?: AbortSignal}} options origin 为空则用官方回退链
 * @returns {Promise<{ok: boolean, fetchedAt: number, windows?: object, endpoint?: string, error?: string, kind?: string}>}
 *          任何失败都返回视图对象而不抛出 —— 额度查询失败不该影响浮窗其它部分。
 */
export async function queryQuota(key, options = {}) {
  const fetchedAt = Date.now()
  const trimmed = String(key ?? '').trim()
  if (!trimmed) {
    return { ok: false, fetchedAt, error: '未配置 MiniMax 订阅 Key', kind: 'no-key' }
  }

  const explicit = options.origin ? normalizeOrigin(options.origin) : undefined
  if (options.origin && !explicit) {
    return { ok: false, fetchedAt, error: '查询域名无效（需 https:// 开头、不含路径）', kind: 'bad-origin' }
  }
  const origins = explicit ? [explicit] : MINIMAX_ORIGINS

  let lastError = '未知错误'
  let sawAuthFailure = false

  for (const origin of origins) {
    for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt++) {
      const url = `${origin}/v1/token_plan/remains`
      try {
        const { status, json, text } = await getJson(url, trimmed, options.signal)
        // 认证失败：换域名也没用，直接停
        if (status === 401 || status === 403) {
          sawAuthFailure = true
          lastError = `认证失败（HTTP ${status}），请检查订阅 Key`
          break
        }
        if (json === null) {
          lastError = `响应不是 JSON（HTTP ${status}）：${String(text).slice(0, 80)}`
          continue
        }
        const parsed = parseResponse(json)
        if (parsed.ok) {
          return { ok: true, fetchedAt, windows: parsed.windows, modelName: parsed.modelName, endpoint: url }
        }
        // 业务错误码：登录态问题换域名同样无效
        if (parsed.code === 1004 || parsed.code === 401 || parsed.code === 1002) {
          sawAuthFailure = true
          lastError = parsed.message
          break
        }
        lastError = parsed.message
      } catch (error) {
        if (options.signal?.aborted) return { ok: false, fetchedAt, error: '已取消', kind: 'aborted' }
        lastError = error instanceof Error ? error.message : String(error)
      }
    }
    // 该域名失败：认证失败直接停，否则换下一个官方域名
    if (sawAuthFailure) break
  }

  return {
    ok: false,
    fetchedAt,
    error: lastError,
    kind: sawAuthFailure ? 'auth' : 'network',
  }
}

/** 距离窗口重置还有多少毫秒；不限量或缺少重置时刻返回 null。 */
export function msUntilReset(win, now = Date.now()) {
  if (!win || win.unlimited) return null
  if (!Number.isFinite(win.resetsAt) || win.resetsAt <= 0) return null
  return Math.max(0, win.resetsAt - now)
}