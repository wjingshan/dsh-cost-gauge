/**
 * 服务端集成测试：/gauge 归一化视图。
 * 用隔离的数据目录，不碰真实账本。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const TMP = mkdtempSync(path.join(tmpdir(), 'dsg-gauge-'))
process.env.DSH_COST_GAUGE_DIR = TMP

const { CostGaugeService } = await import('../lib/index.js')

let pass = 0, fail = 0
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log(`  ok  ${label}`) }
  else { fail++; console.error(`  FAIL ${label}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}
const eq = (label, got, want) => ok(label, JSON.stringify(got) === JSON.stringify(want), { got, want })

const fakeCtx = { get: () => undefined }
const svc = new CostGaugeService(fakeCtx, {})

try {
  console.log('=== 无会话（拿不到 model）→ 走按量计费 ===')
  const v1 = await svc.gaugeView(undefined)
  eq('mode', v1.mode, 'metered')
  eq('dial.kind', v1.dial.kind, 'schedule')
  ok('有 meta.version', typeof v1.meta.version === 'string', v1.meta.version)
  eq('rows 三项', v1.rows.length, 3)
  ok('每行都有 labelKey 与 spec', v1.rows.every((r) => typeof r.labelKey === 'string' && r.spec && typeof r.spec.kind === 'string'))
  ok('caption 左右都有', !!v1.caption.left && !!v1.caption.right)
  ok('ring.fraction 是 0..1 的数', v1.ring.fraction >= 0 && v1.ring.fraction <= 1, v1.ring.fraction)

  console.log('\n=== 形状必须稳定（UI 靠它渲染）===')
  const KEYS = ['mode', 'meta', 'dial', 'ring', 'caption', 'rows', 'compact', 'balanceRing', 'tone', 'alarm']
  eq('顶层键集合', Object.keys(v1).sort(), KEYS.slice().sort())

  console.log('\n=== 序列化后可直接喂给浏览器 ===')
  const json = JSON.parse(JSON.stringify(v1))
  eq('可 JSON 往返', json.mode, 'metered')
  ok('不含 undefined（JSON 会丢字段）', !JSON.stringify(v1).includes('undefined'))

  console.log('\n=== 订阅制模型：给一个假的 mini max 会话 ===')
  // 直接调 buildSubscriptionView 路径：伪造 state 里的 model
  const svc2 = new CostGaugeService(fakeCtx, {})
  svc2.state = async () => ({
    balance: { total: 1 }, cost: { model: 'minimax-m3', cost: 0, turnCost: 0 },
    rate: { peak: false, nextSwitchAt: Date.now() + 3600_000, periodSeconds: 7200 },
    holidayData: { years: [2026], yearCovered: true }, threshold: 10, version: '9.9.9',
  })
  svc2.minimaxView = async () => ({
    ok: true, enabled: true, exhausted: false, warning: false,
    windows: {
      five: { unlimited: false, usedPercent: 40, startAt: Date.now() - 1e6, resetsAt: Date.now() + 4e6 },
      week: { unlimited: false, usedPercent: 20, startAt: Date.now(), resetsAt: Date.now() + 6e8 },
    },
  })
  const v2 = await svc2.gaugeView('sess-1')
  eq('mode', v2.mode, 'subscription')
  eq('dial.kind', v2.dial.kind, 'window')
  ok('使用期：橙红弧从已用处画到末端', v2.dial.fromDeg > 0 && v2.dial.toDeg === 180 && v2.dial.color === '#e0432d',
     { from: v2.dial.fromDeg, to: v2.dial.toDeg, color: v2.dial.color })
  eq('rows[0] labelKey', v2.rows[0].labelKey, 'minimaxRowFive')
  eq('rows[0] 剩余 60%', v2.rows[0].spec, { kind: 'percent', value: 60 })
  eq('订阅制仍保留余额内环（既有 UI）', v2.balanceRing, { total: 1, threshold: 10 })
  eq('meta.version 透传', v2.meta.version, '9.9.9')

  console.log('\n=== 按量计费模型不应去拉额度接口 ===')
  let quotaCalled = false
  const svc3 = new CostGaugeService(fakeCtx, {})
  svc3.minimaxView = async () => { quotaCalled = true; return null }
  await svc3.gaugeView(undefined)
  eq('未调用 minimaxView', quotaCalled, false)

  console.log(`\n${pass} passed, ${fail} failed`)
} finally {
  rmSync(TMP, { recursive: true, force: true })
}
process.exit(fail === 0 ? 0 : 1)