/** 真实接口端到端验证（需要 MINIMAX_API_KEY）。 */
import { queryQuota, msUntilReset } from '../lib/minimax.js'

const key = process.env.MINIMAX_API_KEY || ''
if (!key) { console.log('跳过：MINIMAX_API_KEY 未设置'); process.exit(0) }

const r = await queryQuota(key)
console.log('ok      :', r.ok)
console.log('endpoint:', r.endpoint)
console.log('model   :', r.modelName ?? '-')
if (!r.ok) { console.log('error   :', r.error, '(', r.kind, ')'); process.exit(1) }

const h = (ms) => (ms == null ? '—' : (ms / 3600000).toFixed(2) + ' h')
for (const [name, label] of [['five', '5 小时窗口'], ['week', '周窗口']]) {
  const w = r.windows[name]
  if (!w) { console.log(`${label}: 接口未返回（不推断）`); continue }
  const pct = w.unlimited ? '∞ 不限量' : `已用 ${w.usedPercent}% / 剩余 ${100 - w.usedPercent}%`
  console.log(`${label}: ${pct}   距重置 ${h(msUntilReset(w))}   重置于 ${w.resetsAt ? new Date(w.resetsAt).toISOString().replace('T',' ').slice(0,16) + ' UTC' : '—'}`)
}
console.log('\n端到端 OK')