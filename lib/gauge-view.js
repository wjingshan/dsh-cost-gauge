/**
 * 仪表视图归一化层 —— 把各模型的原始数据统一成 UI 只认的一种形状。
 *
 * ## 为什么要有这一层
 * 之前 UI 直接消费各平台原始字段（`data.rate.peak`、`mmxData.windows.five.usedPercent`…），
 * 模型判断散在 render / tick / updateDial 里共 4 处，MiniMax 的字段名在 UI 里硬编码 40 余处。
 * 接第三个模型就得再抄一遍这些分支。
 *
 * 现在 UI 只认本文件产出的形状：不出现模型名、不出现任何平台字段名。
 * 接入新模型 = 写一个新 adapter 产出同样形状，UI 一行不改。
 *
 * ## 值用「结构化规格」表达
 * 标签给 i18n key，值给 spec，由 UI 按 kind 渲染（i18n 与数字格式化留在 UI）：
 *   { kind: 'money',     value }          → ¥12.34，非数字则 —
 *   { kind: 'percent',   value }          → 37%
 *   { kind: 'unlimited' }                 → ∞
 *   { kind: 'duration',  at, untilMs }    → 4小时52分；UI 每秒按 (untilMs - (now-at)) 重算
 *   { kind: 'rateStatus', ... }           → 标准（空闲）/ 翻倍（高峰）
 *   { kind: 'text',      value }          → 原样
 *
 * ## dial.kind 只有两种几何
 *   'schedule' —— 按小时分段的时段表（按量计费有峰谷价时用）
 *   'window'   —— 单一窗口按比例填充（订阅制）
 * 绝大多数模型都能归到其中之一；归不进去才需要动 UI。
 */

/** 模型 → 计费形态。判断只在服务端做一次，UI 不再判断模型。 */
export function detectMode(model) {
  const m = String(model || '').toLowerCase()
  if (m.includes('minimax')) return 'subscription'
  return 'metered'
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null)
const clamp01 = (v) => Math.min(1, Math.max(0, v))

/** 余额 → spec：有数字给 money，有错误给错误文案 key，否则破折号。 */
function balanceSpec(bal) {
  if (bal && Number.isFinite(bal.total)) return { kind: 'money', value: bal.total }
  if (bal && bal.error) return { kind: 'text', value: '—', error: bal.error }
  return { kind: 'text', value: '—' }
}

/**
 * 按量计费（DeepSeek 这类）：峰谷时段 + 金额 + 账户余额。
 */
export function buildMeteredView(state) {
  const { balance, cost, rate, holidayData, threshold, version } = state || {}
  const peak = !!(rate && rate.peak)
  const now = Date.now()
  const untilSwitch = rate && Number.isFinite(rate.nextSwitchAt)
    ? Math.max(0, rate.nextSwitchAt - now)
    : null
  const periodSec = rate && Number.isFinite(rate.periodSeconds) ? rate.periodSeconds : 0
  const ringFrac = untilSwitch !== null && periodSec > 0
    ? clamp01(untilSwitch / (periodSec * 1000))
    : 0

  const model = (cost && cost.model) ? String(cost.model) : ''
  const hd = holidayData || {}

  return {
    mode: 'metered',
    meta: {
      version: typeof version === 'string' ? version : '',
      threshold: num(threshold) ?? 0,
      model,
      // 节假日数据覆盖：当前年未收录时 UI 会提示「仅按星期判断」
      holidayYears: Array.isArray(hd.years) ? hd.years : [],
      holidayYearCovered: hd.yearCovered !== false,
    },

    // 外圈弧：一天里的费率时段表。几何由 UI 按 offAllDay 计算。
    dial: {
      kind: 'schedule',
      offAllDay: !!(rate && rate.holidayName),
      peak,
    },

    // 最小化圆环：当前费率时段还剩多少
    ring: { fraction: ringFrac, tone: peak ? 'peak' : 'std' },

    caption: {
      left: {
        labelKey: 'currentRate',
        spec: {
          kind: 'rateStatus',
          peak,
          holidayName: (rate && rate.holidayName) || null,
          makeupWorkday: !!(rate && rate.makeupWorkday),
        },
      },
      right: {
        labelKey: 'nextSwitch',
        spec: untilSwitch === null
          ? { kind: 'text', value: '—' }
          : { kind: 'duration', at: now, untilMs: untilSwitch },
      },
    },

    rows: [
      { labelKey: 'turnCost', spec: cost && Number.isFinite(cost.turnCost) ? { kind: 'turnMoney', value: cost.turnCost } : { kind: 'text', value: '—' } },
      { labelKey: 'sessionCost', spec: cost && Number.isFinite(cost.cost) ? { kind: 'money', value: cost.cost } : { kind: 'text', value: '—' } },
      { labelKey: 'balance', spec: balanceSpec(balance) },
    ],

    // 紧凑态（最小化胶囊 / 贴边竖条）：沿用「按设置二选一」的旧行为
    compact: {
      primary: {
        labelKey: 'sessionCost',
        spec: cost && Number.isFinite(cost.cost) ? { kind: 'money', value: cost.cost } : { kind: 'text', value: '—' },
        altLabelKey: 'turnCost',
        altSpec: cost && Number.isFinite(cost.turnCost) ? { kind: 'turnMoney', value: cost.turnCost } : { kind: 'text', value: '—' },
      },
      secondary: { labelKey: 'balance', spec: balanceSpec(balance) },
      tint: null,
    },

    // 余额内环（表盘 R=47）：既有 UI，两种模式都画，与当前模型无关
    balanceRing: balance && Number.isFinite(balance.total)
      ? { total: balance.total, threshold: num(threshold) ?? 0 }
      : null,

    tone: 'normal',
    // 余额告警（红点闪烁）：只在按量计费下有意义
    alarm: !!(balance && Number.isFinite(balance.total) && balance.total < (num(threshold) ?? 0)),
  }
}

/**
 * 订阅制（MiniMax M Plan 这类）：窗口额度 + 距重置时间。
 *
 * 窗口语义（即使换平台也通用）：
 *   usable   —— 额度未用尽，弧长 = 剩余时间比例
 *   cooling  —— 额度已用尽，弧长 = 已等待比例，到重置瞬间走满
 */
export function buildSubscriptionView(minimax, state) {
  const w = (minimax && minimax.ok === true && minimax.windows) ? minimax.windows : null
  const five = w ? w.five : null
  const week = w ? w.week : null
  const model = (state && state.cost && state.cost.model) ? String(state.cost.model) : ''
  const stateMeta = state || {}

  const usable = !!(five
    && Number.isFinite(five.startAt) && Number.isFinite(five.resetsAt)
    && five.resetsAt > five.startAt)

  const now = Date.now()
  let fraction = null
  let phase = null
  let untilReset = null
  let ringTone = 'muted'

  if (usable) {
    const span = five.resetsAt - five.startAt
    const elapsed = clamp01((now - five.startAt) / span)
    const usedUp = five.unlimited !== true && Number(five.usedPercent) >= 100
    phase = usedUp ? 'cooling' : 'usable'
    fraction = usedUp ? elapsed : 1 - elapsed
    untilReset = Math.max(0, five.resetsAt - now)
    ringTone = usedUp ? 'muted' : 'accent'
  }

  const pctLeft = (win) => {
    if (!win) return { kind: 'text', value: '—' }
    if (win.unlimited) return { kind: 'unlimited' }
    const used = Number(win.usedPercent)
    return Number.isFinite(used) ? { kind: 'percent', value: Math.max(0, 100 - used) } : { kind: 'text', value: '—' }
  }
  const durSpec = () => (untilReset === null
    ? { kind: 'text', value: '—' }
    : { kind: 'duration', at: now, untilMs: untilReset })

  const hd = stateMeta.holidayData || {}
  const exhausted = !!(minimax && minimax.exhausted === true)
  const warning = !!(minimax && minimax.warning === true)

  return {
    mode: 'subscription',
    meta: {
      version: typeof stateMeta.version === 'string' ? stateMeta.version : '',
      threshold: num(stateMeta.threshold) ?? 0,
      model,
      holidayYears: Array.isArray(hd.years) ? hd.years : [],
      holidayYearCovered: hd.yearCovered !== false,
    },

    dial: {
      kind: 'window',
      // 拿不到额度时不画弧；否则按 phase 决定颜色与起画端
      ...(usable ? { fraction, phase } : { fraction: null, phase: null }),
    },

    ring: { fraction: fraction ?? 0, tone: ringTone },

    caption: {
      left: { labelKey: 'minimaxRemainingLabel', spec: pctLeft(five) },
      right: { labelKey: 'minimaxRemainingTimeLabel', spec: durSpec() },
    },

    rows: [
      { labelKey: 'minimaxRowFive', spec: pctLeft(five) },
      { labelKey: 'minimaxRowReset', spec: durSpec() },
      { labelKey: 'minimaxRowWeek', spec: pctLeft(week) },
    ],

    compact: {
      primary: { labelKey: 'minimaxRowFive', spec: pctLeft(five) },
      secondary: { labelKey: 'minimaxRowWeek', spec: pctLeft(week) },
      tint: '#e0432d',
    },

    // 订阅制没有账户余额，但余额内环是既有 UI：无数据就不画，与模型无关
    balanceRing: null,

    tone: exhausted ? 'exhausted' : warning ? 'warn' : 'normal',
    // 订阅制没有余额告警
    alarm: false,
  }
}

/** 入口：按模型选 adapter，产出一份 UI 只认的视图。 */
export function buildGaugeView(state, minimax) {
  const model = (state && state.cost && state.cost.model) ? String(state.cost.model) : ''
  return detectMode(model) === 'subscription'
    ? buildSubscriptionView(minimax, state)
    : buildMeteredView(state)
}