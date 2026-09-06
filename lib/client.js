/**
 * dsh-cost-gauge 浏览器半身 —— 在页面左上角挂一个方形浮动窗口：
 *   - 顶部小红灯：余额低于设定阈值时闪烁报警；
 *   - 指针式费率表：指针指向「标准（空闲）」或「翻倍（高峰）」；
 *   - 显示当前会话花费与账户余额；
 *   - 可拖动、右下角可拖拽放大/缩小；
 *   - 可最小化：仅显示 绿/黄费率灯 + 外圈倒计时饼图 + 会话费(白)/余额(灰)；
 *   - 可设置余额阈值（localStorage 持久化）。
 *
 * 数据经同源 `/api/cost-gauge/state?session=<id>` 拉取；当前会话 id 从
 * `ctx.sessions.list` 快照读取。零依赖、纯原生 JS，无 React。
 */
window.__ModuleLoader__.load({
  id: 'dsh-cost-gauge',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    /** 客户端依赖的 cordis 服务：sessions（读当前会话）。 */
    const inject = ['sessions']

    const LS_PREFIX = 'dsh-cost-gauge'
    const DEFAULT_THRESHOLD = 10
    const POLL_MS = 5000
    const TICK_MS = 1000
    const DEFAULT_W = 216
    const MIN_W = 180
    const MAX_W = 340
    const MINI_W = 210

    const CSS = `
.dsg-root{position:fixed;z-index:2147483000;width:${DEFAULT_W}px;box-sizing:border-box;
  container-type:inline-size;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  background:rgba(20,22,28,.94);color:#e5e7eb;border:1px solid rgba(255,255,255,.10);
  border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.38);padding:10px 12px 12px;
  user-select:none;-webkit-user-select:none}
.dsg-root.dsg-collapsed{padding:8px 10px;cursor:pointer}
.dsg-title{display:flex;align-items:center;gap:7px;cursor:grab;padding-bottom:8px;
  border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:10px}
.dsg-title:active{cursor:grabbing}
.dsg-title-text{flex:1;min-width:0;font-size:clamp(10px,6.2cqw,14px);line-height:1.2;
  font-weight:600;color:#f3f4f6;white-space:nowrap}
.dsg-badge{flex:none;font-size:clamp(8px,4.8cqw,11px);line-height:1;padding:.35em .55em;
  border:1px solid rgba(255,255,255,.4);border-radius:.45em;color:#cbd5e1;font-weight:600;
  letter-spacing:.2px;white-space:nowrap;max-width:12em;overflow:hidden;text-overflow:ellipsis}
.dsg-badge.dsg-badge-pro{color:#fcd34d;border-color:rgba(252,211,77,.6)}
.dsg-badge.dsg-badge-flash{color:#7dd3fc;border-color:rgba(125,211,252,.55)}
.dsg-badge.dsg-badge-vision{color:#e879f9;border-color:rgba(232,121,249,.55)}
.dsg-light{width:10px;height:10px;border-radius:50%;background:#4b5563;flex:none}
.dsg-root.dsg-ok .dsg-light{background:#22c55e;box-shadow:0 0 6px 1px rgba(34,197,94,.5)}
.dsg-root.dsg-alarm .dsg-light{background:#ef4444;animation:dsg-blink 1s ease-in-out infinite}
@keyframes dsg-blink{0%,100%{opacity:1;box-shadow:0 0 9px 3px rgba(239,68,68,.85)}
  50%{opacity:.12;box-shadow:none}}
.dsg-iconbtn{flex:none;border:none;background:transparent;color:#9ca3af;cursor:pointer;
  font-size:14px;line-height:1;padding:2px 3px;border-radius:6px}
.dsg-iconbtn:hover{color:#e5e7eb;background:rgba(255,255,255,.08)}
.dsg-gauge{text-align:center}
.dsg-gauge svg{display:block;margin:0 auto;width:100%;max-width:320px;height:auto}
.dsg-arc-bg{fill:none;stroke:rgba(255,255,255,.12);stroke-width:10;stroke-linecap:round}
.dsg-arc-std{fill:none;stroke:#22c55e;stroke-width:10;stroke-linecap:round}
.dsg-arc-peak{fill:none;stroke:#f59e0b;stroke-width:10;stroke-linecap:round}
.dsg-needle{transform-box:view-box;transform-origin:70px 70px;transform:rotate(-90deg);
  transition:transform .6s linear}
.dsg-needle line{stroke:#f9fafb;stroke-width:3;stroke-linecap:round}
.dsg-needle circle{fill:#f9fafb}
.dsg-ticks line{stroke:rgba(255,255,255,.22);stroke-width:.5;stroke-linecap:round}
.dsg-gauge-label{fill:#9ca3af;font-size:11px}
.dsg-status{font-size:12px;margin-top:2px;min-height:18px}
.dsg-status.dsg-std{color:#4ade80}
.dsg-status.dsg-peak{color:#fbbf24}
.dsg-rows{margin-top:2px}
.dsg-row{display:flex;justify-content:space-between;align-items:center;font-size:12px;
  color:#9ca3af;padding:3px 0}
.dsg-val{color:#f3f4f6;font-variant-numeric:tabular-nums;font-weight:600}
.dsg-countdown-row{justify-content:center;color:#6b7280;font-size:11px;min-height:16px}
.dsg-settings{display:none;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)}
.dsg-root.dsg-settings-open .dsg-settings{display:block}
.dsg-settings label{font-size:11px;color:#9ca3af;display:block;margin-bottom:4px}
.dsg-threshold{width:100%;box-sizing:border-box;background:rgba(255,255,255,.08);
  border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#f3f4f6;font-size:13px;padding:6px 8px}
.dsg-threshold:focus{outline:none;border-color:rgba(96,165,250,.6)}

/* ===== 最小化态 ===== */
.dsg-root.dsg-collapsed .dsg-title,
.dsg-root.dsg-collapsed .dsg-gauge,
.dsg-root.dsg-collapsed .dsg-rows,
.dsg-root.dsg-collapsed .dsg-settings,
.dsg-root.dsg-collapsed .dsg-resizer{display:none}
.dsg-mini{display:none;align-items:center;gap:11px;min-height:38px;cursor:pointer}
.dsg-root.dsg-collapsed .dsg-mini{display:flex}
.dsg-mini-lampwrap{position:relative;width:40px;height:40px;flex:none}
.dsg-mini-lampwrap svg{position:absolute;inset:0;width:40px;height:40px;transform:rotate(-90deg)}
.dsg-mini-track{fill:none;stroke:rgba(255,255,255,.14);stroke-width:4;stroke-linecap:round}
.dsg-mini-prog{fill:none;stroke:#22c55e;stroke-width:4;stroke-linecap:round;
  transition:stroke .4s}
.dsg-root.dsg-peak .dsg-mini-prog{stroke:#fbbf24}
.dsg-mini-lamp{position:absolute;left:50%;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;
  border-radius:50%;background:#22c55e;box-shadow:0 0 9px 2px rgba(34,197,94,.55);
  transition:background .4s,box-shadow .4s}
.dsg-root.dsg-peak .dsg-mini-lamp{background:#fbbf24;box-shadow:0 0 9px 2px rgba(250,204,21,.6)}
.dsg-mini-text{display:flex;flex-direction:column;gap:1px;min-width:0}
.dsg-mini-cost{color:#ffffff;font-size:14px;font-weight:700;font-variant-numeric:tabular-nums;
  white-space:nowrap}
.dsg-mini-bal{color:#9ca3af;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
.dsg-mini-hint{color:#6b7280;font-size:10px;margin-left:auto;white-space:nowrap}
/* ===== 缩放把手 ===== */
.dsg-resizer{position:absolute;right:3px;bottom:3px;width:12px;height:12px;cursor:nwse-resize;
  border-right:2px solid rgba(255,255,255,.35);border-bottom:2px solid rgba(255,255,255,.35);
  border-bottom-right-radius:3px}
.dsg-resizer:hover{border-color:rgba(255,255,255,.75)}
/* ===== 对话执行中：标题灯 + 最小化状态灯发光闪烁 ===== */
.dsg-root.dsg-working .dsg-light{animation:dsg-work 1s ease-in-out infinite}
.dsg-root.dsg-working .dsg-mini-lamp{animation:dsg-work 1s ease-in-out infinite}
@keyframes dsg-work{
  0%,100%{filter:brightness(1);opacity:1;box-shadow:0 0 5px 1px rgba(255,255,255,.22)}
  50%{filter:brightness(2);opacity:.5;box-shadow:0 0 16px 6px rgba(255,255,255,.7)}}
`

    let styleEl = null
    function injectCss() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin-css="dsh-cost-gauge"]')) return
      styleEl = document.createElement('style')
      styleEl.dataset.plugin = 'dsh-cost-gauge'
      styleEl.dataset.pluginCss = 'dsh-cost-gauge'
      styleEl.textContent = CSS
      document.head.appendChild(styleEl)
    }

    function loadLocalThreshold() {
      try {
        const raw = localStorage.getItem(LS_PREFIX + ':threshold')
        if (raw !== null) {
          const n = Number(raw)
          if (Number.isFinite(n) && n >= 0) return n
        }
      } catch {}
      return null
    }

    function saveLocalThreshold(v) {
      try { localStorage.setItem(LS_PREFIX + ':threshold', String(v)) } catch {}
    }

    function loadJSON(key) {
      try {
        const raw = localStorage.getItem(LS_PREFIX + ':' + key)
        return raw ? JSON.parse(raw) : null
      } catch {}
      return null
    }

    function saveJSON(key, v) {
      try { localStorage.setItem(LS_PREFIX + ':' + key, JSON.stringify(v)) } catch {}
    }

    function fmtMoney(v) {
      if (v === undefined || v === null || !Number.isFinite(v)) return '—'
      return '¥' + v.toFixed(2)
    }

    function fmtCountdown(s) {
      if (!Number.isFinite(s) || s < 0) return ''
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      const sec = Math.floor(s % 60)
      if (h > 0) return `距切换 ${h}小时${m}分`
      if (m > 0) return `距切换 ${m}分${sec}秒`
      return `距切换 ${sec}秒`
    }

    // ===== 24h 时间表盘（指针随北京时间走；弧色 = 当日费率带）=====
    function beijingPartsNow() {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      }).formatToParts(new Date())
      const get = (t) => Number(parts.find((p) => p.type === t)?.value) || 0
      const year = get('year')
      const month = get('month')
      const day = get('day')
      let hour = get('hour')
      if (hour === 24) hour = 0
      return {
        year, month, day,
        weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
        hour, minute: get('minute'), second: get('second'),
      }
    }

    // 表盘角度 p（0=左端 → 90=弧顶 → 180=右端）。对应规则：
    // 0–6 点：弧顶→左端；6–12：左端→弧顶；12–18：弧顶→右端；18–24：跳回左端→弧顶。
    function dialPosOfHour(hf) {
      const t = ((hf % 24) + 24) % 24
      if (t < 6) return 90 - 15 * t
      if (t <= 18) return 15 * t - 90
      return 15 * (t - 18)
    }

    // 弧上一点坐标（p∈[0,180]，圆心 70,70，半径 55）。
    function arcXY(p) {
      const a = (180 - p) * Math.PI / 180
      return [70 + 55 * Math.cos(a), 70 - 55 * Math.sin(a)]
    }

    // 一段从 a° 到 b° 的弧路径。
    function arcD(a, b) {
      const [x1, y1] = arcXY(a)
      const [x2, y2] = arcXY(b)
      return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A 55 55 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`
    }

    // 当日费率带：周末全天标准 → 全绿；工作日 → 绿(标准段)+黄(高峰 9–12 / 14–18)。
    function dialArcsFor(p) {
      if (p.weekday === 0 || p.weekday === 6) return { std: arcD(0, 180), peak: '' }
      return {
        std: arcD(0, 45) + arcD(90, 120),
        peak: arcD(45, 90) + arcD(120, 180),
      }
    }

    // 整点刻度线：折叠表盘的整数小时恰好落在 15° 一格；置于弧内侧，尺寸为常规 1/3。
    function ticksMarkup() {
      const R1 = 46.5 // 内侧起点（贴近弧内缘 r≈50）
      const R2 = 48.5 // 终点（更靠中心）
      let out = ''
      for (let p = 0; p <= 180; p += 15) {
        const rad = Math.PI * (180 - p) / 180
        const x1 = (70 + R1 * Math.cos(rad)).toFixed(1)
        const y1 = (70 - R1 * Math.sin(rad)).toFixed(1)
        const x2 = (70 + R2 * Math.cos(rad)).toFixed(1)
        const y2 = (70 - R2 * Math.sin(rad)).toFixed(1)
        out += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line>`
      }
      return out
    }

    function apply(ctx) {
      ctx.effect(() => {
        injectCss()

        const root = document.createElement('div')
        root.className = 'dsg-root'
        root.innerHTML = `
<div class="dsg-title" data-drag>
  <span class="dsg-title-text">花费指示器</span>
  <span class="dsg-badge">Basic</span>
  <span class="dsg-light" title="余额预警灯"></span>
  <button class="dsg-iconbtn dsg-min" type="button" title="最小化">—</button>
  <button class="dsg-iconbtn dsg-gear" type="button" title="设置余额阈值">⚙</button>
</div>
<div class="dsg-gauge">
  <svg width="140" height="86" viewBox="0 0 140 88">
    <path class="dsg-arc-bg" d="M 15 70 A 55 55 0 0 1 125 70"></path>
    <path class="dsg-arc-std" d=""></path>
    <path class="dsg-arc-peak" d=""></path>
    <g class="dsg-ticks"></g>
    <g class="dsg-needle">
      <line x1="70" y1="70" x2="70" y2="24"></line>
      <circle cx="70" cy="70" r="4.5"></circle>
    </g>
  </svg>
  <div class="dsg-status">—</div>
</div>
<div class="dsg-rows">
  <div class="dsg-row"><span>会话花费</span><span class="dsg-val dsg-cost">—</span></div>
  <div class="dsg-row"><span>余额</span><span class="dsg-val dsg-balance">—</span></div>
  <div class="dsg-row dsg-countdown-row"><span class="dsg-countdown"></span></div>
</div>
<div class="dsg-settings">
  <label>余额报警阈值（人民币）</label>
  <input class="dsg-threshold" type="number" min="0" step="1" inputmode="decimal">
</div>
<div class="dsg-mini" data-drag-mini title="点击展开">
  <div class="dsg-mini-lampwrap">
    <svg viewBox="0 0 40 40">
      <circle class="dsg-mini-track" cx="20" cy="20" r="16" pathLength="100"></circle>
      <circle class="dsg-mini-prog" cx="20" cy="20" r="16" pathLength="100"
        stroke-dasharray="100" stroke-dashoffset="100"></circle>
    </svg>
    <span class="dsg-mini-lamp"></span>
  </div>
  <div class="dsg-mini-text">
    <span class="dsg-mini-cost">—</span>
    <span class="dsg-mini-bal">—</span>
  </div>
  <span class="dsg-mini-hint">点击展开</span>
</div>
<div class="dsg-resizer" data-resize title="拖拽缩放"></div>
`
        document.body.appendChild(root)

        const titleEl = root.querySelector('.dsg-title')
        const badgeEl = root.querySelector('.dsg-badge')
        const lightEl = root.querySelector('.dsg-light')
        const gearEl = root.querySelector('.dsg-gear')
        const minEl = root.querySelector('.dsg-min')
        const resizerEl = root.querySelector('.dsg-resizer')
        const miniEl = root.querySelector('.dsg-mini')
        const miniWrap = root.querySelector('.dsg-mini-lampwrap')
        const miniLamp = root.querySelector('.dsg-mini-lamp')
        const miniProg = root.querySelector('.dsg-mini-prog')
        const miniCostEl = root.querySelector('.dsg-mini-cost')
        const miniBalEl = root.querySelector('.dsg-mini-bal')
        const statusEl = root.querySelector('.dsg-status')
        const costEl = root.querySelector('.dsg-cost')
        const balanceEl = root.querySelector('.dsg-balance')
        const countdownEl = root.querySelector('.dsg-countdown')
        const thresholdEl = root.querySelector('.dsg-threshold')
        const needleEl = root.querySelector('.dsg-needle')
        const stdArcEl = root.querySelector('.dsg-arc-std')
        const peakArcEl = root.querySelector('.dsg-arc-peak')
        const ticksEl = root.querySelector('.dsg-ticks')

        // 初始位置（左上）+ 宽度/最小化状态。
        const saved = loadJSON('pos')
        root.style.left = (saved && typeof saved.x === 'number' ? saved.x : 24) + 'px'
        root.style.top = (saved && typeof saved.y === 'number' ? saved.y : 96) + 'px'
        const savedSize = loadJSON('size')
        let widthNow = savedSize && typeof savedSize.width === 'number'
          ? Math.min(MAX_W, Math.max(MIN_W, savedSize.width)) : DEFAULT_W
        const collapsedSaved = loadJSON('collapsed') === true
        root.style.width = (collapsedSaved ? MINI_W : widthNow) + 'px'

        let localThreshold = loadLocalThreshold()
        let lastData = null

        function currentThreshold(data) {
          if (localThreshold !== null) return localThreshold
          if (data && data.threshold !== undefined && Number.isFinite(data.threshold)) return data.threshold
          return DEFAULT_THRESHOLD
        }

        function applyWidth(w) {
          widthNow = Math.min(MAX_W, Math.max(MIN_W, w))
          saveJSON('size', { width: widthNow })
          root.style.width = widthNow + 'px'
        }

        function setCollapsed(c) {
          root.classList.toggle('dsg-collapsed', c)
          saveJSON('collapsed', c)
          root.style.width = (c ? MINI_W : widthNow) + 'px'
          if (!c) root.classList.remove('dsg-settings-open')
        }

        function render(data) {
          const threshold = currentThreshold(data)

          // 费率指针 + 状态文案 + 颜色类。
          const peak = !!(data.rate && data.rate.peak)
          root.classList.toggle('dsg-peak', peak)
          statusEl.className = 'dsg-status ' + (peak ? 'dsg-peak' : 'dsg-std')
          statusEl.textContent = peak ? '当前费率：翻倍（高峰）' : '当前费率：标准（空闲）'
          miniLamp.title = peak ? '翻倍（高峰）' : '标准（空闲）'

          // 会话花费（展开 + 最小化）。
          const cost = data.cost
          const costText = cost && Number.isFinite(cost.cost) ? fmtMoney(cost.cost) : '—'
          costEl.textContent = costText
          miniCostEl.textContent = costText

          // 模型徽章：显示当前会话模型名，并按模型配色（pro=金 / vision=紫 / flash=蓝）。
          const modelRaw = (cost && cost.model) ? String(cost.model) : ''
          const modelLower = modelRaw.toLowerCase()
          const badgeCls = modelLower.includes('pro') ? 'dsg-badge-pro'
            : modelLower.includes('vision') ? 'dsg-badge-vision'
            : modelRaw ? 'dsg-badge-flash' : ''
          badgeEl.className = 'dsg-badge' + (badgeCls ? ' ' + badgeCls : '')
          badgeEl.textContent = modelRaw
            ? (modelRaw.split('/').pop() || modelRaw).replace(/^deepseek-/i, '')
            : '—'
          badgeEl.title = modelRaw ? `当前模型：${modelRaw}` : '暂无会话模型'

          // 余额 + 红灯。
          const bal = data.balance
          if (bal && bal.total !== undefined && Number.isFinite(bal.total)) {
            const balText = fmtMoney(bal.total)
            balanceEl.textContent = balText
            miniBalEl.textContent = balText
            const low = bal.total < threshold
            root.classList.toggle('dsg-alarm', low)
            root.classList.toggle('dsg-ok', !low)
            lightEl.title = low
              ? `余额 ¥${bal.total.toFixed(2)} 低于阈值 ¥${threshold}，报警中`
              : `余额 ¥${bal.total.toFixed(2)}（阈值 ¥${threshold}）`
          } else {
            const errText = bal && bal.error ? '查询失败' : '—'
            balanceEl.textContent = errText
            miniBalEl.textContent = errText
            root.classList.remove('dsg-alarm', 'dsg-ok')
            lightEl.title = (bal && bal.error) ? bal.error : '余额未知'
          }

          thresholdEl.value = String(threshold)
          tick()
        }

        // 每秒：刷新倒计时文案 + 最小化态的倒计时饼图；同时根据会话是否执行中切换“工作灯”。
        function isSessionRunning() {
          try {
            const snap = ctx.sessions.list.getSnapshot()
            const id = snap && snap.current
            if (!id) return false
            const row = snap.byId && snap.byId[id]
            return !!(row && row.running)
          } catch {}
          return false
        }

        // 每秒刷新时间表盘：指针随北京时间走，弧色按当日费率带（周末全绿 / 工作日双色）。
        let lastDialDeg = -90
        function updateDial() {
          const p = beijingPartsNow()
          const hf = p.hour + p.minute / 60 + p.second / 3600
          const deg = dialPosOfHour(hf) - 90
          // 18:00 跳变（右端→左端）：瞬时跳回，不平滑扫过。
          if (lastDialDeg > 60 && deg < -60) {
            needleEl.style.transition = 'none'
            needleEl.style.transform = `rotate(${deg}deg)`
            void needleEl.getBoundingClientRect()
            needleEl.style.transition = 'transform .6s linear'
          } else {
            needleEl.style.transform = `rotate(${deg}deg)`
          }
          lastDialDeg = deg
          const arcs = dialArcsFor(p)
          stdArcEl.setAttribute('d', arcs.std)
          peakArcEl.setAttribute('d', arcs.peak)
          peakArcEl.style.display = arcs.peak ? '' : 'none'
        }

        function tick() {
          // 对话执行阶段：标题灯 + 最小化状态灯发光闪烁；结束后恢复正常。
          root.classList.toggle('dsg-working', isSessionRunning())
          updateDial()
          if (!lastData || !lastData.rate) return
          const rate = lastData.rate
          const rem = Math.max(0, Math.round((rate.nextSwitchAt - Date.now()) / 1000))
          countdownEl.textContent = fmtCountdown(rem)
          const period = Number(rate.periodSeconds)
          const frac = Number.isFinite(period) && period > 0 ? Math.min(1, rem / period) : 0
          miniProg.style.strokeDashoffset = String(100 * (1 - frac))
          const peakNow = !!rate.peak
          miniWrap.title = (peakNow ? '翻倍（高峰）' : '标准（空闲）') + ' · ' + fmtCountdown(rem)
        }

        async function poll() {
          let sid
          try { sid = ctx.sessions.list.getSnapshot().current } catch {}
          const url = '/api/cost-gauge/state' + (sid ? '?session=' + encodeURIComponent(sid) : '')
          try {
            const res = await fetch(url)
            if (!res.ok) throw new Error('HTTP ' + res.status)
            const data = await res.json()
            lastData = data
            render(data)
          } catch (e) {
            const msg = e && e.message ? e.message : String(e)
            render({ balance: { error: msg }, rate: null, cost: null, threshold: DEFAULT_THRESHOLD })
          }
        }

        // 拖动（标题栏；最小化时拖最小化条）。
        function attachDrag(handleEl, onTap) {
          let dragging = false
          let moved = false
          let sx = 0
          let sy = 0
          let ox = 0
          let oy = 0
          handleEl.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button')) return
            dragging = true
            moved = false
            sx = e.clientX
            sy = e.clientY
            ox = root.offsetLeft
            oy = root.offsetTop
            try { handleEl.setPointerCapture(e.pointerId) } catch {}
            e.preventDefault()
          })
          handleEl.addEventListener('pointermove', (e) => {
            if (!dragging) return
            const dx = e.clientX - sx
            const dy = e.clientY - sy
            if (Math.abs(dx) + Math.abs(dy) > 3) moved = true
            root.style.left = Math.max(0, ox + dx) + 'px'
            root.style.top = Math.max(0, oy + dy) + 'px'
          })
          const end = (e) => {
            if (!dragging) return
            dragging = false
            if (moved) {
              saveJSON('pos', { x: root.offsetLeft, y: root.offsetTop })
            } else if (typeof onTap === 'function') {
              onTap()
            }
          }
          handleEl.addEventListener('pointerup', end)
          handleEl.addEventListener('pointercancel', end)
        }
        attachDrag(titleEl)
        attachDrag(miniEl, () => setCollapsed(false))

        // 最小化/展开。
        minEl.addEventListener('click', () => setCollapsed(true))
        miniEl.addEventListener('dblclick', () => setCollapsed(false))

        // 右下角拖拽缩放（仅展开态）。
        let resizing = false
        let rsx = 0
        let rw = 0
        resizerEl.addEventListener('pointerdown', (e) => {
          resizing = true
          rsx = e.clientX
          rw = root.offsetWidth
          try { resizerEl.setPointerCapture(e.pointerId) } catch {}
          e.preventDefault()
          e.stopPropagation()
        })
        resizerEl.addEventListener('pointermove', (e) => {
          if (!resizing) return
          applyWidth(rw + (e.clientX - rsx))
        })
        const endResize = () => { resizing = false }
        resizerEl.addEventListener('pointerup', endResize)
        resizerEl.addEventListener('pointercancel', endResize)

        // 齿轮：展开/收起阈值设置。
        gearEl.addEventListener('click', () => {
          root.classList.toggle('dsg-settings-open')
        })

        // 阈值输入。
        thresholdEl.addEventListener('change', () => {
          const n = Number(thresholdEl.value)
          if (Number.isFinite(n) && n >= 0) {
            localThreshold = n
            saveLocalThreshold(n)
            if (lastData) render(lastData)
          } else {
            thresholdEl.value = String(currentThreshold(lastData))
          }
        })

        // 初始状态 + 轮询 + 每秒 tick。
        setCollapsed(collapsedSaved)
        ticksEl.innerHTML = ticksMarkup()
        updateDial()
        poll()
        const timer = setInterval(poll, POLL_MS)
        const ticker = setInterval(tick, TICK_MS)

        return () => {
          clearInterval(timer)
          clearInterval(ticker)
          root.remove()
        }
      }, 'dsh-cost-gauge: widget')
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
