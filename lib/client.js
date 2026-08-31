/**
 * dsh-cost-gauge 浏览器半身 —— 左上角可缩放、可展开/缩小的浮动窗口。
 *
 * 完整状态（展开）：12 小时时钟造型
 *   - 外圈圆环按 o'clock 位置用两种颜色表示费率：绿=空闲、黄=高峰（周末全绿）；
 *   - 白色时针指向当前时间（12h 表盘，一天转两圈）；
 *   - 内圈弧形「里程表」= 话费/余额油量计：最大 = 历史最高余额，红色段 = 告警阈值，
 *     橙→绿渐变弧 = 当前余额位置；
 *   - 下方显示话费花费、余额、命中率、当前模型 + 距切换倒计时。
 *
 * 缩小状态：标题 + 话费 + 双状态灯（绿=空闲 / 黄=繁忙），每盏灯外圈是一个
 *   「状态所剩进度」饼环；余额以暗绿色显示并附百分比。
 *
 * 可拖动标题栏移动、拖拽右下角缩放；位置/大小/展开态/阈值/历史最高余额存 localStorage。
 * 数据经同源 `/api/cost-gauge/state?session=<id>` 拉取。零依赖、纯原生 JS。
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
    const MIN_W = 190
    const MAX_W = 480
    const DEFAULT_W = 252

    // 12 小时表盘上标为「繁忙（黄）」的 o'clock 数字（对应工作日 9-12 / 14-18 高峰）。
    const BUSY_NUMBERS = new Set([2, 3, 4, 5, 6, 9, 10, 11])

    const CSS = `
.dsg-root{position:fixed;z-index:2147483000;width:${DEFAULT_W}px;box-sizing:border-box;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  background:rgba(18,20,26,.96);color:#e5e7eb;border:1px solid rgba(255,255,255,.10);
  border-radius:16px;box-shadow:0 12px 34px rgba(0,0,0,.44);padding:10px 12px 12px;
  user-select:none;-webkit-user-select:none}
.dsg-root.dsg-collapsed{width:174px;padding:9px 11px 10px}
.dsg-title{display:flex;align-items:center;gap:7px;cursor:grab;padding-bottom:8px;
  border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:9px}
.dsg-title:active{cursor:grabbing}
.dsg-title-text{flex:1;font-size:13px;font-weight:600;color:#f3f4f6;white-space:nowrap}
.dsg-alarm-dot{width:8px;height:8px;border-radius:50%;background:#ef4444;flex:none;display:none}
.dsg-root.dsg-alarm .dsg-alarm-dot{display:block;animation:dsg-blink 1s ease-in-out infinite}
@keyframes dsg-blink{0%,100%{opacity:1;box-shadow:0 0 8px 2px rgba(239,68,68,.85)}
  50%{opacity:.12;box-shadow:none}}
.dsg-toggle,.dsg-gear{flex:none;border:none;background:transparent;color:#9ca3af;cursor:pointer;
  font-size:15px;line-height:1;padding:2px 3px;width:20px;text-align:center}
.dsg-toggle:hover,.dsg-gear:hover{color:#e5e7eb}
.dsg-gear{font-size:13px}

/* 时钟表盘 */
.dsg-clock{position:relative}
.dsg-clock svg{display:block;width:100%;height:auto}
.dsg-seg{fill:none;stroke-width:16}
.dsg-seg.dsg-idle{stroke:#22c55e}
.dsg-seg.dsg-busy{stroke:#f59e0b}
.dsg-hand{transform-box:view-box;transform-origin:110px 110px;transform:rotate(0deg);
  transition:transform .6s cubic-bezier(.4,1.4,.6,1)}
.dsg-hand line{stroke:#f9fafb;stroke-width:3.5;stroke-linecap:round}
.dsg-hand circle{fill:#f9fafb}
.dsg-odo-track{fill:none;stroke:rgba(255,255,255,.10);stroke-width:18;stroke-linecap:round}
.dsg-odo-red{fill:none;stroke:#ef4444;stroke-width:18;stroke-linecap:round}
.dsg-odo-fuel{fill:none;stroke:url(#dsg-grad);stroke-width:18;stroke-linecap:round}
.dsg-odo-num{fill:#9ca3af;font-size:10.5px;text-anchor:middle}
.dsg-clock-time{position:absolute;left:0;right:0;bottom:4px;text-align:center;
  font-size:11px;color:#d1d5db;font-variant-numeric:tabular-nums}

.dsg-status{font-size:12px;margin-top:4px;min-height:17px}
.dsg-status.dsg-idle{color:#4ade80}
.dsg-status.dsg-busy{color:#fbbf24}
.dsg-countdown{font-size:11px;color:#6b7280;text-align:center;min-height:15px;margin-top:1px}
.dsg-rows{margin-top:3px}
.dsg-row{display:flex;justify-content:space-between;align-items:center;font-size:12px;
  color:#9ca3af;padding:3px 0}
.dsg-val{color:#f3f4f6;font-variant-numeric:tabular-nums;font-weight:600}
.dsg-root.dsg-alarm .dsg-balance,.dsg-root.dsg-alarm .dsg-balance2{color:#ef4444}

/* 缩小态 */
.dsg-compact{display:none}
.dsg-collapsed .dsg-compact{display:block}
.dsg-collapsed .dsg-clock,.dsg-collapsed .dsg-status,.dsg-collapsed .dsg-countdown,
.dsg-collapsed .dsg-rows,.dsg-collapsed .dsg-settings,.dsg-collapsed .dsg-resizer,
.dsg-collapsed .dsg-gear{display:none}
.dsg-lamps{display:flex;align-items:center;gap:14px;margin-top:8px}
.dsg-lamp{display:flex;align-items:center;gap:5px;opacity:.16}
.dsg-lamp svg{display:block}
.dsg-root.dsg-idle .dsg-lamp.dsg-lamp-idle,.dsg-root.dsg-busy .dsg-lamp.dsg-lamp-busy{opacity:1}
.dsg-lamp-label{font-size:11px;color:#9ca3af}
.dsg-bal-pct{color:#6b7280;font-size:11px;margin-left:4px}

.dsg-settings{display:none;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)}
.dsg-root.dsg-settings-open .dsg-settings{display:block}
.dsg-settings label{font-size:11px;color:#9ca3af;display:block;margin-bottom:4px}
.dsg-threshold{width:100%;box-sizing:border-box;background:rgba(255,255,255,.08);
  border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#f3f4f6;font-size:13px;padding:6px 8px}
.dsg-threshold:focus{outline:none;border-color:rgba(96,165,250,.6)}

/* 右下角缩放把手 */
.dsg-resizer{position:absolute;right:0;bottom:0;width:20px;height:20px;cursor:nwse-resize;
  touch-action:none}
.dsg-resizer::after{content:'';position:absolute;right:4px;bottom:4px;width:10px;height:10px;
  border-right:2px solid rgba(255,255,255,.35);border-bottom:2px solid rgba(255,255,255,.35);
  border-bottom-right-radius:3px}
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

    /* ---------- localStorage ---------- */
    function loadJSON(key) {
      try {
        const raw = localStorage.getItem(LS_PREFIX + ':' + key)
        if (raw) return JSON.parse(raw)
      } catch {}
      return null
    }
    function saveJSON(key, v) {
      try { localStorage.setItem(LS_PREFIX + ':' + key, JSON.stringify(v)) } catch {}
    }
    function loadLocalThreshold() {
      const raw = localStorage.getItem(LS_PREFIX + ':threshold')
      if (raw !== null) {
        const n = Number(raw)
        if (Number.isFinite(n) && n >= 0) return n
      }
      return null
    }
    function saveLocalThreshold(v) {
      try { localStorage.setItem(LS_PREFIX + ':threshold', String(v)) } catch {}
    }
    function loadMaxBalance() {
      const raw = localStorage.getItem(LS_PREFIX + ':maxBalance')
      const n = Number(raw)
      return Number.isFinite(n) && n > 0 ? n : null
    }
    function saveMaxBalance(v) {
      try { localStorage.setItem(LS_PREFIX + ':maxBalance', String(v)) } catch {}
    }

    /* ---------- 工具 ---------- */
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
    function beijingClock(now = new Date()) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai', hour12: false,
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(now)
      const get = (t) => Number(parts.find((p) => p.type === t)?.value) || 0
      return { h: get('hour'), m: get('minute'), s: get('second') }
    }
    // 12h 表盘时针角度：一天转两圈。
    function handAngle12(c) {
      return ((c.h % 12) + c.m / 60 + c.s / 3600) * 30
    }
    function polar(cx, cy, r, deg) {
      const a = (deg - 90) * Math.PI / 180
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
    }
    function arcPath(cx, cy, r, a0, a1) {
      const [x0, y0] = polar(cx, cy, r, a0)
      const [x1, y1] = polar(cx, cy, r, a1)
      const large = (a1 - a0) > 180 ? 1 : 0
      return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
    }

    // 里程表：270° 弧形油量计，缺口在顶部。f∈[0,1] 从 45°(右上) 顺时针到 315°(左上)。
    const G0 = 45
    const GSWEEP = 270
    function gaugePath(r, f0, f1) {
      return arcPath(110, 110, r, G0 + f0 * GSWEEP, G0 + f1 * GSWEEP)
    }

    /** 构建 12h 外圈：按 o'clock 数字上色（忙用黄、闲用绿；周末全绿）。 */
    function buildClockRing(ringEl, isWeekend) {
      ringEl.textContent = ''
      const cx = 110
      const cy = 110
      const r = 100
      for (let n = 1; n <= 12; n++) {
        const mid = (n % 12) * 30
        const a0 = mid - 15 + 0.8
        const a1 = mid + 15 - 0.8
        const busy = !isWeekend && BUSY_NUMBERS.has(n)
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        p.setAttribute('d', arcPath(cx, cy, r, a0, a1))
        p.setAttribute('class', 'dsg-seg ' + (busy ? 'dsg-busy' : 'dsg-idle'))
        ringEl.appendChild(p)
      }
    }

    function svgEl(tag, attrs) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
      for (const k in attrs) el.setAttribute(k, attrs[k])
      return el
    }
    function renderOdometer(odoEl, balance, threshold, maxBalance) {
      const scale = Number.isFinite(balance) && balance > 0
        ? (Number.isFinite(maxBalance) && maxBalance > 0 ? maxBalance : balance)
        : 100
      const fbal = Math.min(1, Math.max(0, (balance || 0) / scale))
      const fthr = Math.min(1, Math.max(0, threshold / scale))
      odoEl.textContent = ''
      odoEl.appendChild(svgEl('path', { class: 'dsg-odo-track', d: gaugePath(68, 0, 1) }))
      odoEl.appendChild(svgEl('path', { class: 'dsg-odo-red', d: gaugePath(68, 0, Math.max(fthr, 0.015)) }))
      odoEl.appendChild(svgEl('path', { class: 'dsg-odo-fuel', d: gaugePath(68, 0, Math.max(fbal, 0.015)) }))
      const t1 = svgEl('text', { class: 'dsg-odo-num', x: '152', y: '52', 'text-anchor': 'end' })
      t1.textContent = fmtMoney(scale)
      const t2 = svgEl('text', { class: 'dsg-odo-num', x: '68', y: '52', 'text-anchor': 'start' })
      t2.textContent = '¥0'
      const t3 = svgEl('text', { class: 'dsg-odo-num', x: '110', y: '190', 'text-anchor': 'middle' })
      t3.textContent = fmtMoney(threshold)
      odoEl.appendChild(t1)
      odoEl.appendChild(t2)
      odoEl.appendChild(t3)
      return { scale, fbal, fthr }
    }

    /** 状态灯 + 饼环。progressRes 为 [0,1] 剩余进度；lit 表示当前是否点亮。 */
    function buildLampSvg(color, lit, progressRes) {
      const C = 2 * Math.PI * 8
      const dash = lit ? (progressRes * C).toFixed(2) + ' ' + C.toFixed(2) : '0 ' + C.toFixed(2)
      const svg = svgEl('svg', { width: '22', height: '22', viewBox: '0 0 22 22' })
      const base = svgEl('circle', { cx: '11', cy: '11', r: '9', fill: color, opacity: lit ? '0.28' : '0.12' })
      const dot = svgEl('circle', { cx: '11', cy: '11', r: '3.6', fill: color })
      dot.style.opacity = lit ? '1' : '0.5'
      if (lit) dot.style.filter = `drop-shadow(0 0 4px ${color})`
      const ring = svgEl('circle', { cx: '11', cy: '11', r: '8', fill: 'none', stroke: color, 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-dasharray': dash, transform: 'rotate(-90 11 11)' })
      svg.appendChild(base)
      svg.appendChild(ring)
      svg.appendChild(dot)
      return svg
    }

    function apply(ctx) {
      ctx.effect(() => {
        injectCss()

        const root = document.createElement('div')
        root.className = 'dsg-root'
        root.innerHTML = `
<div class="dsg-title" data-drag>
  <span class="dsg-title-text">DeepSeek 花费</span>
  <span class="dsg-alarm-dot" title=""></span>
  <button class="dsg-toggle" type="button" title="缩小">−</button>
  <button class="dsg-gear" type="button" title="设置余额阈值">⚙</button>
</div>

<div class="dsg-clock">
  <svg viewBox="0 0 220 220" aria-label="费率时钟">
    <defs>
      <linearGradient id="dsg-grad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#f59e0b"/>
        <stop offset="100%" stop-color="#22c55e"/>
      </linearGradient>
    </defs>
    <g class="dsg-ring"></g>
    <g class="dsg-odo"></g>
    <g class="dsg-hand">
      <line x1="110" y1="110" x2="110" y2="54"></line>
      <circle cx="110" cy="110" r="4.5"></circle>
    </g>
  </svg>
  <div class="dsg-clock-time">--:--</div>
</div>
<div class="dsg-status">—</div>
<div class="dsg-countdown"></div>
<div class="dsg-rows">
  <div class="dsg-row"><span>话费花费</span><span class="dsg-val dsg-cost">—</span></div>
  <div class="dsg-row"><span>余额</span><span class="dsg-val dsg-balance">—</span></div>
  <div class="dsg-row"><span>命中率</span><span class="dsg-val dsg-hit">—</span></div>
  <div class="dsg-row"><span>当前模型</span><span class="dsg-val dsg-model">—</span></div>
</div>

<div class="dsg-compact">
  <div class="dsg-row"><span>话费</span><span class="dsg-val dsg-cost2">—</span></div>
  <div class="dsg-lamps">
    <span class="dsg-lamp dsg-lamp-idle" title="空闲（标准）"><span class="dsg-lamp-svg-idle"></span><span class="dsg-lamp-label">空闲</span></span>
    <span class="dsg-lamp dsg-lamp-busy" title="繁忙（高峰）"><span class="dsg-lamp-svg-busy"></span><span class="dsg-lamp-label">繁忙</span></span>
  </div>
  <div class="dsg-row"><span>余额</span><span class="dsg-val dsg-balance2">—</span><span class="dsg-bal-pct">--%</span></div>
</div>

<div class="dsg-settings">
  <label>余额报警阈值（人民币）</label>
  <input class="dsg-threshold" type="number" min="0" step="1" inputmode="decimal">
</div>
<div class="dsg-resizer" data-resize title="拖拽缩放"></div>
`
        document.body.appendChild(root)

        const titleEl = root.querySelector('.dsg-title')
        const alarmDotEl = root.querySelector('.dsg-alarm-dot')
        const toggleEl = root.querySelector('.dsg-toggle')
        const gearEl = root.querySelector('.dsg-gear')
        const ringEl = root.querySelector('.dsg-ring')
        const odoEl = root.querySelector('.dsg-odo')
        const handEl = root.querySelector('.dsg-hand')
        const clockTimeEl = root.querySelector('.dsg-clock-time')
        const statusEl = root.querySelector('.dsg-status')
        const countdownEl = root.querySelector('.dsg-countdown')
        const costEl = root.querySelector('.dsg-cost')
        const costEl2 = root.querySelector('.dsg-cost2')
        const balanceEl = root.querySelector('.dsg-balance')
        const balanceEl2 = root.querySelector('.dsg-balance2')
        const hitEl = root.querySelector('.dsg-hit')
        const modelEl = root.querySelector('.dsg-model')
        const pctEl = root.querySelector('.dsg-bal-pct')
        const idlePlaceholder = root.querySelector('.dsg-lamp-svg-idle')
        const busyPlaceholder = root.querySelector('.dsg-lamp-svg-busy')
        const thresholdEl = root.querySelector('.dsg-threshold')
        const resizerEl = root.querySelector('.dsg-resizer')

        // 初始位置/大小/展开态（localStorage 记忆）。
        const savedPos = loadJSON('pos')
        root.style.left = (savedPos && typeof savedPos.x === 'number' ? savedPos.x : 24) + 'px'
        root.style.top = (savedPos && typeof savedPos.y === 'number' ? savedPos.y : 96) + 'px'

        const savedSize = loadJSON('size')
        const sizeW = savedSize && typeof savedSize.width === 'number'
          ? Math.min(MAX_W, Math.max(MIN_W, savedSize.width))
          : DEFAULT_W

        const collapsed = loadJSON('collapsed') === true
        if (collapsed) {
          root.classList.add('dsg-collapsed')
          toggleEl.textContent = '＋'
          toggleEl.title = '展开'
        } else {
          root.style.width = sizeW + 'px'
        }

        let localThreshold = loadLocalThreshold()
        let maxBalance = loadMaxBalance()
        let lastData = null
        let lastRate = null
        let lastIsWeekend = null
        let idleSvg = null
        let busySvg = null

        function currentThreshold(data) {
          if (localThreshold !== null) return localThreshold
          if (data && data.threshold !== undefined && Number.isFinite(data.threshold)) return data.threshold
          return DEFAULT_THRESHOLD
        }

        function hitRateOf(tokens) {
          if (!tokens) return null
          const a = Number(tokens.uncachedInputTokens) || 0
          const b = Number(tokens.cacheReadTokens) || 0
          const den = a + b
          if (den <= 0) return null
          return Math.round((b / den) * 100)
        }

        function render(data) {
          const threshold = currentThreshold(data)
          const peak = !!(data.rate && data.rate.peak)
          root.classList.toggle('dsg-busy', peak)
          root.classList.toggle('dsg-idle', !peak)
          statusEl.className = 'dsg-status ' + (peak ? 'dsg-busy' : 'dsg-idle')
          statusEl.textContent = peak ? '繁忙（高峰）' : '空闲（标准）'

          lastRate = data.rate || null

          // 话费。
          const cost = data.cost
          const costText = cost && Number.isFinite(cost.cost) ? fmtMoney(cost.cost) : '—'
          costEl.textContent = costText
          costEl2.textContent = costText

          // 命中率 / 模型。
          const hr = hitRateOf(cost && cost.tokens)
          hitEl.textContent = hr === null ? '—' : hr + '%'
          const pricingKey = cost && cost.pricingKey ? cost.pricingKey : ''
          modelEl.textContent = pricingKey
            ? (pricingKey.charAt(0).toUpperCase() + pricingKey.slice(1))
            : '—'

          // 余额 + 里程表 + 百分比。
          const bal = data.balance
          if (bal && bal.total !== undefined && Number.isFinite(bal.total)) {
            const balText = fmtMoney(bal.total)
            balanceEl.textContent = balText
            balanceEl2.textContent = balText
            const low = bal.total < threshold
            root.classList.toggle('dsg-alarm', low)
            alarmDotEl.title = low
              ? `余额 ¥${bal.total.toFixed(2)} 低于阈值 ¥${threshold}，报警中`
              : `余额 ¥${bal.total.toFixed(2)}（阈值 ¥${threshold}）`

            if (maxBalance === null || bal.total > maxBalance) {
              maxBalance = bal.total
              saveMaxBalance(maxBalance)
            }
            const odo = renderOdometer(odoEl, bal.total, threshold, maxBalance)
            pctEl.textContent = Math.round(odo.fbal * 100) + '%'
          } else {
            const errText = bal && bal.error ? '查询失败' : '—'
            balanceEl.textContent = errText
            balanceEl2.textContent = errText
            pctEl.textContent = '--%'
            root.classList.remove('dsg-alarm')
            alarmDotEl.title = (bal && bal.error) ? bal.error : '余额未知'
            renderOdometer(odoEl, 0, threshold, maxBalance)
          }

          // 外圈日程。
          if (data.schedule) {
            const isWeekend = !!data.schedule.isWeekend
            if (isWeekend !== lastIsWeekend) {
              lastIsWeekend = isWeekend
              buildClockRing(ringEl, isWeekend)
            }
          }

          renderLamps(peak, lastRate)
          thresholdEl.value = String(threshold)
        }

        function renderLamps(peak, rate) {
          let progressRes = 0.5
          if (rate && Number.isFinite(rate.nextSwitchAt) && Number.isFinite(rate.periodStart)) {
            const total = rate.nextSwitchAt - rate.periodStart
            const remaining = rate.nextSwitchAt - Date.now()
            progressRes = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0.5
          }
          const newIdle = buildLampSvg('#22c55e', !peak, progressRes)
          const newBusy = buildLampSvg('#f59e0b', peak, progressRes)
          idlePlaceholder.replaceChildren(newIdle)
          busyPlaceholder.replaceChildren(newBusy)
          idleSvg = newIdle
          busySvg = newBusy
        }

        function tick() {
          const c = beijingClock()
          handEl.style.transform = 'rotate(' + handAngle12(c) + 'deg)'
          clockTimeEl.textContent = String(c.h).padStart(2, '0') + ':' + String(c.m).padStart(2, '0')
          if (lastRate && Number.isFinite(lastRate.nextSwitchAt)) {
            const s = Math.max(0, Math.round((lastRate.nextSwitchAt - Date.now()) / 1000))
            countdownEl.textContent = fmtCountdown(s)
          }
          if (lastRate) renderLamps(root.classList.contains('dsg-busy'), lastRate)
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
            render({ balance: { error: msg }, rate: null, cost: null, schedule: null, threshold: DEFAULT_THRESHOLD })
          }
        }

        // ---------- 拖动（标题栏） ----------
        let dragging = false
        let startX = 0
        let startY = 0
        let origX = 0
        let origY = 0
        titleEl.addEventListener('pointerdown', (e) => {
          if (e.target.closest('button, .dsg-alarm-dot')) return
          dragging = true
          startX = e.clientX
          startY = e.clientY
          origX = root.offsetLeft
          origY = root.offsetTop
          try { titleEl.setPointerCapture(e.pointerId) } catch {}
          e.preventDefault()
        })
        titleEl.addEventListener('pointermove', (e) => {
          if (!dragging) return
          root.style.left = Math.max(0, origX + (e.clientX - startX)) + 'px'
          root.style.top = Math.max(0, origY + (e.clientY - startY)) + 'px'
        })
        const endDrag = () => {
          if (!dragging) return
          dragging = false
          saveJSON('pos', { x: root.offsetLeft, y: root.offsetTop })
        }
        titleEl.addEventListener('pointerup', endDrag)
        titleEl.addEventListener('pointercancel', endDrag)

        // ---------- 缩放（右下角把手，仅展开态） ----------
        let resizing = false
        let rStartX = 0
        let rOrigW = 0
        resizerEl.addEventListener('pointerdown', (e) => {
          if (root.classList.contains('dsg-collapsed')) return
          resizing = true
          rStartX = e.clientX
          rOrigW = root.offsetWidth
          try { resizerEl.setPointerCapture(e.pointerId) } catch {}
          e.preventDefault()
          e.stopPropagation()
        })
        resizerEl.addEventListener('pointermove', (e) => {
          if (!resizing) return
          const w = Math.min(MAX_W, Math.max(MIN_W, rOrigW + (e.clientX - rStartX)))
          root.style.width = w + 'px'
        })
        const endResize = () => {
          if (!resizing) return
          resizing = false
          saveJSON('size', { width: root.offsetWidth })
        }
        resizerEl.addEventListener('pointerup', endResize)
        resizerEl.addEventListener('pointercancel', endResize)

        // ---------- 展开/缩小切换 ----------
        toggleEl.addEventListener('click', () => {
          const nowCollapsed = root.classList.toggle('dsg-collapsed')
          if (nowCollapsed) {
            root.style.width = ''
            toggleEl.textContent = '＋'
            toggleEl.title = '展开'
          } else {
            root.style.width = sizeW + 'px'
            toggleEl.textContent = '−'
            toggleEl.title = '缩小'
          }
          saveJSON('collapsed', nowCollapsed)
        })

        // ---------- 阈值设置 ----------
        gearEl.addEventListener('click', () => {
          root.classList.toggle('dsg-settings-open')
        })
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

        // ---------- 首次拉取 + 轮询 + 秒针 ----------
        poll()
        const pollTimer = setInterval(poll, POLL_MS)
        tick()
        const clockTimer = setInterval(tick, 1000)

        return () => {
          clearInterval(pollTimer)
          clearInterval(clockTimer)
          root.remove()
        }
      }, 'dsh-cost-gauge: widget')
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
