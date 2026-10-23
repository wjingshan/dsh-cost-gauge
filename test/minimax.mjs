/**
 * MiniMax 额度模块测试。
 * 关键：用真实接口响应做夹具，并覆盖边界（不限量 / 缺失窗口 / 认证失败 / 非法域名）。
 */
import {
  normalizeOrigin, windowsFromRecord, pickModelRow, parseResponse, queryQuota, msUntilReset,
} from '../lib/minimax.js'

let pass = 0, fail = 0
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log(`  ok  ${label}`) }
  else { fail++; console.error(`  FAIL ${label}${extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''}`) }
}
const eq = (label, got, want) => ok(label, JSON.stringify(got) === JSON.stringify(want), { got, want })

/* ---- 真实响应（2026-10-23 实测，已核对 Key 未泄漏） ---- */
const REAL = {
  model_remains: [{
    start_time: 1792758657380,
    end_time: 1792776657380,
    remains_time: 15059162,
    current_interval_total_count: 0,
    current_interval_usage_count: 0,
    model_name: 'general',
    current_weekly_total_count: 0,
    current_weekly_usage_count: 0,
    weekly_start_time: 1792733373230,
    weekly_end_time: 1793338173230,
    weekly_remains_time: 576575012,
    current_interval_status: 1,
    current_interval_remaining_percent: 71,
    current_weekly_status: 1,
    current_weekly_remaining_percent: 87,
  }],
  base_resp: { status_code: 0, status_msg: 'success' },
}

console.log('=== normalizeOrigin ===')
eq('空 -> null', normalizeOrigin(''), null)
eq('裸域名 -> null', normalizeOrigin('www.minimax.cn'), null)
eq('https 带尾斜杠 -> 去尾斜杠', normalizeOrigin('https://www.minimax.cn/'), 'https://www.minimax.cn')
eq('带端口保留', normalizeOrigin('https://quota.example:8443'), 'https://quota.example:8443')
eq('http 拒绝', normalizeOrigin('http://www.minimax.cn'), null)
eq('带路径拒绝', normalizeOrigin('https://www.minimax.cn/v1/token_plan/remains'), null)
eq('带查询拒绝', normalizeOrigin('https://www.minimax.cn?a=1'), null)
eq('带凭证拒绝', normalizeOrigin('https://u:p@www.minimax.cn'), null)

console.log('\n=== windowsFromRecord（真实响应）===')
const w = windowsFromRecord(REAL.model_remains[0])
eq('5h 已用百分比 = 100 - 71', w.five.usedPercent, 29)
eq('5h 非不限量', w.five.unlimited, false)
eq('5h 重置时刻', w.five.resetsAt, 1792776657380)
eq('7d 已用百分比 = 100 - 87', w.week.usedPercent, 13)
eq('7d 重置时刻', w.week.resetsAt, 1793338173230)

console.log('\n=== 边界：status=3 不限量 ===')
const un = windowsFromRecord({ current_interval_status: 3, current_weekly_status: 1, current_weekly_remaining_percent: 50 })
eq('5h 无限量', un.five.unlimited, true)
eq('5h 无限量无百分比', un.five.usedPercent, null)
eq('7d 仍算百分比', un.week.usedPercent, 50)

console.log('\n=== 边界：缺失窗口绝不推断为无限量 ===')
const missing = windowsFromRecord({ model_name: 'general' })
eq('无字段 -> 无窗口', Object.keys(missing), [])
ok('不是 unlimited', missing.five === undefined && missing.week === undefined)

console.log('\n=== 边界：计数制兜底（无 percent 时）===')
const counted = windowsFromRecord({
  current_interval_total_count: 200, current_interval_usage_count: 50,
  current_weekly_total_count: 1000, current_weekly_usage_count: 250,
})
eq('5h 用计数算已用%', counted.five.usedPercent, 25)
eq('7d 用计数算已用%', counted.week.usedPercent, 25)

console.log('\n=== 边界：percent 优先于计数 ===')
const both = windowsFromRecord({
  current_interval_remaining_percent: 71, current_interval_total_count: 0, current_interval_usage_count: 0,
})
eq('total=0 时仍用 percent', both.five.usedPercent, 29)

console.log('\n=== pickModelRow ===')
eq('优先 general', pickModelRow([{ model_name: 'video', current_interval_status: 3 }, { model_name: 'general', current_interval_remaining_percent: 50 }])?.model_name, 'general')
eq('跳过 video 无限行', pickModelRow([{ model_name: 'video', current_interval_status: 3 }, { model_name: 'MiniMax-M3', current_interval_remaining_percent: 40 }])?.model_name, 'MiniMax-M3')
eq('空数组 -> null', pickModelRow([]), null)
eq('非数组 -> null', pickModelRow(null), null)

console.log('\n=== parseResponse ===')
eq('真实响应 ok', parseResponse(REAL).ok, true)
eq('业务错误 1004', parseResponse({ base_resp: { status_code: 1004, status_msg: 'login fail' } }), { ok: false, message: 'login fail', code: 1004 })
eq('无窗口', parseResponse({ base_resp: { status_code: 0 }, model_remains: [{ model_name: 'general' }] }).ok, false)
eq('null 输入', parseResponse(null), null)
ok('平铺形态可解析', parseResponse({ current_interval_remaining_percent: 60, current_interval_status: 1 }).ok === true)

console.log('\n=== msUntilReset ===')
eq('未到期', msUntilReset({ unlimited: false, resetsAt: 1000 }, 400), 600)
eq('已过期夹到 0', msUntilReset({ unlimited: false, resetsAt: 400 }, 1000), 0)
eq('不限量 -> null', msUntilReset({ unlimited: true }, 500), null)
eq('无重置时刻 -> null', msUntilReset({ unlimited: false }, 500), null)

console.log('\n=== queryQuota：无 Key / 非法域名 ===')
const noKey = await queryQuota('')
eq('无 Key', [noKey.ok, noKey.kind], [false, 'no-key'])
const badOrigin = await queryQuota('sk-test', { origin: 'http://evil.example' })
eq('非法域名', [badOrigin.ok, badOrigin.kind], [false, 'bad-origin'])

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)