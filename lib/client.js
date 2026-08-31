/**
 * dsh-cost-gauge 浏览器半身 —— 左上角可缩放、可展开/缩小的浮动窗口。
 *
 * 完整状态（展开）按设计稿（SVG）绘制：
 *   - 深色卡片 + 圆角，标题「DeepSeek 花费」+ 右上齿轮；
 *   - 标题下状态行：空闲（标准）绿 / 距离切换（绿）；
 *   - 主钟面：外圈圆环「黄底=繁忙、绿=空闲」的 12h 时间环；
 *     下半圆是「速度表式里程表」——深色轨道 + 绿色填充弧(当前余额) +
 *     红色告警段(¥0→阈值) + 橙色指针 + ¥0 / ¥100 / ¥10 刻度；
 *   - 中心白点 + 白色时针；表内上方「HH:MM」胶囊、下方「缓存命中率%」胶囊；
 *   - 底部：话费花费 ¥x、余额 ¥y，右侧 Flash/Pro 模型胶囊。
 *
 * 缩小状态：话费 + 双状态灯（绿=空闲 / 黄=繁忙），各带「状态所剩进度」饼环。
 * 数据经 `/api/cost-gauge/state?session=<id>` 拉取；位置/大小/展开态/阈值/历史最高余额存 localStorage。
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
    const MIN_W = 200
    const MAX_W = 480
    const DEFAULT_W = 264

    // 12 小时表盘上标为「繁忙」的 o'clock 数字（对应工作日 9-12 / 14-18 高峰）。
    const BUSY_NUMBERS = new Set([2, 3, 4, 5, 6, 9, 10, 11])
    // 设计稿配色。
    const COL = {
      card: '#231815',
      idleRing: '#a9cc72',
      busyRing: '#fac000',
      odoGreen: '#40b25d',
      odoRed: '#c30d23',
      odoNeedle: '#f39800',
      statusIdle: '#22ac38',
      statusBusy: '#fac000',
      accent: '#c4e1f6',
    }

    const CSS = `
.dsg-root{position:fixed;z-index:2147483000;width:${DEFAULT_W}px;box-sizing:border-box;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  background:${COL.card};color:#fff;border:1px solid rgba(255,255,255,.14);
  border-radius:16px;box-shadow:0 12px 34px rgba(0,0,0,.46);padding:9px 12px 11px;
  user-select:none;-webkit-user-select:none}
.dsg-root.dsg-collapsed{width:176px;padding:8px 11px 10px}
.dsg-title{display:flex;align-items:center;gap:6px;cursor:grab;padding-bottom:7px;
  border-bottom:1px solid rgba(255,255,255,.14);margin-bottom:7px}
.dsg-title:active{cursor:grabbing}
.dsg-title-text{flex:1;font-size:13px;font-weight:700;color:#fff;white-space:nowrap}
.dsg-accent{width:1.6px;height:13px;background:${COL.accent};border-radius:1px;flex:none;opacity:.9}
.dsg-alarm-dot{width:8px;height:8px;border-radius:50%;background:${COL.odoRed};flex:none;display:none}
.dsg-root.dsg-alarm .dsg-alarm-dot{display:block;animation:dsg-blink 1s ease-in-out infinite}
@keyframes dsg-blink{0%,100%{opacity:1;box-shadow:0 0 8px 2px rgba(195,13,35,.85)}
  50%{opacity:.12;box-shadow:none}}
.dsg-toggle,.dsg-gear{flex:none;border:none;background:transparent;color:#c4c4c4;cursor:pointer;
  font-size:15px;line-height:1;padding:2px 3px;width:20px;text-align:center}
.dsg-toggle:hover,.dsg-gear:hover{color:#fff}
.dsg-gear{font-size:13px;color:${COL.accent}}

/* 状态行 */
.dsg-status-row{display:flex;justify-content:space-between;align-items:center;gap:8px;
  font-size:10.5px;margin-bottom:5px;min-height:13px}
.dsg-status{font-weight:700}
.dsg-status.dsg-idle{color:${COL.statusIdle}}
.dsg-status.dsg-busy{color:${COL.statusBusy}}
.dsg-countdown{color:#8b8b8b;white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:700}

/* 时钟 + 里程表 */
.dsg-clock{position:relative}
.dsg-clock svg{display:block;width:100%;height:auto}
.dsg-seg{fill:none;stroke-width:15}
.dsg-seg.dsg-idle{stroke:${COL.idleRing}}
.dsg-seg.dsg-busy{stroke:${COL.busyRing}}
.dsg-hand{transform-box:view-box;transform-origin:100px 100px;transform:rotate(0deg);
  transition:transform .6s cubic-bezier(.4,1.4,.6,1)}
.dsg-hand line{stroke:#fff;stroke-width:3;stroke-linecap:round}
.dsg-hand circle{fill:#fff}
.dsg-hub{fill:#fff}
.dsg-odo-track{fill:none;stroke:rgba(255,255,255,.10);stroke-width:14;stroke-linecap:round}
.dsg-odo-red{fill:none;stroke:${COL.odoRed};stroke-width:14;stroke-linecap:round}
.dsg-odo-fuel{fill:none;stroke:${COL.odoGreen};stroke-width:14;stroke-linecap:round}
.dsg-odo-needle{stroke:${COL.odoNeedle};stroke-width:2.5;stroke-linecap:round}
.dsg-odo-label{fill:#949494;font-size:11px;font-variant-numeric:tabular-nums}
.dsg-odo-tick{stroke:rgba(255,255,255,.6);stroke-width:1.5;stroke-linecap:round}
.dsg-pill{fill:${COL.card};stroke:rgba(255,255,255,.28);stroke-width:.8}
.dsg-pill text{fill:#fff;font-size:12px;font-weight:700;text-anchor:middle;
  font-variant-numeric:tabular-nums}

/* 底部字段 */
.dsg-bottom{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:5px}
.dsg-rows{flex:1;min-width:0}
.dsg-row{display:flex;justify-content:space-between;align-items:center;font-size:12px;
  color:#949494;padding:3px 0;line-height:1.2}
.dsg-val{color:#fff;font-variant-numeric:tabular-nums;font-weight:700}
.dsg-model{flex:none}
.dsg-model-pill{display:inline-block;background:${COL.card};border:1px solid rgba(255,255,255,.3);
  border-radius:8px;color:#fff;font-size:11px;font-weight:700;padding:3px 10px}
.dsg-root.dsg-alarm .dsg-balance,.dsg-root.dsg-alarm .dsg-balance2{color:${COL.odoRed}}

/* 缩小态 */
.dsg-compact{display:none}
.dsg-collapsed .dsg-compact{display:block}
.dsg-collapsed .dsg-status-row,.dsg-collapsed .dsg-clock,.dsg-collapsed .dsg-bottom,
.dsg-collapsed .dsg-settings,.dsg-collapsed .dsg-resizer,.dsg-collapsed .dsg-gear,
.dsg-collapsed .dsg-accent{display:none}
.dsg-lamps{display:flex;align-items:center;gap:14px;margin-top:8px}
.dsg-lamp{display:flex;align-items:center;gap:5px;opacity:.16}
.dsg-lamp svg{display:block}
.dsg-root.dsg-idle .dsg-lamp.dsg-lamp-idle,.dsg-root.dsg-busy .dsg-lamp.dsg-lamp-busy{opacity:1}
.dsg-lamp-label{font-size:11px;color:#949494}

.dsg-settings{display:none;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.1)}
.dsg-root.dsg-settings-open .dsg-settings{display:block}
.dsg-settings label{font-size:11px;color:#949494;display:block;margin-bottom:4px}
.dsg-threshold{width:100%;box-sizing:border-box;background:rgba(255,255,255,.08);
  border:1px solid rgba(255,255,255,.16);border-radius:8px;color:#fff;font-size:13px;padding:6px 8px}
.dsg-threshold:focus{outline:none;border-color:${COL.accent}}

.dsg-resizer{position:absolute;right:0;bottom:0;width:20px;height:20px;cursor:nwse-resize;touch-action:none}
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
      return '¥' + (v >= 100 ? v.toFixed(0) : v.toFixed(2))
    }
    function fmtCountdown(s) {
      if (!Number.isFinite(s) || s < 0) return ''
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      if (h > 0) return `距离切换：${h}小时${m}分`
      if (m > 0) return `距离切换：${m}分${Math.floor(s % 60)}秒`
      return `距离切换：${Math.floor(s % 60)}秒`
    }
    function beijingClock(now = new Date()) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai', hour12: false,
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(now)
      const get = (t) => Number(parts.find((p) => p.type === t)?.value) || 0
      return { h: get('hour'), m: get('minute'), s: get('second') }
    }
    function handAngle12(c) { return ((c.h % 12) + c.m / 60 + c.s / 3600) * 30 }
    function polar(cx, cy, r, deg) {
      const a = (deg - 90) * Math.PI / 180
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
    }
    function arcPath(cx, cy, r, a0, a1) {
      const [x0, y0] = polar(cx, cy, r, a0)
      const [x1, y1] = polar(cx, cy, r, a1)
      const large = Math.abs(a1 - a0) > 180 ? 1 : 0
      const sweep = a1 > a0 ? 1 : 0
      return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`
    }
    // 里程表：底部半圆。f=0 在左(270°)，f=1 在右(90°)，经过底部(180°)。角度随 f 减小。
    const ODO_R = 74
    function odoAngle(f) { return 270 - f * 180 }
    function odoPath(r, f0, f1) {
      return arcPath(100, 100, r, odoAngle(f0), odoAngle(f1))
    }

    /** 构建 12h 外圈：按 o'clock 数字上色（忙=黄、闲=绿；周末全绿）。 */
    function buildClockRing(ringEl, isWeekend) {
      ringEl.textContent = ''
      for (let n = 1; n <= 12; n++) {
        const mid = (n % 12) * 30
        const a0 = mid - 15 + 0.8
        const a1 = mid + 15 - 0.8
        const busy = !isWeekend && BUSY_NUMBERS.has(n)
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        p.setAttribute('d', arcPath(100, 100, 94, a0, a1))
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
      const scale = (Number.isFinite(balance) && balance > 0)
        ? ((Number.isFinite(maxBalance) && maxBalance > 0) ? maxBalance : balance)
        : 100
      const fbal = Math.min(1, Math.max(0, (balance || 0) / scale))
      const fthr = Math.min(1, Math.max(0, threshold / scale))
      odoEl.textContent = ''
      odoEl.appendChild(svgEl('path', { class: 'dsg-odo-track', d: odoPath(ODO_R, 0, 1) }))
      odoEl.appendChild(svgEl('path', { class: 'dsg-odo-red', d: odoPath(ODO_R, 0, Math.max(fthr, 0.02)) }))
      odoEl.appendChild(svgEl('path', { class: 'dsg-odo-fuel', d: odoPath(ODO_R, 0, Math.max(fbal, 0.02)) }))
      // 橙色指针：指向当前余额所在角度。
      const na = odoAngle(fbal)
      const [nx, ny] = polar(100, 100, 60, na)
      odoEl.appendChild(svgEl('line', { class: 'dsg-odo-needle', x1: '100', y1: '100', x2: nx.toFixed(2), y2: ny.toFixed(2) }))
      // 刻度：左(¥0)、右(¥100)、底、以及阈值位置。
      const ticks = [270, 180, 90, odoAngle(fthr)]
      for (const t of ticks) {
        const [ax, ay] = polar(100, 100, ODO_R + 10, t)
        const [bx, by] = polar(100, 100, ODO_R + 15, t)
        odoEl.appendChild(svgEl('line', { class: 'dsg-odo-tick', x1: ax.toFixed(2), y1: ay.toFixed(2), x2: bx.toFixed(2), y2: by.toFixed(2) }))
      }
      // 标签。
      const l0 = svgEl('text', { class: 'dsg-odo-label', x: '28', y: '120', 'text-anchor': 'start' })
      l0.textContent = '¥0'
      const l1 = svgEl('text', { class: 'dsg-odo-label', x: '172', y: '120', 'text-anchor': 'end' })
      l1.textContent = fmtMoney(scale)
      const thrPos = polar(100, 100, 52, odoAngle(fthr))
      const l2 = svgEl('text', { class: 'dsg-odo-label', x: thrPos[0].toFixed(1), y: thrPos[1].toFixed(1), 'text-anchor': 'end' })
      l2.textContent = fmtMoney(threshold)
      odoEl.appendChild(l0)
      odoEl.appendChild(l1)
      odoEl.appendChild(l2)
      return { scale, fbal, fthr }
    }

    function renderPill(pillG, text) {
      pillG.textContent = ''
      const rect = svgEl('rect', { class: 'dsg-pill', x: '80', y: '30', width: '40', height: '15', rx: '7.5' })
      const t = svgEl('text', { x: '100', y: '41' })
      t.textContent = text
      pillG.appendChild(rect)
      pillG.appendChild(t)
    }
    function renderHitPill(pillG, text) {
      pillG.textContent = ''
      const rect = svgEl('rect', { class: 'dsg-pill', x: '80', y: '156', width: '40', height: '15', rx: '7.5' })
      const t = svgEl('text', { x: '100', y: '167' })
      t.textContent = text
      pillG.appendChild(rect)
      pillG.appendChild(t)
    }

    /** 状态灯 + 饼环。progressRes 为 [0,1] 剩余进度；lit 表示当前是否点亮。 */
    function buildLampSvg(color, lit, progressRes) {
      const C = 2 * Math.PI * 8
      const dash = lit ? (progressRes * C).toFixed(2) + ' ' + C.toFixed(2) : '0 ' + C.toFixed(2)
      const svg = svgEl('svg', { width: '22', height: '22', viewBox: '0 0 22 22' })
      svg.appendChild(svgEl('circle', { cx: '11', cy: '11', r: '9', fill: color, opacity: lit ? '0.28' : '0.12' }))
      const ring = svgEl('circle', { cx: '11', cy: '11', r: '8', fill: 'none', stroke: color, 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-dasharray': dash, transform: 'rotate(-90 11 11)' })
      const dot = svgEl('circle', { cx: '11', cy: '11', r: '3.6', fill: color })
      dot.style.opacity = lit ? '1' : '0.5'
      if (lit) dot.style.filter = `drop-shadow(0 0 4px ${color})`
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
  <span class="dsg-accent"></span>
  <span class="dsg-alarm-dot" title=""></span>
  <button class="dsg-toggle" type="button" title="缩小">−</button>
  <button class="dsg-gear" type="button" title="设置余额阈值">⚙</button>
</div>

<div class="dsg-status-row">
  <span class="dsg-status">—</span>
  <span class="dsg-countdown"></span>
</div>

<div class="dsg-clock">
  <svg viewBox="0 0 200 200" aria-label="费率时钟">
    <g class="dsg-ring"></g>
    <g class="dsg-odo"></g>
    <circle class="dsg-hub" cx="100" cy="100" r="3.6"></circle>
    <g class="dsg-hand">
      <line x1="100" y1="100" x2="100" y2="42"></line>
      <circle cx="100" cy="100" r="3.6"></circle>
    </g>
    <g class="dsg-time-pill"></g>
    <g class="dsg-hit-pill"></g>
  </svg>
</div>

<div class="dsg-bottom">
  <div class="dsg-rows">
    <div class="dsg-row"><span>话费花费</span><span class="dsg-val dsg-cost">—</span></div>
    <div class="dsg-row"><span>余额</span><span class="dsg-val dsg-balance">—</span></div>
  </div>
  <div class="dsg-model"><span class="dsg-model-pill dsg-model-text">—</span></div>
</div>

<div class="dsg-compact">
  <div class="dsg-row"><span>话费</span><span class="dsg-val dsg-cost2">—</span></div>
  <div class="dsg-lamps">
    <span class="dsg-lamp dsg-lamp-idle" title="空闲（标准）"><span class="dsg-lamp-svg-idle"></span><span class="dsg-lamp-label">空闲</span></span>
    <span class="dsg-lamp dsg-lamp-busy" title="繁忙（高峰）"><span class="dsg-lamp-svg-busy"></span><span class="dsg-lamp-label">繁忙</span></span>
  </div>
  <div class="dsg-row"><span>余额</span><span class="dsg-val dsg-balance2">—</span></div>
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
        const timePillEl = root.querySelector('.dsg-time-pill')
        const hitPillEl = root.querySelector('.dsg-hit-pill')
        const statusEl = root.querySelector('.dsg-status')
        const countdownEl = root.querySelector('.dsg-countdown')
        const costEl = root.querySelector('.dsg-cost')
        const costEl2 = root.querySelector('.dsg-cost2')
        const balanceEl = root.querySelector('.dsg-balance')
        const balanceEl2 = root.querySelector('.dsg-balance2')
        const modelTextEl = root.querySelector('.dsg-model-text')
        const idlePlaceholder = root.querySelector('.dsg-lamp-svg-idle')
        const busyPlaceholder = root.querySelector('.dsg-lamp-svg-busy')
        const thresholdEl = root.querySelector('.dsg-threshold')
        const resizerEl = root.querySelector('.dsg-resizer')

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

          const cost = data.cost
          const costText = cost && Number.isFinite(cost.cost) ? fmtMoney(cost.cost) : '—'
          costEl.textContent = costText
          costEl2.textContent = costText

          // 命中率（表内胶囊）。
          const hr = hitRateOf(cost && cost.tokens)
          renderHitPill(hitPillEl, hr === null ? '--%' : hr + '%')

          // 模型胶囊。
          const pricingKey = cost && cost.pricingKey ? cost.pricingKey : ''
          modelTextEl.textContent = pricingKey
            ? (pricingKey.charAt(0).toUpperCase() + pricingKey.slice(1))
            : '—'

          // 余额 + 里程表。
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
            renderOdometer(odoEl, bal.total, threshold, maxBalance)
          } else {
            const errText = bal && bal.error ? '查询失败' : '—'
            balanceEl.textContent = errText
            balanceEl2.textContent = errText
            root.classList.remove('dsg-alarm')
            alarmDotEl.title = (bal && bal.error) ? bal.error : '余额未知'
            renderOdometer(odoEl, 0, threshold, maxBalance)
          }

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
          idlePlaceholder.replaceChildren(buildLampSvg('#22ac38', !peak, progressRes))
          busyPlaceholder.replaceChildren(buildLampSvg('#fac000', peak, progressRes))
        }

        function tick() {
          const c = beijingClock()
          handEl.style.transform = 'rotate(' + handAngle12(c) + 'deg)'
          renderPill(timePillEl, String(c.h).padStart(2, '0') + ':' + String(c.m).padStart(2, '0'))
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

        // 拖动、缩放、切换、阈值（同前）。
        let dragging = false, startX = 0, startY = 0, origX = 0, origY = 0
        titleEl.addEventListener('pointerdown', (e) => {
          if (e.target.closest('button, .dsg-alarm-dot')) return
          dragging = true; startX = e.clientX; startY = e.clientY
          origX = root.offsetLeft; origY = root.offsetTop
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

        let resizing = false, rStartX = 0, rOrigW = 0
        resizerEl.addEventListener('pointerdown', (e) => {
          if (root.classList.contains('dsg-collapsed')) return
          resizing = true; rStartX = e.clientX; rOrigW = root.offsetWidth
          try { resizerEl.setPointerCapture(e.pointerId) } catch {}
          e.preventDefault(); e.stopPropagation()
        })
        resizerEl.addEventListener('pointermove', (e) => {
          if (!resizing) return
          root.style.width = Math.min(MAX_W, Math.max(MIN_W, rOrigW + (e.clientX - rStartX))) + 'px'
        })
        const endResize = () => {
          if (!resizing) return
          resizing = false
          saveJSON('size', { width: root.offsetWidth })
        }
        resizerEl.addEventListener('pointerup', endResize)
        resizerEl.addEventListener('pointercancel', endResize)

        toggleEl.addEventListener('click', () => {
          const nowCollapsed = root.classList.toggle('dsg-collapsed')
          if (nowCollapsed) {
            root.style.width = ''
            toggleEl.textContent = '＋'; toggleEl.title = '展开'
          } else {
            root.style.width = sizeW + 'px'
            toggleEl.textContent = '−'; toggleEl.title = '缩小'
          }
          saveJSON('collapsed', nowCollapsed)
        })

        gearEl.addEventListener('click', () => root.classList.toggle('dsg-settings-open'))
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
