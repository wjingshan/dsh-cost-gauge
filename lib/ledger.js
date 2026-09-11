/**
 * dsh-cost-gauge 宿主侧记账模块 —— 回放会话日志，按「事件时刻的费率 + 当时的模型」逐笔计价。
 *
 * 为什么这样做：`tokenUsage` 投影只给会话累计值，用「累计 token × 当前费率」会在进入高峰时
 * 把整段历史用量按高峰价重算（表现就是费用翻倍）。这里改为读取会话事件日志：
 *   - 每个 `assistant/message` / `assistant/attempt` 自带 usage 与 `time`；
 *   - 按该事件发生时刻判断峰谷 → 分别计价后累加（空闲段按空闲价、高峰段按高峰价）；
 *   - `request/header` 事件用于还原当时的模型；
 *   - `llm/retry-started` + 相同 turn/step 的重复样本按官方投影口径「替换」而不是累加；
 *   - 日志保留完整历史，因此每日记录从会话开始就有，不依赖插件安装时间。
 *
 * 纯 ESM、零第三方依赖：只用 node: 内置模块。
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'

/** 数据目录：~/.dsh/cost-gauge/ */
export const LEDGER_DIR = path.join(os.homedir(), '.dsh', 'cost-gauge')
export const LEDGER_FILE = path.join(LEDGER_DIR, 'ledger.json')

export function emptyLedger() {
  return { version: 2, days: {}, sessions: {}, prefs: { excelDir: '', lastExport: '' } }
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== 2) return emptyLedger()
  const base = emptyLedger()
  if (raw.days && typeof raw.days === 'object') base.days = raw.days
  if (raw.sessions && typeof raw.sessions === 'object') base.sessions = raw.sessions
  if (raw.prefs && typeof raw.prefs === 'object') base.prefs = { ...base.prefs, ...raw.prefs }
  return base
}

export async function loadLedger() {
  try {
    const raw = await fs.readFile(LEDGER_FILE, 'utf8')
    return normalize(JSON.parse(raw))
  } catch {
    return emptyLedger()
  }
}

/** 原子写：先写临时文件再 rename，避免半截文件。 */
export async function saveLedger(ledger) {
  await fs.mkdir(LEDGER_DIR, { recursive: true })
  const tmp = LEDGER_FILE + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(ledger), 'utf8')
  await fs.rename(tmp, LEDGER_FILE)
}

/** 北京时间的日期键（YYYY-MM-DD）。 */
export function dayKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

/** 费用换算（人民币）：缓存未命中 / 缓存命中 / 输出 三个桶；缓存写入不单独计费。 */
export function costOfUsage(usage, price) {
  const miss = (Number(usage && usage.miss) || 0) / 1e6 * price.miss
  const hit = (Number(usage && usage.hit) || 0) / 1e6 * price.hit
  const out = (Number(usage && usage.out) || 0) / 1e6 * price.output
  return miss + hit + out
}

/** 模型分桶：pro / vision / 其它（flash）。 */
export function modelKeyOf(modelId) {
  const lower = String(modelId || '').toLowerCase()
  if (lower.includes('pro')) return 'pro'
  if (lower.includes('vision')) return 'vision'
  return 'flash'
}

/** 原始 usage 样本 → 计费三桶（与 dsh-token-meter 的 bucketsFrom 一致）。 */
export function bucketsFromUsage(sample) {
  return {
    miss: Number(sample && sample.inputTokens) || 0,
    hit: Number(sample && sample.cacheReadTokens) || 0,
    out: Number(sample && sample.outputTokens) || 0,
  }
}

/** 取事件里的 usage 样本（与 dsh-token-meter 的 usageOf 口径一致）。 */
export function usageOfEvent(event) {
  if (!event || !event.data) return undefined
  if (event.type === 'assistant/message' && event.data.usage !== undefined) return event.data.usage
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  const stream = event.data.stream
  if (!Array.isArray(stream)) return undefined
  for (let i = stream.length - 1; i >= 0; i--) {
    const chunk = stream[i]
    if (chunk && chunk.usage !== undefined) return chunk.usage
  }
  return undefined
}

/** 取（必要时创建）一个会话的账目状态。 */
export function sessionState(ledger, sessionId) {
  let st = ledger.sessions[sessionId]
  if (!st) {
    st = ledger.sessions[sessionId] = {
      cursor: 0,
      totalCost: 0,
      totalAtReset: 0,
      resetAt: null,
      model: '',
      lastSlot: null,
    }
  }
  if (typeof st.cursor !== 'number') st.cursor = 0
  if (typeof st.totalCost !== 'number') st.totalCost = 0
  if (typeof st.totalAtReset !== 'number') st.totalAtReset = 0
  return st
}

function dayBucket(ledger, sessionId, key) {
  const bySession = ledger.days[sessionId] || (ledger.days[sessionId] = {})
  return bySession[key] || (bySession[key] = { std: 0, peak: 0, pro: 0, flash: 0, vision: 0 })
}

function clampDay(day) {
  for (const k of ['std', 'peak', 'pro', 'flash', 'vision']) {
    if (Number(day[k]) < 0) day[k] = 0
  }
}

/** 撤销 lastSlot 已计入的费用（重试替换时使用）。 */
function dropSlot(ledger, sessionId, st) {
  const slot = st.lastSlot
  st.lastSlot = null
  if (!slot || !slot.cost) return
  st.totalCost = Math.max(0, st.totalCost - slot.cost)
  const bySession = ledger.days[sessionId]
  const day = bySession && slot.dayKey ? bySession[slot.dayKey] : null
  if (day) {
    if (slot.band === 'peak') day.peak -= slot.cost
    else if (slot.band === 'std') day.std -= slot.cost
    if (slot.modelKey && day[slot.modelKey] !== undefined) day[slot.modelKey] -= slot.cost
    clampDay(day)
  }
}

/**
 * 折叠一批会话事件（只传未折叠的新事件即可）。
 * @param {object} ledger
 * @param {object} opts
 * @param {string} opts.sessionId
 * @param {Array} opts.events 事件数组（按 seq 升序）
 * @param {(model:string, timeMs:number) => {miss:number,hit:number,output:number}} opts.priceAt 事件时刻的价目
 * @param {(timeMs:number) => boolean} opts.peakAt 事件时刻是否高峰
 * @returns {{folded:number, added:number}}
 */
export function foldEvents(ledger, { sessionId, events, priceAt, peakAt }) {
  if (!sessionId || !Array.isArray(events) || events.length === 0) return { folded: 0, added: 0 }
  const st = sessionState(ledger, sessionId)
  let folded = 0
  let added = 0

  for (const event of events) {
    if (!event || typeof event !== 'object') continue
    const seq = Number(event.seq)
    if (Number.isFinite(seq) && seq < st.cursor) continue
    folded++

    if (event.type === 'request/header') {
      const model = event.data && event.data.header && event.data.header.config && event.data.header.config.model
      if (model) st.model = String(model)
      continue
    }

    if (event.type === 'llm/retry-started') {
      const turn = event.data && event.data.turn
      const step = event.data && event.data.step
      if (st.lastSlot && st.lastSlot.turn === turn && st.lastSlot.step === step) dropSlot(ledger, sessionId, st)
      continue
    }

    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue
    const sample = usageOfEvent(event)
    if (!sample) continue
    const turn = event.data && event.data.turn
    const step = event.data && event.data.step

    // 同一 turn/step 的新样本替换旧样本（官方投影口径）
    if (st.lastSlot && st.lastSlot.turn === turn && st.lastSlot.step === step) dropSlot(ledger, sessionId, st)

    const buckets = bucketsFromUsage(sample)
    const time = Number(event.time) || Date.now()
    const peak = !!peakAt(time)
    const price = priceAt(st.model, time)
    const cost = costOfUsage(buckets, price)

    if (cost > 0) {
      const key = dayKey(new Date(time))
      const day = dayBucket(ledger, sessionId, key)
      if (peak) day.peak += cost
      else day.std += cost
      const mk = modelKeyOf(st.model)
      day[mk] = (Number(day[mk]) || 0) + cost
      st.totalCost += cost
      added += cost
      st.lastSlot = { turn, step, dayKey: key, band: peak ? 'peak' : 'std', modelKey: mk, cost }
    } else {
      st.lastSlot = { turn, step, dayKey: null, band: null, modelKey: null, cost: 0 }
    }
  }

  const last = events[events.length - 1]
  const lastSeq = Number(last && last.seq)
  st.cursor = Number.isFinite(lastSeq) ? lastSeq + 1 : st.cursor + events.length
  return { folded, added }
}

/** 会话花费归零：记住当前累计，之后只显示新增部分。 */
export function resetSession(ledger, { sessionId, now = new Date() }) {
  if (!sessionId) return { resetAt: null }
  const st = sessionState(ledger, sessionId)
  st.totalAtReset = st.totalCost
  st.resetAt = now.getTime()
  return { resetAt: st.resetAt }
}

/** 某个会话的当前视图：归零时刻 + 归零后花费 + 每日记录（升序）。 */
export function recordsView(ledger, sessionId) {
  const st = ledger.sessions[sessionId]
  const bySession = ledger.days[sessionId] || {}
  const days = Object.keys(bySession).sort().map((date) => {
    const d = bySession[date]
    const std = Number(d.std) || 0
    const peak = Number(d.peak) || 0
    const pro = Number(d.pro) || 0
    const flash = Number(d.flash) || 0
    const vision = Number(d.vision) || 0
    return { date, std, peak, pro, flash, vision, total: std + peak }
  })
  const totalCost = st ? Number(st.totalCost) || 0 : 0
  const totalAtReset = st ? Number(st.totalAtReset) || 0 : 0
  return {
    resetAt: st && st.resetAt ? st.resetAt : null,
    sinceReset: Math.max(0, totalCost - totalAtReset),
    days,
  }
}

/** 全部会话的合并视图：同一天的桶跨会话相加。 */
export function recordsAllView(ledger) {
  const merged = {}
  const sessionIds = Object.keys(ledger.days || {})
  for (const sid of sessionIds) {
    const bySession = ledger.days[sid] || {}
    for (const date of Object.keys(bySession)) {
      const d = bySession[date]
      const day = merged[date] || (merged[date] = { date, std: 0, peak: 0, pro: 0, flash: 0, vision: 0, total: 0 })
      const std = Number(d.std) || 0
      const peak = Number(d.peak) || 0
      day.std += std
      day.peak += peak
      day.total += std + peak
      day.pro += Number(d.pro) || 0
      day.flash += Number(d.flash) || 0
      day.vision += Number(d.vision) || 0
    }
  }
  let sinceReset = 0
  for (const sid of Object.keys(ledger.sessions || {})) {
    const st = ledger.sessions[sid]
    sinceReset += Math.max(0, (Number(st.totalCost) || 0) - (Number(st.totalAtReset) || 0))
  }
  return {
    resetAt: null,
    sinceReset,
    days: Object.keys(merged).sort().map((k) => merged[k]),
    sessionCount: sessionIds.length,
  }
}

/** 文件名安全化（保留中文/空格/下划线/连字符，去掉 Windows 非法字符）。 */
export function safeFileName(name) {
  return String(name || '记录')
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || '记录'
}

/** 文件名安全化（用于时段标签，空白转连字符）。 */
export function sanitizeFileName(name) {
  return String(name || '记录')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || '记录'
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ===== 最小 XLSX（OOXML）写出器：零第三方依赖 =====
// xlsx 本质是一个 zip 包，这里手写 ZIP（STORE 不压缩）+ 标准 OOXML 部件。
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    table[i] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

/** 把 [{name, data}] 打包成 zip（STORE，无压缩）。 */
function zipStore(entries) {
  const enc = new TextEncoder()
  const chunks = []
  const central = []
  let offset = 0
  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name)
    const data = entry.data
    const crc = crc32(data)
    const size = data.length
    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // UTF-8 文件名
    lv.setUint16(8, 0, true) // method = store
    lv.setUint16(10, 0, true)
    lv.setUint16(12, 0, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, size, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    chunks.push(local, data)
    central.push({ nameBytes, crc, size, offset })
    offset += local.length + size
  }
  const cdChunks = []
  let cdSize = 0
  for (const c of central) {
    const h = new Uint8Array(46 + c.nameBytes.length)
    const v = new DataView(h.buffer)
    v.setUint32(0, 0x02014b50, true)
    v.setUint16(4, 20, true)
    v.setUint16(6, 20, true)
    v.setUint16(8, 0x0800, true)
    v.setUint16(10, 0, true)
    v.setUint16(12, 0, true)
    v.setUint16(14, 0, true)
    v.setUint32(16, c.crc, true)
    v.setUint32(20, c.size, true)
    v.setUint32(24, c.size, true)
    v.setUint16(28, c.nameBytes.length, true)
    v.setUint16(30, 0, true)
    v.setUint16(32, 0, true)
    v.setUint16(34, 0, true)
    v.setUint16(36, 0, true)
    v.setUint32(38, 0, true)
    v.setUint32(42, c.offset, true)
    h.set(c.nameBytes, 46)
    cdChunks.push(h)
    cdSize += h.length
  }
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, central.length, true)
  ev.setUint16(10, central.length, true)
  ev.setUint32(12, cdSize, true)
  ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + cdSize + 22)
  let p = 0
  for (const c of chunks) { out.set(c, p); p += c.length }
  for (const c of cdChunks) { out.set(c, p); p += c.length }
  out.set(eocd, p)
  return out
}

function colName(n) {
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function cellXml(ref, value) {
  if (typeof value === 'number' && Number.isFinite(value)) return '<c r="' + ref + '"><v>' + value + '</v></c>'
  if (value === undefined || value === null || value === '') return '<c r="' + ref + '"/>'
  return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(value) + '</t></is></c>'
}

/** 一个工作表（可选首行说明，合并到表头宽度）。 */
function sheetPart(head, rows, note) {
  const lines = []
  const merges = []
  let rowIdx = 1
  if (note) {
    lines.push('<row r="1">' + cellXml('A1', note) + '</row>')
    merges.push('A1:' + colName(Math.max(1, head.length)) + '1')
    rowIdx = 2
  }
  lines.push('<row r="' + rowIdx + '">' + head.map((h, i) => cellXml(colName(i + 1) + rowIdx, h)).join('') + '</row>')
  rowIdx++
  for (const row of rows) {
    lines.push('<row r="' + rowIdx + '">' + row.map((v, i) => cellXml(colName(i + 1) + rowIdx, v)).join('') + '</row>')
    rowIdx++
  }
  const xmlHeader = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  return xmlHeader + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData>' + lines.join('') + '</sheetData>' +
    (merges.length
      ? '<mergeCells count="' + merges.length + '">' + merges.map((r) => '<mergeCell ref="' + r + '"/>').join('') + '</mergeCells>'
      : '') +
    '</worksheet>'
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'

function contentTypesPart(count) {
  let overrides = ''
  for (let i = 1; i <= count; i++) {
    overrides += '<Override PartName="/xl/worksheets/sheet' + i +
      '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  }
  return XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    overrides +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>'
}

function rootRelsPart() {
  return XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>'
}

function workbookPart(sheetNames) {
  return XML_HEAD + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheetNames.map((n, i) => '<sheet name="' + xmlEscape(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') +
    '</sheets></workbook>'
}

function workbookRelsPart(count) {
  let rels = ''
  for (let i = 1; i <= count; i++) {
    rels += '<Relationship Id="rId' + i +
      '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + i + '.xml"/>'
  }
  rels += '<Relationship Id="rId' + (count + 1) +
    '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
  return XML_HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + rels + '</Relationships>'
}

function stylesPart() {
  return XML_HEAD + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
    '</styleSheet>'
}

/**
 * 生成真正的 .xlsx（OOXML）：两个工作表（按峰谷拆分 / 按模型拆分），
 * 首行是同一句导出说明。零第三方依赖（手写 zip + OOXML 部件）。
 * @returns {Uint8Array}
 */
export function buildXlsx({ note, bandHead, bandRows, modelHead, modelRows }) {
  const enc = new TextEncoder()
  const sheets = [
    { name: '按峰谷拆分', xml: sheetPart(bandHead, bandRows, note) },
    { name: '按模型拆分', xml: sheetPart(modelHead, modelRows, note) },
  ]
  const entries = [
    { name: '[Content_Types].xml', data: enc.encode(contentTypesPart(sheets.length)) },
    { name: '_rels/.rels', data: enc.encode(rootRelsPart()) },
    { name: 'xl/workbook.xml', data: enc.encode(workbookPart(sheets.map((s) => s.name))) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(workbookRelsPart(sheets.length)) },
    { name: 'xl/styles.xml', data: enc.encode(stylesPart()) },
  ]
  sheets.forEach((s, i) => entries.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: enc.encode(s.xml) }))
  return zipStore(entries)
}

/** 写入导出文件（xlsx 为二进制 zip，无需 BOM）。 */
export async function writeExportFile(dir, fileName, data) {
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, fileName)
  await fs.writeFile(target, data)
  return target
}

/** 原生「选择文件夹」对话框（PowerShell FolderBrowserDialog）。取消或失败返回 ''。 */
export function pickFolder({ title = '选择 Excel 默认保存位置', timeoutMs = 300000 } = {}) {
  const safeTitle = String(title).replace(/'/g, "''")
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    `$d.Description = '${safeTitle}'`,
    '$d.ShowNewFolderButton = $true',
    'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }',
  ].join('; ')
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 },
      (err, stdout) => {
        if (err) { resolve(''); return }
        resolve(String(stdout || '').trim())
      })
  })
}

/** 在资源管理器中定位文件（Windows）。explorer.exe 的退出码不可靠，忽略结果。 */
export function revealInExplorer(filePath) {
  try {
    execFile('explorer.exe', ['/select,' + filePath], { windowsHide: true }, () => {})
    return true
  } catch {
    return false
  }
}

/** 目录是否可用（存在且是目录，或可创建）。 */
export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
  const st = await fs.stat(dir)
  return st.isDirectory()
}
