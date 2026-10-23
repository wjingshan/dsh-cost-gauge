/**
 * 凭据与账本隔离测试。
 *
 * 复现真实事故：宿主侧每 15 秒把整份账本对象序列化写回。
 * 若凭据存在账本里，任何一个实例的内存快照没有它，下次记账就把它抹掉
 * （实测中 desktop 实例就这样清掉了刚从设置面板存下的 Key）。
 *
 * 这里直接模拟「另一个实例用不含 Key 的账本整份覆盖落盘」，断言 Key 不受影响。
 */
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const TMP = mkdtempSync(path.join(tmpdir(), 'dsg-sec-'))
process.env.DSH_COST_GAUGE_DIR = TMP

const { CostGaugeService } = await import('../lib/index.js')
const ledger = await import('../lib/ledger.js')

let pass = 0, fail = 0
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log(`  ok  ${label}`) }
  else { fail++; console.error(`  FAIL ${label}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}
const eq = (label, got, want) => ok(label, JSON.stringify(got) === JSON.stringify(want), { got, want })

const fakeCtx = { get: () => undefined }
const KEY = 'sk-cp-' + 'z'.repeat(40)

try {
  console.log('=== 存 Key ===')
  const svc = new CostGaugeService(fakeCtx, {})
  let r = await svc.setPrefs({ minimaxKey: KEY })
  eq('保存成功', r.ok, true)
  eq('Key 已解析', await svc.resolveMiniMaxKey(), KEY)

  console.log('\n=== 凭据文件独立存在 ===')
  const secFile = ledger.SECRETS_FILE
  ok('minimax.json 已创建', (() => { try { readFileSync(secFile); return true } catch { return false } })())
  // 账本此时可能还没落盘；先写一次再检查它里面不含 Key
  await ledger.saveLedger(ledger.emptyLedger())
  const ledgerRaw = JSON.parse(readFileSync(ledger.LEDGER_FILE, 'utf8'))
  ok('ledger.json 的 prefs 不含 Key', !JSON.stringify(ledgerRaw.prefs || {}).includes('zzzz'))

  console.log('\n=== 关键：模拟另一实例用旧快照整份覆写账本 ===')
  // 这就是宿主侧记账做的事：拿一个不含凭据的 ledger 对象，整份写回
  const stale = ledger.emptyLedger()
  stale.days['2026-10-23'] = { std: 1, peak: 0 }
  await ledger.saveLedger(stale)

  eq('记账覆写后 Key 仍可解析', await svc.resolveMiniMaxKey(), KEY)
  const p = await svc.prefs()
  eq('prefs 仍报告已配置', p.minimaxKeySet, true)

  console.log('\n=== 清除仍然有效（不能被"合并"救回来）===')
  await svc.setPrefs({ minimaxKey: '' })
  eq('清除后解析为 undefined', await svc.resolveMiniMaxKey(), undefined)
  await ledger.saveLedger(ledger.emptyLedger())
  eq('记账覆写后仍是未配置', await svc.resolveMiniMaxKey(), undefined)

  console.log('\n=== origin 同样独立 ===')
  await svc.setPrefs({ minimaxOrigin: 'https://quota.example:8443' })
  await ledger.saveLedger(ledger.emptyLedger())
  eq('记账覆写后 origin 保留', await svc.resolveMiniMaxOrigin(), 'https://quota.example:8443')

  console.log('\n=== 账本自身功能未被影响 ===')
  const l2 = await ledger.loadLedger()
  eq('excelDir 字段仍在', typeof l2.prefs.excelDir, 'string')
  ok('days 结构完好', typeof l2.days === 'object')

  console.log(`\n${pass} passed, ${fail} failed`)
} finally {
  rmSync(TMP, { recursive: true, force: true })
}
process.exit(fail === 0 ? 0 : 1)