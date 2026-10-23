/**
 * 服务层测试：偏好读写、Key 校验、Key 不下发。
 * 必须在 import lib/index.js 之前设好 DSH_COST_GAUGE_DIR，否则会读写真实账本。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const TMP = mkdtempSync(path.join(tmpdir(), 'dsg-test-'))
process.env.DSH_COST_GAUGE_DIR = TMP

const { CostGaugeService } = await import('../lib/index.js')

let pass = 0, fail = 0
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log(`  ok  ${label}`) }
  else { fail++; console.error(`  FAIL ${label}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}
const eq = (label, got, want) => ok(label, JSON.stringify(got) === JSON.stringify(want), { got, want })

/** 最小 ctx：get() 一律返回 undefined，service 内部都有 try/catch 兜住。 */
const fakeCtx = { get: () => undefined }

function freshService() {
  return new CostGaugeService(fakeCtx, {})
}

try {
  console.log('=== 初始状态 ===')
  let svc = freshService()
  let p = await svc.prefs()
  eq('无 Key 时 minimaxKeySet=false', p.minimaxKeySet, false)
  eq('无 origin', p.minimaxOrigin, '')
  ok('prefs 不含 Key 字段', !('minimaxKey' in p), Object.keys(p))

  console.log('\n=== 写入 Key ===')
  const KEY = 'sk-cp-' + 'a'.repeat(40)
  let r = await svc.setPrefs({ minimaxKey: KEY })
  eq('保存成功', r.ok, true)
  eq('回报 minimaxKeySet=true', r.minimaxKeySet, true)
  ok('回报里没有 Key 原文', !JSON.stringify(r).includes(KEY))

  p = await svc.prefs()
  eq('重读 prefs: minimaxKeySet=true', p.minimaxKeySet, true)
  ok('prefs 仍未泄露 Key 原文', !JSON.stringify(p).includes(KEY))

  console.log('\n=== Key 要能真正被解析出来 ===')
  const resolved = await svc.resolveMiniMaxKey()
  eq('resolveMiniMaxKey 返回账本里的 Key', resolved, KEY)

  console.log('\n=== 字段隔离：只传 minimaxKey 不能清掉 excelDir ===')
  const fakeDir = path.join(TMP, 'excel-out')
  await svc.setPrefs({ excelDir: fakeDir })
  p = await svc.prefs()
  eq('excelDir 已设置', p.excelDir, fakeDir)
  await svc.setPrefs({ minimaxKey: 'sk-cp-' + 'b'.repeat(40) })
  p = await svc.prefs()
  eq('改 Key 后 excelDir 保留', p.excelDir, fakeDir)

  console.log('\n=== 字段隔离：只传 excelDir 不能清掉 Key ===')
  await svc.setPrefs({ excelDir: '' })
  p = await svc.prefs()
  eq('清 excelDir 后 Key 仍在', p.minimaxKeySet, true)

  console.log('\n=== Key 格式校验 ===')
  r = await svc.setPrefs({ minimaxKey: 'not-a-key' })
  eq('非法 Key 被拒', r.ok, false)
  ok('拒绝理由提到格式', /格式/.test(String(r.error)), r.error)
  p = await svc.prefs()
  eq('拒绝后旧 Key 未被破坏', p.minimaxKeySet, true)

  r = await svc.setPrefs({ minimaxKey: 'sk-abc' })
  eq('过短 Key 被拒', r.ok, false)

  console.log('\n=== origin 校验 ===')
  r = await svc.setPrefs({ minimaxOrigin: 'http://evil.example' })
  eq('http 域名被拒', r.ok, false)
  r = await svc.setPrefs({ minimaxOrigin: 'https://www.minimax.cn/some/path' })
  eq('带路径被拒', r.ok, false)
  r = await svc.setPrefs({ minimaxOrigin: 'https://quota.example:8443' })
  eq('合法 https 域名接受', r.ok, true)
  eq('域名已存储', r.minimaxOrigin, 'https://quota.example:8443')
  eq('resolveMiniMaxOrigin 读到账本值', await svc.resolveMiniMaxOrigin(), 'https://quota.example:8443')

  r = await svc.setPrefs({ minimaxOrigin: 'https://www.minimax.cn/' })
  eq('尾斜杠被规范化', r.minimaxOrigin, 'https://www.minimax.cn')

  console.log('\n=== 清除 ===')
  r = await svc.setPrefs({ minimaxOrigin: '' })
  eq('清 origin', r.minimaxOrigin, '')
  r = await svc.setPrefs({ minimaxKey: '' })
  eq('清 Key', r.minimaxKeySet, false)
  eq('清 Key 后解析为 undefined', await svc.resolveMiniMaxKey(), undefined)

  console.log('\n=== 改配置要丢缓存 ===')
  svc = freshService()
  svc.minimaxCache = { ok: true, stale: true }
  svc.minimaxCachedAt = Date.now()
  await svc.setPrefs({ minimaxKey: 'sk-cp-' + 'c'.repeat(40) })
  eq('写 Key 后缓存被清', svc.minimaxCache, undefined)
  eq('缓存时间归零', svc.minimaxCachedAt, 0)

  svc.minimaxCache = { ok: true, stale: true }
  await svc.setPrefs({ excelDir: '' })
  ok('只改 excelDir 不清额度缓存', svc.minimaxCache !== undefined)

  console.log('\n=== 权限优先级：账本 > 环境变量 ===')
  svc = freshService()
  const envKey = 'sk-cp-' + 'e'.repeat(40)
  process.env.MINIMAX_API_KEY = envKey
  // 先确保账本里没有 Key，才能验证环境变量回退
  await svc.setPrefs({ minimaxKey: '' })
  eq('无账本 Key 时用环境变量', await svc.resolveMiniMaxKey(), envKey)
  const ledgerKey = 'sk-cp-' + 'd'.repeat(40)
  await svc.setPrefs({ minimaxKey: ledgerKey })
  eq('账本优先于环境变量', await svc.resolveMiniMaxKey(), ledgerKey)
  delete process.env.MINIMAX_API_KEY

  console.log(`\n${pass} passed, ${fail} failed`)
} finally {
  rmSync(TMP, { recursive: true, force: true })
}
process.exit(fail === 0 ? 0 : 1)