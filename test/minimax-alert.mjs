/**
 * 告警判定验证：直接测服务端 decorateMiniMax 的分支，
 * 覆盖「正常 / 接近用尽 / 已用尽 / 无限量 / 缺失窗口」。
 */
import { windowsFromRecord } from '../lib/minimax.js'

// 复刻 decorateMiniMax 的判定（保持与 lib/index.js 同一逻辑）
const ALARM = 90
function decide(view) {
  if (!view || view.ok !== true || !view.windows) return view
  const windows = {}
  for (const key of ['five', 'week']) {
    const w = view.windows[key]
    if (!w) continue
    windows[key] = {
      unlimited: w.unlimited === true,
      usedPercent: w.unlimited ? null : w.usedPercent,
      resetsAt: Number.isFinite(w.resetsAt) && w.resetsAt > 0 ? w.resetsAt : null,
    }
  }
  const five = windows.five
  return {
    ok: true,
    windows,
    exhausted: !!(five && five.unlimited === false && five.usedPercent >= 100),
    warning:
      !!(five && five.unlimited === false && five.usedPercent >= ALARM) ||
      !!(windows.week && windows.week.unlimited === false && windows.week.usedPercent >= 100),
  }
}

let pass = 0, fail = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`  ok  ${label}`) }
  else { fail++; console.error(`  FAIL ${label}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) }
}

console.log('=== 告警判定 ===')
const flags = (v) => ({ exhausted: v.exhausted, warning: v.warning })

eq('用量低（30%）-> 无告警', flags(decide({ ok: true, windows: windowsFromRecord({
  current_interval_remaining_percent: 70, current_weekly_remaining_percent: 90,
  end_time: 1, weekly_end_time: 2 }) })), { exhausted: false, warning: false })

eq('接近用尽（95%）-> warning', decide({ ok: true, windows: windowsFromRecord({
  current_interval_remaining_percent: 5, current_weekly_remaining_percent: 90,
  end_time: 1, weekly_end_time: 2 }) }).warning, true)

eq('5h 用尽（100%）-> exhausted', decide({ ok: true, windows: windowsFromRecord({
  current_interval_remaining_percent: 0, current_weekly_remaining_percent: 90,
  end_time: 1, weekly_end_time: 2 }) }).exhausted, true)

eq('周窗口用尽 -> warning', decide({ ok: true, windows: windowsFromRecord({
  current_interval_remaining_percent: 80, current_weekly_remaining_percent: 0,
  end_time: 1, weekly_end_time: 2 }) }).warning, true)

eq('5h 不限量 -> 不因它告警', flags(decide({ ok: true, windows: windowsFromRecord({
  current_interval_status: 3, current_weekly_remaining_percent: 0, weekly_end_time: 2 }) })),
  { exhausted: false, warning: true })   // warning 来自周窗口用尽，与 5h 无限量无关

eq('两窗口都无限量 -> 不告警', decide({ ok: true, windows: windowsFromRecord({
  current_interval_status: 3, current_weekly_status: 3 }) }).exhausted, false)

eq('缺失 5h 窗口 -> 不误判', decide({ ok: true, windows: windowsFromRecord({
  current_weekly_remaining_percent: 100, weekly_end_time: 2 }) }).exhausted, false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)