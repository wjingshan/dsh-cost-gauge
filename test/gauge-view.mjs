/**
 * 归一化层测试：两种模式产出同一种形状，且视图里不出现任何模型特有的字段名。
 */
import {
  detectMode, buildGaugeView, buildMeteredView, buildSubscriptionView,
} from '../lib/gauge-view.js'

let pass = 0, fail = 0
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log(`  ok  ${label}`) }
  else { fail++; console.error(`  FAIL ${label}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}
const eq = (label, got, want) => ok(label, JSON.stringify(got) === JSON.stringify(want), { got, want })

/* ---------------- 夹具 ---------------- */
const NOW = Date.now()
const FIVE_MS = 5 * 3600 * 1000

const deepseekState = {
  balance: { fetchedAt: NOW, available: true, total: 89.04, currency: 'CNY' },
  cost: { cost: 1.23, turnCost: 0.004, model: 'deepseek-chat', pricingKey: 'flash', peak: false },
  rate: {
    peak: false, label: 'standard', holidayName: null, makeupWorkday: false,
    nextSwitchAt: NOW + 3600_000, countdownSeconds: 3600, periodSeconds: 7200,
  },
  holidayData: { years: [2026], yearCovered: true },
  threshold: 10,
  version: '1.6.8',
}

const mmxData = {
  ok: true, enabled: true, modelName: 'general', exhausted: false, warning: false,
  windows: {
    five: { unlimited: false, usedPercent: 62, startAt: NOW - FIVE_MS * 0.2, resetsAt: NOW + FIVE_MS * 0.8 },
    week: { unlimited: false, usedPercent: 33, startAt: NOW, resetsAt: NOW + 7 * 24 * 3600_000 },
  },
}

const mmxState = {
  ...deepseekState,
  cost: { ...deepseekState.cost, model: 'minimax-m3' },
}

/* ---------------- 模型识别 ---------------- */
console.log('=== detectMode ===')
eq('deepseek → metered', detectMode('deepseek-chat'), 'metered')
eq('minimax → subscription', detectMode('MiniMax-M3'), 'subscription')
eq('空 → metered（默认按量）', detectMode(''), 'metered')
eq('未知 → metered', detectMode('qwen-max'), 'metered')

/* ---------------- 两种模式的骨架必须一致 ---------------- */
console.log('\n=== 骨架一致性 ===')
const mv = buildMeteredView(deepseekState)
const sv = buildSubscriptionView(mmxData, mmxState)
const SKELETON = ['mode', 'meta', 'dial', 'ring', 'caption', 'rows', 'compact', 'balanceRing', 'tone', 'alarm']
eq('metered 顶层键', Object.keys(mv).sort(), SKELETON.slice().sort())
eq('subscription 顶层键', Object.keys(sv).sort(), SKELETON.slice().sort())
eq('两者顶层键完全相同', Object.keys(mv).sort(), Object.keys(sv).sort())
eq('caption 结构相同', Object.keys(mv.caption).sort(), Object.keys(sv.caption).sort())
eq('rows 都是 3 项', [mv.rows.length, sv.rows.length], [3, 3])
eq('rows 每项都是 {labelKey, spec}', mv.rows.map(r => Object.keys(r).sort()), sv.rows.map(r => Object.keys(r).sort()))

/* ---------------- 视图里不能出现平台原始响应字段名 ---------------- */
console.log('\n=== 归一化效果：不含平台原始字段名 ===')
// 只禁「各平台原始响应里的数据字段」；i18n key（turnCost/balance）与通用语义（peak）本就可以出现。
const FORBIDDEN = ['usedPercent', 'resetsAt', 'startAt', 'windows', 'nextSwitchAt',
  'periodSeconds', 'countdownSeconds', 'msUntilReset', 'pricingKey', 'modelName',
  'fetchedAt', 'available', 'currency', 'endpoint', 'remainingPercent']

/** 递归收集所有对象键名。 */
function collectKeys(node, acc = new Set()) {
  if (Array.isArray(node)) { for (const v of node) collectKeys(v, acc); return acc }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) { acc.add(k); collectKeys(v, acc) }
  }
  return acc
}

for (const v of [mv, sv]) {
  const keys = collectKeys(v)
  const leaked = FORBIDDEN.filter((k) => keys.has(k))
  eq(`${v.mode} 视图键名无平台字段`, leaked, [])
}

/* ---------------- metered 具体值 ---------------- */
console.log('\n=== metered 取值 ===')
eq('mode', mv.mode, 'metered')
eq('dial.kind', mv.dial.kind, 'schedule')
eq('dial.peak', mv.dial.peak, false)
eq('caption.left 用费率文案 key', mv.caption.left.labelKey, 'currentRate')
eq('caption.right 是 duration', mv.caption.right.spec.kind, 'duration')
eq('caption.right untilMs 约 1 小时', Math.round(mv.caption.right.spec.untilMs / 1000), 3600)
eq('rows[0] 是本回合花费（turnMoney）', [mv.rows[0].labelKey, mv.rows[0].spec.kind], ['turnCost', 'turnMoney'])
eq('rows[1] 是会话花费', [mv.rows[1].labelKey, mv.rows[1].spec.value], ['sessionCost', 1.23])
eq('rows[2] 是余额', [mv.rows[2].labelKey, mv.rows[2].spec.value], ['balance', 89.04])
eq('余额内环有值', mv.balanceRing, { total: 89.04, threshold: 10 })
eq('ring.tone 随费率', mv.ring.tone, 'std')
ok('ring.fraction 在 0..1', mv.ring.fraction > 0 && mv.ring.fraction <= 1, mv.ring.fraction)
eq('余额告警未触发', mv.alarm, false)

/* ---------------- subscription 具体值 ---------------- */
console.log('\n=== subscription 取值 ===')
eq('mode', sv.mode, 'subscription')
eq('dial.kind', sv.dial.kind, 'window')
eq('phase = usable（未用尽）', sv.dial.phase, 'usable')
ok('fraction ≈ 剩余比例 0.8', Math.abs(sv.dial.fraction - 0.8) < 0.01, sv.dial.fraction)
eq('caption.left 用额度文案 key', sv.caption.left.labelKey, 'minimaxRemainingLabel')
eq('caption.left 是 percent 38', sv.caption.left.spec, { kind: 'percent', value: 38 })
eq('rows[0] 5 小时额度', [sv.rows[0].labelKey, sv.rows[0].spec.value], ['minimaxRowFive', 38])
eq('rows[1] 5 小时重置（duration）', [sv.rows[1].labelKey, sv.rows[1].spec.kind], ['minimaxRowReset', 'duration'])
eq('rows[2] 周额度 67', [sv.rows[2].labelKey, sv.rows[2].spec.value], ['minimaxRowWeek', 67])
eq('紧凑态 primary/secondary', [sv.compact.primary.spec.value, sv.compact.secondary.spec.value], [38, 67])
eq('订阅制无余额内环', sv.balanceRing, null)
eq('无余额告警', sv.alarm, false)
eq('ring.tone = accent', sv.ring.tone, 'accent')

/* ---------------- 边界 ---------------- */
console.log('\n=== 边界 ===')
const usedUp = buildSubscriptionView({
  ...mmxData,
  exhausted: true,
  windows: { ...mmxData.windows, five: { ...mmxData.windows.five, usedPercent: 100 } },
}, mmxState)
eq('用尽 → phase cooling', usedUp.dial.phase, 'cooling')
eq('用尽 → tone exhausted', usedUp.tone, 'exhausted')
eq('用尽 → ring.tone muted', usedUp.ring.tone, 'muted')
ok('用尽 → fraction = 已用比例 0.2', Math.abs(usedUp.dial.fraction - 0.2) < 0.01, usedUp.dial.fraction)

const noData = buildSubscriptionView(null, mmxState)
eq('无数据 → fraction null（不画弧）', noData.dial.fraction, null)
eq('无数据 → rows 全是破折号', noData.rows.map(r => r.spec.value), ['—', '—', '—'])
eq('无数据 → 不冒充无限量', noData.rows.map(r => r.spec.kind), ['text', 'text', 'text'])

const unlimited = buildSubscriptionView({
  ...mmxData,
  windows: { ...mmxData.windows, five: { ...mmxData.windows.five, unlimited: true } },
}, mmxState)
eq('无限量 → kind unlimited', unlimited.rows[0].spec.kind, 'unlimited')

const noSession = buildMeteredView({ ...deepseekState, cost: null })
eq('无会话 → cost 行破折号', noSession.rows.slice(0, 2).map(r => r.spec.value), ['—', '—'])
eq('无会话 → 模型空', noSession.meta.model, '')

const badBal = buildMeteredView({ ...deepseekState, balance: { available: false, error: '未配置 DeepSeek API Key' } })
eq('余额失败 → 文案破折号 + 保留错误', [badBal.rows[2].spec.value, badBal.rows[2].spec.error], ['—', '未配置 DeepSeek API Key'])
eq('余额失败 → 不画内环', badBal.balanceRing, null)

/* ---------------- 入口分发 ---------------- */
console.log('\n=== buildGaugeView 分发 ===')
eq('deepseek 走 metered', buildGaugeView(deepseekState, mmxData).mode, 'metered')
eq('minimax 走 subscription', buildGaugeView(mmxState, mmxData).mode, 'subscription')
eq('minimax 但无额度数据仍走 subscription', buildGaugeView(mmxState, null).mode, 'subscription')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)