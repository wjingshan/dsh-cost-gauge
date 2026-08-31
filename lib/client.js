/**
 * dsh-cost-gauge 浏览器半身 —— 左上角浮动窗口，支持多皮肤切换。
 *
 * 数据层（宿主 /api/cost-gauge/state）所有皮肤共用；表现层由皮肤注册表分发：
 *   - classic  经典时钟（表盘 + 上弧里程表 + 翻牌时间 + 双状态灯）
 *   - minimal  极简数字（话费/余额/命中率/模型 + 状态灯）
 *   - ring     环形仪表（中间大数字余额 + 外圈进度环）
 *   - bar      迷你状态条（一行横向）
 *
 * 共用：数据轮询、每秒 tick、阈值/位置/大小/皮肤偏好、余额告警、明暗主题。
 * 数据经 `/api/cost-gauge/state?session=<id>` 拉取；零依赖、纯原生 JS。
 */
window.__ModuleLoader__.load({
  id: 'dsh-cost-gauge',
  factory: () => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const inject = ['sessions']

    const LS_PREFIX = 'dsh-cost-gauge'
    const DEFAULT_THRESHOLD = 10
    const POLL_MS = 5000
    const MIN_W = 200
    const MAX_W = 480
    const DEFAULT_W = 264

    const COL = {
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
  --dsg-bg:#000;--dsg-fg:#f5f5f5;--dsg-muted:#949494;
  --dsg-border:rgba(255,255,255,.16);--dsg-input-bg:rgba(255,255,255,.08);
  --dsg-pill-bg:#000;--dsg-pill-border:rgba(255,255,255,.32);
  --dsg-track:rgba(255,255,255,.12);--dsg-resize:rgba(255,255,255,.4);
  --dsg-flap-bg:#101010;--dsg-flap-fg:#f5f5f5;
  --dsg-disc:rgba(255,255,255,.045);
  --dsg-accent:${COL.accent};
  background:var(--dsg-bg);color:var(--dsg-fg);border:1px solid var(--dsg-border);
  border-radius:16px;box-shadow:0 12px 34px rgba(0,0,0,.5);padding:9px 12px 11px;
  user-select:none;-webkit-user-select:none}
@media (prefers-color-scheme: light){
  .dsg-root{--dsg-bg:#ffffff;--dsg-fg:#161616;--dsg-muted:#6d6d6d;
    --dsg-border:rgba(0,0,0,.16);--dsg-input-bg:rgba(0,0,0,.05);
    --dsg-pill-bg:#ffffff;--dsg-pill-border:rgba(0,0,0,.35);
    --dsg-track:rgba(0,0,0,.12);--dsg-resize:rgba(0,0,0,.4);
    --dsg-flap-bg:#e8e8e8;--dsg-flap-fg:#161616;
    --dsg-disc:rgba(0,0,0,.04);
    --dsg-accent:#2f6fb3;box-shadow:0 12px 30px rgba(0,0,0,.18)}
}
.dsg-title{display:flex;align-items:center;gap:6px;cursor:grab;padding-bottom:7px;
  border-bottom:1px solid var(--dsg-border);margin-bottom:7px}
.dsg-title:active{cursor:grabbing}
.dsg-title-text{flex:1;font-size:13px;font-weight:700;color:var(--dsg-fg);white-space:nowrap}
.dsg-alarm-dot{width:8px;height:8px;border-radius:50%;background:${COL.odoRed};flex:none;display:none}
.dsg-root.dsg-alarm .dsg-alarm-dot{display:block;animation:dsg-blink 1s ease-in-out infinite}
@keyframes dsg-blink{0%,100%{opacity:1;box-shadow:0 0 8px 2px rgba(195,13,35,.85)}
  50%{opacity:.12;box-shadow:none}}
.dsg-toggle,.dsg-gear{flex:none;border:none;background:transparent;color:var(--dsg-muted);cursor:pointer;
  font-size:15px;line-height:1;padding:2px 3px;width:20px;text-align:center}
.dsg-toggle:hover,.dsg-gear:hover{color:var(--dsg-fg)}
.dsg-gear{font-size:13px;color:var(--dsg-accent)}

.dsg-row{display:flex;justify-content:space-between;align-items:center;font-size:12px;
  color:var(--dsg-muted);padding:3px 0;line-height:1.2}
.dsg-val{color:var(--dsg-fg);font-variant-numeric:tabular-nums;font-weight:700}

/* 设置面板 */
.dsg-settings{display:none;margin-top:8px;padding-top:8px;border-top:1px solid var(--dsg-border)}
.dsg-root.dsg-settings-open .dsg-settings{display:block}
.dsg-settings label{font-size:11px;color:var(--dsg-muted);display:block;margin-bottom:4px}
.dsg-skin,.dsg-threshold{width:100%;box-sizing:border-box;background:var(--dsg-input-bg);
  border:1px solid var(--dsg-border);border-radius:8px;color:var(--dsg-fg);font-size:13px;padding:6px 8px}
.dsg-skin option{background:var(--dsg-bg);color:var(--dsg-fg)}
.dsg-threshold:focus,.dsg-skin:focus{outline:none;border-color:var(--dsg-accent)}
.dsg-pref-row{display:flex;align-items:center;gap:8px;margin-top:8px}
.dsg-pref-row label{font-size:11px;color:var(--dsg-muted);margin-bottom:0;display:block;flex:1}
.dsg-ring-w{width:56px;box-sizing:border-box;background:var(--dsg-input-bg);
  border:1px solid var(--dsg-border);border-radius:6px;color:var(--dsg-fg);font-size:12px;padding:4px 6px}
.dsg-color{width:34px;height:24px;padding:0;border:1px solid var(--dsg-border);
  border-radius:6px;background:transparent;cursor:pointer}
.dsg-color::-webkit-color-swatch-wrapper{padding:2px}
.dsg-color::-webkit-color-swatch{border:none;border-radius:4px}

.dsg-resizer{position:absolute;right:0;bottom:0;width:20px;height:20px;cursor:nwse-resize;touch-action:none}
.dsg-resizer::after{content:'';position:absolute;right:4px;bottom:4px;width:10px;height:10px;
  border-right:2px solid var(--dsg-resize);border-bottom:2px solid var(--dsg-resize);
  border-bottom-right-radius:3px}

/* ===== 经典时钟 ===== */
.dsg-clock{position:relative}
.dsg-clock svg{display:block;width:100%;height:auto}
.dsg-flapboard{position:absolute;left:50%;top:36%;transform:translate(-50%,-50%);
  display:flex;align-items:center;gap:1px;background:var(--dsg-pill-bg);
  border:1px solid var(--dsg-pill-border);border-radius:7px;padding:1.5px 3px;box-sizing:border-box;
  box-shadow:0 3px 10px rgba(0,0,0,.45)}
.dsg-flap-cell{position:relative;width:16px;height:21px;overflow:hidden;perspective:100px;
  background:var(--dsg-flap-bg);border-radius:3px}
.dsg-flap-char{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-size:16px;font-weight:700;color:var(--dsg-flap-fg);font-variant-numeric:tabular-nums;
  transform-origin:50% 0%}
.dsg-flap-colon{font-size:16px;font-weight:700;color:var(--dsg-fg);padding:0;line-height:1}
.dsg-flap-out{animation:dsg-flap-out .16s ease-in forwards;transform-origin:50% 0%}
.dsg-flap-in{animation:dsg-flap-in .22s ease-out both;transform-origin:50% 100%}
@keyframes dsg-flap-out{from{transform:rotateX(0deg);opacity:1}to{transform:rotateX(-90deg);opacity:.1}}
@keyframes dsg-flap-in{from{transform:rotateX(90deg);opacity:.1}to{transform:rotateX(0deg);opacity:1}}
.dsg-disc{fill:var(--dsg-disc)}
.dsg-ring{filter:url(#dsg-shadow)}
.dsg-ring-base{fill:none;stroke-width:10}
.dsg-ring-arc{fill:none;stroke-width:10;stroke-linecap:round;filter:url(#dsg-stack-green)}
.dsg-hand{transform-box:view-box;transform-origin:100px 100px;transform:rotate(0deg);
  transition:transform .6s cubic-bezier(.4,1.4,.6,1);filter:url(#dsg-glow-white)}
.dsg-hand line{stroke:var(--dsg-fg);stroke-width:3;stroke-linecap:round}
.dsg-hand circle{fill:var(--dsg-fg)}
.dsg-hub{fill:var(--dsg-fg);filter:url(#dsg-glow-white)}
.dsg-odo-track{fill:none;stroke:var(--dsg-track);stroke-width:11;stroke-linecap:round}
.dsg-odo-red{fill:none;stroke:${COL.odoRed};stroke-width:11;stroke-linecap:round;filter:url(#dsg-glow-red)}
.dsg-odo-fuel{fill:none;stroke:url(#dsg-odo-grad);stroke-width:11;stroke-linecap:round;filter:url(#dsg-glow-green)}
.dsg-odo-needle{stroke:${COL.odoNeedle};stroke-width:2.5;stroke-linecap:round;filter:url(#dsg-glow-orange)}
.dsg-odo-label{fill:var(--dsg-muted);font-size:11px;font-variant-numeric:tabular-nums}
.dsg-pill{fill:var(--dsg-pill-bg);stroke:var(--dsg-pill-border);stroke-width:.8;filter:url(#dsg-shadow)}
.dsg-pill-text{fill:var(--dsg-fg);font-size:12px;font-weight:700;text-anchor:middle;
  dominant-baseline:central;font-variant-numeric:tabular-nums}
.dsg-hit-label{fill:var(--dsg-muted);font-size:8.5px;text-anchor:middle}
.dsg-stars{pointer-events:none}
.dsg-star{animation:dsg-twinkle 1.1s ease-in-out infinite}
@keyframes dsg-twinkle{0%,100%{opacity:.9}35%{opacity:.3}55%{opacity:.85}75%{opacity:.45}}
.dsg-status-row{display:flex;justify-content:space-between;align-items:center;gap:8px;
  font-size:10.5px;margin-bottom:5px;min-height:13px}
.dsg-status{font-weight:700}
.dsg-status.dsg-idle{color:${COL.statusIdle}}
.dsg-status.dsg-busy{color:${COL.statusBusy}}
.dsg-countdown{color:var(--dsg-muted);white-space:nowrap;font-variant-numeric:tabular-nums;font-weight:700}
.dsg-bottom{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:5px}
.dsg-rows{flex:1;min-width:0}
.dsg-model{flex:none}
.dsg-model-pill{display:inline-block;position:relative;perspective:90px;
  background:var(--dsg-pill-bg);border:1px solid var(--dsg-pill-border);
  border-radius:8px;color:var(--dsg-fg);font-size:11px;font-weight:700;
  padding:3px 10px;box-shadow:0 2px 6px rgba(0,0,0,.35)}
.dsg-model-measure{visibility:hidden;white-space:nowrap;line-height:14px}
.dsg-model-inner{position:absolute;left:10px;right:10px;top:3px;line-height:14px;
  white-space:nowrap;text-align:center}
.dsg-model-out{animation:dsg-model-out .18s ease-in forwards;transform-origin:50% 0%}
.dsg-model-in{animation:dsg-model-in .24s ease-out both;transform-origin:50% 100%}
@keyframes dsg-model-out{from{transform:rotateX(0deg);opacity:1}to{transform:rotateX(-90deg);opacity:.1}}
@keyframes dsg-model-in{from{transform:rotateX(90deg);opacity:.1}to{transform:rotateX(0deg);opacity:1}}
.dsg-compact{display:none}
.dsg-collapsed .dsg-compact{display:block}
.dsg-collapsed .dsg-status-row,.dsg-collapsed .dsg-clock,.dsg-collapsed .dsg-bottom,
.dsg-collapsed .dsg-settings,.dsg-collapsed .dsg-resizer,.dsg-collapsed .dsg-gear{display:none}
.dsg-collapsed{width:176px}
.dsg-lamps{display:flex;align-items:center;gap:14px;margin-top:8px}
.dsg-lamp{display:flex;align-items:center;gap:5px;opacity:.16}
.dsg-lamp svg{display:block}
.dsg-root.dsg-idle .dsg-lamp.dsg-lamp-idle,.dsg-root.dsg-busy .dsg-lamp.dsg-lamp-busy{opacity:1}
.dsg-lamp-label{font-size:11px;color:var(--dsg-muted)}

/* ===== 极简数字 ===== */
.dsg-min-status{display:flex;align-items:center;gap:6px;font-size:12px;margin-bottom:4px}
.dsg-min-lamp{width:10px;height:10px;border-radius:50%;flex:none}
.dsg-min-lamp.idle{background:#22ac38;box-shadow:0 0 7px 2px rgba(34,172,56,.6)}
.dsg-min-lamp.busy{background:#fac000;box-shadow:0 0 7px 2px rgba(250,192,0,.6)}
.dsg-min-status-txt{font-weight:700}
.dsg-min-status-txt.idle{color:#4ade80}
.dsg-min-status-txt.busy{color:#fbbf24}
.dsg-min-count{margin-left:auto;color:var(--dsg-muted);font-size:11px}

/* ===== 环形仪表 ===== */
.dsg-ring-wrap{position:relative;width:170px;margin:0 auto}
.dsg-ring-wrap svg{display:block;width:100%;height:auto}
.dsg-rg-track{fill:none;stroke:var(--dsg-track);stroke-width:14}
.dsg-rg-red{fill:none;stroke:${COL.odoRed};stroke-width:14;stroke-linecap:round;filter:url(#dsg-glow-red)}
.dsg-rg-fuel{fill:none;stroke:url(#dsg-odo-grad);stroke-width:14;stroke-linecap:round;filter:url(#dsg-glow-green)}
.dsg-ring-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.dsg-ring-num{font-size:24px;font-weight:700;color:var(--dsg-fg);font-variant-numeric:tabular-nums}
.dsg-ring-label{font-size:11px;color:var(--dsg-muted);margin-top:2px}

/* ===== 迷你状态条 ===== */
.dsg-bar{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:12px}
.dsg-bar-lamp{width:10px;height:10px;border-radius:50%;flex:none}
.dsg-bar-lamp.idle{background:#22ac38;box-shadow:0 0 7px 2px rgba(34,172,56,.6)}
.dsg-bar-lamp.busy{background:#fac000;box-shadow:0 0 7px 2px rgba(250,192,0,.6)}
.dsg-bar-item{white-space:nowrap}
.dsg-bar-item i{font-style:normal;color:var(--dsg-muted);margin-right:3px}
.dsg-bar-item b{color:var(--dsg-fg);font-variant-numeric:tabular-nums;font-weight:700}
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
    function fmtWhole(v) {
      if (v === undefined || v === null || !Number.isFinite(v)) return '—'
      return '¥' + Math.round(v)
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
    function svgEl(tag, attrs) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
      for (const k in attrs) el.setAttribute(k, attrs[k])
      return el
    }
    function hitRateOf(tokens) {
      if (!tokens) return null
      const a = Number(tokens.uncachedInputTokens) || 0
      const b = Number(tokens.cacheReadTokens) || 0
      const den = a + b
      if (den <= 0) return null
      return Math.round((b / den) * 100)
    }
    function pricingLabel(pricingKey) {
      return pricingKey ? (pricingKey.charAt(0).toUpperCase() + pricingKey.slice(1)) : '—'
    }

    /* ================================================================
     * 皮肤
     * ================================================================ */
    const ODO_R = 72
    function odoAngle(f) { return 270 + f * 180 }
    function odoPath(r, f0, f1) { return arcPath(100, 100, r, odoAngle(f0), odoAngle(f1)) }

    function buildClockRing(ringEl, isWeekend, isPM, w, busyColor, idleColor) {
      ringEl.textContent = ''
      const mkCircle = (color) => {
        const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
        c.setAttribute('cx', '100'); c.setAttribute('cy', '100'); c.setAttribute('r', '90')
        c.setAttribute('class', 'dsg-ring-base')
        c.style.stroke = color; c.style.strokeWidth = w + 'px'
        return c
      }
      const mkArc = (a0, a1, color) => {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
        p.setAttribute('d', arcPath(100, 100, 90, a0, a1))
        p.setAttribute('class', 'dsg-ring-arc')
        p.style.stroke = color; p.style.strokeWidth = w + 'px'
        return p
      }
      if (isWeekend) { ringEl.appendChild(mkCircle(idleColor)); return }
      ringEl.appendChild(mkCircle(busyColor))
      ringEl.appendChild(mkArc(345, 405, idleColor))
      if (isPM) ringEl.appendChild(mkArc(165, 345, idleColor))
      else ringEl.appendChild(mkArc(45, 255, idleColor))
    }

    function renderOdometer(odoEl, balance, threshold, maxBalance) {
      const scale = (Number.isFinite(balance) && balance > 0)
        ? ((Number.isFinite(maxBalance) && maxBalance > 0) ? maxBalance : balance) : 100
      const fbal = Math.min(1, Math.max(0, (balance || 0) / scale))
      const fthr = Math.min(1, Math.max(0, threshold / scale))
      odoEl.textContent = ''
      odoEl.appendChild(svgEl('path', { class: 'dsg-odo-track', d: odoPath(ODO_R, 0, 1) }))
      odoEl.appendChild(svgEl('path', { class: 'dsg-odo-fuel', d: odoPath(ODO_R, 0, Math.max(fbal, 0.02)) }))
      odoEl.appendChild(svgEl('path', { class: 'dsg-odo-red', d: odoPath(ODO_R, 0, Math.max(fthr, 0.02)) }))
      const na = odoAngle(fbal)
      const [nx, ny] = polar(100, 100, 56, na)
      odoEl.appendChild(svgEl('line', { class: 'dsg-odo-needle', x1: '100', y1: '100', x2: nx.toFixed(2), y2: ny.toFixed(2) }))
      const l0 = svgEl('text', { class: 'dsg-odo-label', x: '36', y: '101', 'text-anchor': 'start' })
      l0.textContent = '¥0'
      const l1 = svgEl('text', { class: 'dsg-odo-label', x: '164', y: '101', 'text-anchor': 'end' })
      l1.textContent = fmtMoney(scale)
      const thrPos = polar(100, 100, 50, odoAngle(fthr))
      const l2 = svgEl('text', { class: 'dsg-odo-label', x: thrPos[0].toFixed(1), y: thrPos[1].toFixed(1), 'text-anchor': 'middle' })
      l2.textContent = fmtWhole(threshold)
      odoEl.appendChild(l0); odoEl.appendChild(l1); odoEl.appendChild(l2)
      return { scale, fbal, fthr }
    }

    function renderHitPill(pillG, text) {
      pillG.textContent = ''
      const label = svgEl('text', { class: 'dsg-hit-label', x: '100', y: '147' })
      label.textContent = '缓存命中'
      const rect = svgEl('rect', { class: 'dsg-pill', x: '81', y: '152', width: '38', height: '18', rx: '9' })
      const t = svgEl('text', { class: 'dsg-pill-text', x: '100', y: '161' })
      t.textContent = text
      pillG.appendChild(label); pillG.appendChild(rect); pillG.appendChild(t)
    }

    function setFlapChar(cell, ch) {
      if (cell.dataset.ch === ch) return
      const old = cell.firstElementChild
      const nw = document.createElement('span')
      nw.className = 'dsg-flap-char' + (old ? ' dsg-flap-in' : '')
      nw.textContent = ch
      cell.appendChild(nw)
      cell.dataset.ch = ch
      if (old) {
        old.classList.add('dsg-flap-out')
        old.addEventListener('animationend', () => old.remove(), { once: true })
      }
    }

    /** 星空皮肤：在空闲弧带内散布星星。多数为细小星点，少数为带十字星芒的亮星。 */
    function populateStars(layer, isWeekend, isPM, count = 60) {
      layer.textContent = ''
      const ranges = isWeekend
        ? [[0, 360]]
        : (isPM ? [[345, 405], [165, 345]] : [[345, 405], [45, 255]])
      const colors = ['#ffffff', '#ffffff', '#ffffff', '#ffe27a', '#ffe27a', '#c39bff', '#ff7a7a']
      function mkStar(x, y, r, color, bright) {
        if (!bright) {
          const c = svgEl('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: r.toFixed(2), fill: color })
          return c
        }
        const g = svgEl('g', {})
        const arm = r * 3.2
        g.appendChild(svgEl('line', { x1: (x - arm).toFixed(1), y1: y.toFixed(1), x2: (x + arm).toFixed(1), y2: y.toFixed(1), stroke: color, 'stroke-width': '0.55', 'stroke-linecap': 'round' }))
        g.appendChild(svgEl('line', { x1: x.toFixed(1), y1: (y - arm).toFixed(1), x2: x.toFixed(1), y2: (y + arm).toFixed(1), stroke: color, 'stroke-width': '0.55', 'stroke-linecap': 'round' }))
        g.appendChild(svgEl('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: (r * 0.65).toFixed(2), fill: '#ffffff' }))
        return g
      }
      for (let i = 0; i < count; i++) {
        const r = ranges[Math.floor(Math.random() * ranges.length)]
        const a = r[0] + Math.random() * (r[1] - r[0])
        const rad = 85 + Math.random() * 10
        const [x, y] = polar(100, 100, rad, a)
        const color = colors[Math.floor(Math.random() * colors.length)]
        const bright = Math.random() < 0.3
        const el = mkStar(x, y, bright ? (0.8 + Math.random() * 0.6) : (0.4 + Math.random() * 0.55), color, bright)
        el.setAttribute('class', 'dsg-star')
        el.style.animationDelay = (Math.random() * 1.6).toFixed(2) + 's'
        el.style.animationDuration = (0.7 + Math.random() * 1.1).toFixed(2) + 's'
        layer.appendChild(el)
      }
    }

    function buildLampSvg(color, lit, progressRes) {
      const C = 2 * Math.PI * 8
      const dash = lit ? (progressRes * C).toFixed(2) + ' ' + C.toFixed(2) : '0 ' + C.toFixed(2)
      const svg = svgEl('svg', { width: '22', height: '22', viewBox: '0 0 22 22' })
      svg.appendChild(svgEl('circle', { cx: '11', cy: '11', r: '9', fill: color, opacity: lit ? '0.28' : '0.12' }))
      const ring = svgEl('circle', { cx: '11', cy: '11', r: '8', fill: 'none', stroke: color, 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-dasharray': dash, transform: 'rotate(-90 11 11)' })
      const dot = svgEl('circle', { cx: '11', cy: '11', r: '3.6', fill: color })
      dot.style.opacity = lit ? '1' : '0.5'
      if (lit) dot.style.filter = `drop-shadow(0 0 4px ${color})`
      svg.appendChild(ring); svg.appendChild(dot)
      return svg
    }

    function progressRes(rate) {
      if (rate && Number.isFinite(rate.nextSwitchAt) && Number.isFinite(rate.periodStart)) {
        const total = rate.nextSwitchAt - rate.periodStart
        const remaining = rate.nextSwitchAt - Date.now()
        if (total > 0) return Math.min(1, Math.max(0, remaining / total))
      }
      return 0.5
    }

    function classicSkin(opts = {}) {
      const id = opts.id || 'classic'
      const name = opts.name || '经典时钟'
      const stars = !!opts.stars
      const DEFS = `
<defs>
  <linearGradient id="dsg-odo-grad" gradientUnits="userSpaceOnUse" x1="28" y1="100" x2="172" y2="30">
    <stop offset="0%" stop-color="#f39800"/><stop offset="100%" stop-color="#40b25d"/>
  </linearGradient>
  <linearGradient id="dsg-star-grad" gradientUnits="userSpaceOnUse" x1="100" y1="0" x2="100" y2="200">
    <stop offset="0%" stop-color="#070e52"/><stop offset="100%" stop-color="#001638"/>
  </linearGradient>
  <filter id="dsg-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2.5" stdDeviation="3" flood-color="#000000" flood-opacity="0.45"/></filter>
  <filter id="dsg-glow-green" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#40b25d" flood-opacity="0.55"/></filter>
  <filter id="dsg-glow-red" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.2" flood-color="#000000" flood-opacity="0.55"/><feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#c30d23" flood-opacity="0.6"/></filter>
  <filter id="dsg-glow-orange" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="2.5" flood-color="#f39800" flood-opacity="0.75"/></filter>
  <filter id="dsg-glow-white" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy="0" stdDeviation="2" flood-color="#ffffff" flood-opacity="0.4"/></filter>
  <filter id="dsg-stack-green" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.2" flood-color="#000000" flood-opacity="0.45"/></filter>
</defs>`
      return {
        id, name, collapsible: true,
        build(el, st) {
          el.innerHTML = `
<div class="dsg-status-row">
  <span class="dsg-status">—</span><span class="dsg-countdown"></span>
</div>
<div class="dsg-clock">
  <svg viewBox="0 0 200 200" aria-label="费率时钟">${DEFS}
    <circle class="dsg-disc" cx="100" cy="100" r="97"></circle>
    <g class="dsg-ring"></g><g class="dsg-stars"></g><g class="dsg-odo"></g>
    <circle class="dsg-hub" cx="100" cy="100" r="3.6"></circle>
    <g class="dsg-hand"><line x1="100" y1="100" x2="100" y2="42"></line><circle cx="100" cy="100" r="3.6"></circle></g>
    <g class="dsg-hit-pill"></g>
  </svg>
  <div class="dsg-flapboard">
    <span class="dsg-flap-cell"></span><span class="dsg-flap-cell"></span><span class="dsg-flap-colon">:</span><span class="dsg-flap-cell"></span><span class="dsg-flap-cell"></span>
  </div>
</div>
<div class="dsg-bottom">
  <div class="dsg-rows">
    <div class="dsg-row"><span>话费花费</span><span class="dsg-val dsg-cost">—</span></div>
    <div class="dsg-row"><span>余额</span><span class="dsg-val dsg-balance">—</span></div>
  </div>
  <div class="dsg-model"><span class="dsg-model-pill dsg-model-text"><span class="dsg-model-measure"></span></span></div>
</div>
<div class="dsg-compact">
  <div class="dsg-row"><span>话费</span><span class="dsg-val dsg-cost2">—</span></div>
  <div class="dsg-lamps">
    <span class="dsg-lamp dsg-lamp-idle"><span class="dsg-lamp-svg-idle"></span><span class="dsg-lamp-label">空闲</span></span>
    <span class="dsg-lamp dsg-lamp-busy"><span class="dsg-lamp-svg-busy"></span><span class="dsg-lamp-label">繁忙</span></span>
  </div>
  <div class="dsg-row"><span>余额</span><span class="dsg-val dsg-balance2">—</span></div>
</div>`
          const ringEl = el.querySelector('.dsg-ring')
          const starLayer = el.querySelector('.dsg-stars')
          const odoEl = el.querySelector('.dsg-odo')
          const handEl = el.querySelector('.dsg-hand')
          const hitPillEl = el.querySelector('.dsg-hit-pill')
          const statusEl = el.querySelector('.dsg-status')
          const countdownEl = el.querySelector('.dsg-countdown')
          const costEl = el.querySelector('.dsg-cost')
          const costEl2 = el.querySelector('.dsg-cost2')
          const balanceEl = el.querySelector('.dsg-balance')
          const balanceEl2 = el.querySelector('.dsg-balance2')
          const modelEl = el.querySelector('.dsg-model-text')
          const modelMeasure = el.querySelector('.dsg-model-measure')
          const idlePh = el.querySelector('.dsg-lamp-svg-idle')
          const busyPh = el.querySelector('.dsg-lamp-svg-busy')
          const flapCells = Array.from(el.querySelectorAll('.dsg-flap-cell'))
          let lastRingKey = null
          let lastData = null

          function setModelText(text) {
            if (modelEl.dataset.val === text) return
            modelMeasure.textContent = text
            const old = modelEl.querySelector('.dsg-model-inner')
            const nw = document.createElement('span')
            nw.className = 'dsg-model-inner' + (old ? ' dsg-model-in' : '')
            nw.textContent = text
            modelEl.appendChild(nw)
            modelEl.dataset.val = text
            if (old) {
              old.classList.add('dsg-model-out')
              old.addEventListener('animationend', () => old.remove(), { once: true })
            }
          }
          function renderRing() {
            const { w, busy, idle } = st.ringPrefs()
            const isPM = st.clock().h >= 12
            const dark = !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)
            const key = `${st.isWeekend()}|${isPM}|${w}|${busy}|${idle}|${dark && stars}`
            if (key !== lastRingKey) {
              lastRingKey = key
              const idleC = (stars && dark) ? 'url(#dsg-star-grad)' : idle
              buildClockRing(ringEl, st.isWeekend(), isPM, w, busy, idleC)
              if (stars && starLayer) {
                if (dark) populateStars(starLayer, st.isWeekend(), isPM)
                else starLayer.textContent = ''
              }
            }
          }
          function renderLamps(peak, rate) {
            const pr = progressRes(rate)
            idlePh.replaceChildren(buildLampSvg('#22ac38', !peak, pr))
            busyPh.replaceChildren(buildLampSvg('#fac000', peak, pr))
          }
          function updateFlap(c) {
            const hh = String(c.h).padStart(2, '0'), mm = String(c.m).padStart(2, '0')
            const chars = [hh[0], hh[1], mm[0], mm[1]]
            flapCells.forEach((cell, i) => setFlapChar(cell, chars[i]))
          }

          let mq = null
          let onTheme = null
          if (stars) {
            mq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null
            onTheme = () => { lastRingKey = null; if (lastData) skinApi.render(lastData) }
            if (mq && mq.addEventListener) mq.addEventListener('change', onTheme)
          }

          const skinApi = {
            render(data) {
              lastData = data
              const peak = !!(data.rate && data.rate.peak)
              el.classList.toggle('dsg-busy', peak)
              el.classList.toggle('dsg-idle', !peak)
              statusEl.className = 'dsg-status ' + (peak ? 'dsg-busy' : 'dsg-idle')
              statusEl.textContent = peak ? '繁忙（高峰）' : '空闲（标准）'
              const cost = data.cost
              const costText = cost && Number.isFinite(cost.cost) ? fmtMoney(cost.cost) : '—'
              costEl.textContent = costText; costEl2.textContent = costText
              const hr = hitRateOf(cost && cost.tokens)
              renderHitPill(hitPillEl, hr === null ? '--%' : hr + '%')
              setModelText(pricingLabel(cost && cost.pricingKey))
              const bal = data.balance
              if (bal && bal.total !== undefined && Number.isFinite(bal.total)) {
                const t = fmtMoney(bal.total)
                balanceEl.textContent = t; balanceEl2.textContent = t
                renderOdometer(odoEl, bal.total, st.threshold(), st.maxBalance())
              } else {
                balanceEl.textContent = '—'; balanceEl2.textContent = '—'
                renderOdometer(odoEl, 0, st.threshold(), st.maxBalance())
              }
              renderRing()
              renderLamps(peak, data.rate)
            },
            tick(c) {
              handEl.style.transform = 'rotate(' + handAngle12(c) + 'deg)'
              updateFlap(c)
              const rate = st.rate()
              if (rate && Number.isFinite(rate.nextSwitchAt)) {
                const s = Math.max(0, Math.round((rate.nextSwitchAt - Date.now()) / 1000))
                countdownEl.textContent = fmtCountdown(s)
              }
              if (rate) renderLamps(el.classList.contains('dsg-busy'), rate)
              renderRing()
            },
            destroy() {
              if (stars && mq && mq.removeEventListener) mq.removeEventListener('change', onTheme)
            }
          }
          return skinApi
        }
      }
    }

    function minimalSkin() {
      return {
        id: 'minimal', name: '极简数字', collapsible: false,
        build(el, st) {
          el.innerHTML = `
<div class="dsg-min-status"><span class="dsg-min-lamp"></span><span class="dsg-min-status-txt">—</span><span class="dsg-min-count"></span></div>
<div class="dsg-rows">
  <div class="dsg-row"><span>话费</span><span class="dsg-val dsg-min-cost">—</span></div>
  <div class="dsg-row"><span>余额</span><span class="dsg-val dsg-min-bal">—</span></div>
  <div class="dsg-row"><span>命中率</span><span class="dsg-val dsg-min-hit">—</span></div>
  <div class="dsg-row"><span>模型</span><span class="dsg-val dsg-min-model">—</span></div>
</div>`
          const lamp = el.querySelector('.dsg-min-lamp')
          const stxt = el.querySelector('.dsg-min-status-txt')
          const cnt = el.querySelector('.dsg-min-count')
          const costEl = el.querySelector('.dsg-min-cost')
          const balEl = el.querySelector('.dsg-min-bal')
          const hitEl = el.querySelector('.dsg-min-hit')
          const modelEl = el.querySelector('.dsg-min-model')
          return {
            render(data) {
              const peak = !!(data.rate && data.rate.peak)
              lamp.className = 'dsg-min-lamp ' + (peak ? 'busy' : 'idle')
              stxt.className = 'dsg-min-status-txt ' + (peak ? 'busy' : 'idle')
              stxt.textContent = peak ? '繁忙（高峰）' : '空闲（标准）'
              const cost = data.cost
              costEl.textContent = cost && Number.isFinite(cost.cost) ? fmtMoney(cost.cost) : '—'
              const hr = hitRateOf(cost && cost.tokens)
              hitEl.textContent = hr === null ? '—' : hr + '%'
              modelEl.textContent = pricingLabel(cost && cost.pricingKey)
              const bal = data.balance
              balEl.textContent = bal && Number.isFinite(bal.total) ? fmtMoney(bal.total) : '—'
            },
            tick() {
              const rate = st.rate()
              cnt.textContent = (rate && Number.isFinite(rate.nextSwitchAt))
                ? fmtCountdown(Math.max(0, Math.round((rate.nextSwitchAt - Date.now()) / 1000))) : ''
            },
            destroy() {}
          }
        }
      }
    }

    function ringSkin() {
      return {
        id: 'ring', name: '环形仪表', collapsible: false,
        build(el, st) {
          el.innerHTML = `
<div class="dsg-ring-wrap">
  <svg viewBox="0 0 200 200">
    <defs>
      <linearGradient id="dsg-odo-grad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="200" y2="200">
        <stop offset="0%" stop-color="#f39800"/><stop offset="100%" stop-color="#40b25d"/>
      </linearGradient>
      <filter id="dsg-shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#000" flood-opacity="0.45"/></filter>
      <filter id="dsg-glow-green" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#40b25d" flood-opacity="0.55"/></filter>
      <filter id="dsg-glow-red" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#c30d23" flood-opacity="0.6"/></filter>
    </defs>
    <circle class="dsg-rg-track" cx="100" cy="100" r="82" transform="rotate(-90 100 100)"></circle>
    <circle class="dsg-rg-fuel" cx="100" cy="100" r="82" transform="rotate(-90 100 100)" stroke-dasharray="0 515.22"></circle>
    <circle class="dsg-rg-red" cx="100" cy="100" r="82" transform="rotate(-90 100 100)" stroke-dasharray="0 515.22"></circle>
  </svg>
  <div class="dsg-ring-center"><div class="dsg-ring-num">—</div><div class="dsg-ring-label">余额</div></div>
</div>
<div class="dsg-rows">
  <div class="dsg-row"><span>话费</span><span class="dsg-val dsg-rg-cost">—</span></div>
  <div class="dsg-row"><span>命中率</span><span class="dsg-val dsg-rg-hit">—</span></div>
  <div class="dsg-row"><span>模型</span><span class="dsg-val dsg-rg-model">—</span></div>
</div>`
          const C = 2 * Math.PI * 82
          const fuel = el.querySelector('.dsg-rg-fuel')
          const red = el.querySelector('.dsg-rg-red')
          const num = el.querySelector('.dsg-ring-num')
          const costEl = el.querySelector('.dsg-rg-cost')
          const hitEl = el.querySelector('.dsg-rg-hit')
          const modelEl = el.querySelector('.dsg-rg-model')
          function setArc(circle, f) {
            const fv = Math.max(0, Math.min(1, f))
            circle.setAttribute('stroke-dasharray', (fv * C).toFixed(2) + ' ' + C.toFixed(2))
            circle.setAttribute('stroke-dashoffset', '0')
          }
          return {
            render(data) {
              const bal = data.balance
              const total = bal && Number.isFinite(bal.total) ? bal.total : 0
              num.textContent = Number.isFinite(total) ? fmtMoney(total) : '—'
              const scale = (Number.isFinite(total) && total > 0) ? (st.maxBalance() || total) : 100
              const fbal = total / scale
              const fthr = st.threshold() / scale
              setArc(fuel, fbal)
              setArc(red, fthr)
              const cost = data.cost
              costEl.textContent = cost && Number.isFinite(cost.cost) ? fmtMoney(cost.cost) : '—'
              const hr = hitRateOf(cost && cost.tokens)
              hitEl.textContent = hr === null ? '—' : hr + '%'
              modelEl.textContent = pricingLabel(cost && cost.pricingKey)
            },
            tick() {},
            destroy() {}
          }
        }
      }
    }

    function barSkin() {
      return {
        id: 'bar', name: '迷你状态条', collapsible: false,
        build(el, st) {
          el.innerHTML = `
<div class="dsg-bar">
  <span class="dsg-bar-lamp"></span>
  <span class="dsg-bar-item"><i>模型</i><b class="dsg-bar-model">—</b></span>
  <span class="dsg-bar-item"><i>命中率</i><b class="dsg-bar-hit">—</b></span>
  <span class="dsg-bar-item"><i>话费</i><b class="dsg-bar-cost">—</b></span>
  <span class="dsg-bar-item"><i>余额</i><b class="dsg-bar-bal">—</b></span>
</div>`
          const lamp = el.querySelector('.dsg-bar-lamp')
          const modelEl = el.querySelector('.dsg-bar-model')
          const hitEl = el.querySelector('.dsg-bar-hit')
          const costEl = el.querySelector('.dsg-bar-cost')
          const balEl = el.querySelector('.dsg-bar-bal')
          return {
            render(data) {
              const peak = !!(data.rate && data.rate.peak)
              lamp.className = 'dsg-bar-lamp ' + (peak ? 'busy' : 'idle')
              const cost = data.cost
              costEl.textContent = cost && Number.isFinite(cost.cost) ? fmtMoney(cost.cost) : '—'
              const hr = hitRateOf(cost && cost.tokens)
              hitEl.textContent = hr === null ? '—' : hr + '%'
              modelEl.textContent = pricingLabel(cost && cost.pricingKey)
              const bal = data.balance
              balEl.textContent = bal && Number.isFinite(bal.total) ? fmtMoney(bal.total) : '—'
            },
            tick() {},
            destroy() {}
          }
        }
      }
    }

    const SKINS = [
      classicSkin(),
      classicSkin({ id: 'test1', name: '测试1', stars: true }),
      minimalSkin(),
      ringSkin(),
      barSkin(),
    ]
    const SKIN_BY_ID = {}
    for (const s of SKINS) SKIN_BY_ID[s.id] = s

    /* ================================================================
     * apply：共用壳 + 数据轮询 + 皮肤挂载
     * ================================================================ */
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
  <button class="dsg-gear" type="button" title="设置">⚙</button>
</div>
<div class="dsg-body"></div>
<div class="dsg-settings">
  <label>皮肤</label>
  <select class="dsg-skin"></select>
  <label style="margin-top:8px">余额报警阈值（人民币）</label>
  <input class="dsg-threshold" type="number" min="0" step="1" inputmode="decimal">
  <div class="dsg-classic-prefs" style="margin-top:8px">
    <div class="dsg-pref-row"><label>外圈粗细（px）</label><input class="dsg-ring-w" type="number" min="3" max="20" step="1"></div>
    <div class="dsg-pref-row"><label>繁忙颜色</label><input class="dsg-ring-busy dsg-color" type="color"></div>
    <div class="dsg-pref-row"><label>空闲颜色</label><input class="dsg-ring-idle dsg-color" type="color"></div>
  </div>
</div>
<div class="dsg-resizer" data-resize title="拖拽缩放"></div>
`
        document.body.appendChild(root)

        const titleEl = root.querySelector('.dsg-title')
        const alarmDotEl = root.querySelector('.dsg-alarm-dot')
        const toggleEl = root.querySelector('.dsg-toggle')
        const gearEl = root.querySelector('.dsg-gear')
        const bodyEl = root.querySelector('.dsg-body')
        const skinSelect = root.querySelector('.dsg-skin')
        const thresholdEl = root.querySelector('.dsg-threshold')
        const classicPrefsEl = root.querySelector('.dsg-classic-prefs')
        const ringWEl = root.querySelector('.dsg-ring-w')
        const ringBusyEl = root.querySelector('.dsg-ring-busy')
        const ringIdleEl = root.querySelector('.dsg-ring-idle')
        const resizerEl = root.querySelector('.dsg-resizer')

        for (const s of SKINS) {
          const o = document.createElement('option')
          o.value = s.id
          o.textContent = s.name
          skinSelect.appendChild(o)
        }

        const savedPos = loadJSON('pos')
        root.style.left = (savedPos && typeof savedPos.x === 'number' ? savedPos.x : 24) + 'px'
        root.style.top = (savedPos && typeof savedPos.y === 'number' ? savedPos.y : 96) + 'px'
        const savedSize = loadJSON('size')
        const sizeW = savedSize && typeof savedSize.width === 'number'
          ? Math.min(MAX_W, Math.max(MIN_W, savedSize.width)) : DEFAULT_W
        root.style.width = sizeW + 'px'

        let localThreshold = loadLocalThreshold()
        let maxBalance = loadMaxBalance()
        let lastData = null
        let lastRate = null
        let lastClock = beijingClock()
        let lastWeekend = null
        let skinId = loadJSON('skin') || 'classic'
        if (!SKIN_BY_ID[skinId]) skinId = 'classic'
        let collapsed = loadJSON('collapsed') === true
        let ringW = (() => { const n = Number(loadJSON('ringWidth')); return Number.isFinite(n) && n >= 3 && n <= 20 ? Math.round(n) : 10 })()
        let ringBusy = loadJSON('ringBusy') || COL.busyRing
        let ringIdle = loadJSON('ringIdle') || COL.idleRing
        let currentSkinEl = null

        ringWEl.value = String(ringW)
        ringBusyEl.value = ringBusy
        ringIdleEl.value = ringIdle
        skinSelect.value = skinId

        const st = {
          threshold: () => (localThreshold !== null ? localThreshold : (lastData && Number.isFinite(lastData.threshold) ? lastData.threshold : DEFAULT_THRESHOLD)),
          rate: () => lastRate,
          clock: () => lastClock,
          isWeekend: () => !!lastWeekend,
          maxBalance: () => maxBalance,
          ringPrefs: () => ({ w: ringW, busy: ringBusy, idle: ringIdle }),
        }

        function mountSkin(id) {
          if (currentSkinEl) { try { currentSkinEl.destroy() } catch (e) {} }
          bodyEl.textContent = ''
          const sk = SKIN_BY_ID[id] || SKIN_BY_ID.classic
          skinId = sk.id
          skinSelect.value = sk.id
          toggleEl.style.display = sk.collapsible ? '' : 'none'
          resizerEl.style.display = (sk.id === 'classic') ? '' : 'none'
          classicPrefsEl.style.display = (sk.id === 'classic') ? '' : 'none'
          const isCollapsed = collapsed && sk.collapsible
          root.classList.toggle('dsg-collapsed', isCollapsed)
          root.style.width = isCollapsed ? '' : sizeW + 'px'
          currentSkinEl = sk.build(bodyEl, st)
          if (lastData) currentSkinEl.render(lastData, st)
          saveJSON('skin', sk.id)
        }

        function render(data) {
          lastData = data
          lastRate = data.rate || null
          if (data.schedule) lastWeekend = !!data.schedule.isWeekend
          const thr = st.threshold()
          const bal = data.balance
          if (bal && bal.total !== undefined && Number.isFinite(bal.total)) {
            const low = bal.total < thr
            root.classList.toggle('dsg-alarm', low)
            if (maxBalance === null || bal.total > maxBalance) { maxBalance = bal.total; saveMaxBalance(maxBalance) }
            alarmDotEl.title = low
              ? `余额 ¥${bal.total.toFixed(2)} 低于阈值 ¥${thr}，报警中`
              : `余额 ¥${bal.total.toFixed(2)}（阈值 ¥${thr}）`
          } else {
            root.classList.remove('dsg-alarm')
            alarmDotEl.title = (bal && bal.error) ? bal.error : '余额未知'
          }
          thresholdEl.value = String(thr)
          if (currentSkinEl) currentSkinEl.render(data, st)
        }

        function tick() {
          lastClock = beijingClock()
          if (currentSkinEl && currentSkinEl.tick) currentSkinEl.tick(lastClock, st)
        }

        async function poll() {
          let sid
          try { sid = ctx.sessions.list.getSnapshot().current } catch {}
          const url = '/api/cost-gauge/state' + (sid ? '?session=' + encodeURIComponent(sid) : '')
          try {
            const res = await fetch(url)
            if (!res.ok) throw new Error('HTTP ' + res.status)
            render(await res.json())
          } catch (e) {
            render({ balance: { error: (e && e.message) || String(e) }, rate: null, cost: null, schedule: null, threshold: DEFAULT_THRESHOLD })
          }
        }

        // 拖动
        let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0
        titleEl.addEventListener('pointerdown', (e) => {
          if (e.target.closest('button, .dsg-alarm-dot')) return
          dragging = true; sx = e.clientX; sy = e.clientY; ox = root.offsetLeft; oy = root.offsetTop
          try { titleEl.setPointerCapture(e.pointerId) } catch {}
          e.preventDefault()
        })
        titleEl.addEventListener('pointermove', (e) => {
          if (!dragging) return
          root.style.left = Math.max(0, ox + (e.clientX - sx)) + 'px'
          root.style.top = Math.max(0, oy + (e.clientY - sy)) + 'px'
        })
        const endDrag = () => { if (dragging) { dragging = false; saveJSON('pos', { x: root.offsetLeft, y: root.offsetTop }) } }
        titleEl.addEventListener('pointerup', endDrag)
        titleEl.addEventListener('pointercancel', endDrag)

        // 缩放（仅经典）
        let resizing = false, rx = 0, rw = 0
        resizerEl.addEventListener('pointerdown', (e) => {
          if (root.classList.contains('dsg-collapsed')) return
          resizing = true; rx = e.clientX; rw = root.offsetWidth
          try { resizerEl.setPointerCapture(e.pointerId) } catch {}
          e.preventDefault(); e.stopPropagation()
        })
        resizerEl.addEventListener('pointermove', (e) => {
          if (!resizing) return
          root.style.width = Math.min(MAX_W, Math.max(MIN_W, rw + (e.clientX - rx))) + 'px'
        })
        const endResize = () => { if (resizing) { resizing = false; saveJSON('size', { width: root.offsetWidth }) } }
        resizerEl.addEventListener('pointerup', endResize)
        resizerEl.addEventListener('pointercancel', endResize)

        gearEl.addEventListener('click', () => root.classList.toggle('dsg-settings-open'))
        toggleEl.addEventListener('click', () => {
          collapsed = !collapsed
          saveJSON('collapsed', collapsed)
          root.classList.toggle('dsg-collapsed', collapsed)
          root.style.width = collapsed ? '' : sizeW + 'px'
          toggleEl.textContent = collapsed ? '＋' : '−'
          toggleEl.title = collapsed ? '展开' : '缩小'
        })

        thresholdEl.addEventListener('change', () => {
          const n = Number(thresholdEl.value)
          if (Number.isFinite(n) && n >= 0) {
            localThreshold = n
            saveLocalThreshold(n)
            if (lastData) render(lastData)
          } else {
            thresholdEl.value = String(st.threshold())
          }
        })

        skinSelect.addEventListener('change', () => mountSkin(skinSelect.value))

        function applyRingPrefs() { if (lastData) render(lastData) }
        ringWEl.addEventListener('change', () => {
          const n = Number(ringWEl.value)
          if (Number.isFinite(n)) { ringW = Math.min(20, Math.max(3, Math.round(n))); ringWEl.value = String(ringW); saveJSON('ringWidth', ringW); applyRingPrefs() }
          else ringWEl.value = String(ringW)
        })
        ringBusyEl.addEventListener('input', () => { ringBusy = ringBusyEl.value || COL.busyRing; saveJSON('ringBusy', ringBusy); applyRingPrefs() })
        ringIdleEl.addEventListener('input', () => { ringIdle = ringIdleEl.value || COL.idleRing; saveJSON('ringIdle', ringIdle); applyRingPrefs() })

        mountSkin(skinId)
        poll()
        tick()
        const pollTimer = setInterval(poll, POLL_MS)
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
