/**
 * dsh-cost-gauge 浏览器半身 —— 在页面左上角挂一个方形浮动窗口：
 *   - 顶部小红灯：余额低于设定阈值时闪烁报警；
 *   - 指针式费率表：指针指向「标准（空闲）」或「翻倍（高峰）」；
 *   - 显示当前会话花费与账户余额；
 *   - 可拖动、可设置余额阈值（localStorage 持久化）。
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

    const CSS = `
.dsg-root{position:fixed;z-index:2147483000;width:216px;box-sizing:border-box;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  background:rgba(20,22,28,.94);color:#e5e7eb;border:1px solid rgba(255,255,255,.10);
  border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.38);padding:10px 12px 12px;
  user-select:none;-webkit-user-select:none}
.dsg-title{display:flex;align-items:center;gap:8px;cursor:grab;padding-bottom:8px;
  border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:10px}
.dsg-title:active{cursor:grabbing}
.dsg-title-text{flex:1;font-size:13px;font-weight:600;color:#f3f4f6}
.dsg-light{width:10px;height:10px;border-radius:50%;background:#4b5563;flex:none}
.dsg-root.dsg-ok .dsg-light{background:#22c55e;box-shadow:0 0 6px 1px rgba(34,197,94,.5)}
.dsg-root.dsg-alarm .dsg-light{background:#ef4444;animation:dsg-blink 1s ease-in-out infinite}
@keyframes dsg-blink{0%,100%{opacity:1;box-shadow:0 0 9px 3px rgba(239,68,68,.85)}
  50%{opacity:.12;box-shadow:none}}
.dsg-gear{flex:none;border:none;background:transparent;color:#9ca3af;cursor:pointer;
  font-size:14px;line-height:1;padding:2px}
.dsg-gear:hover{color:#e5e7eb}
.dsg-gauge{text-align:center}
.dsg-gauge svg{display:block;margin:0 auto}
.dsg-arc-bg{fill:none;stroke:rgba(255,255,255,.12);stroke-width:10;stroke-linecap:round}
.dsg-arc-std{fill:none;stroke:#22c55e;stroke-width:10;stroke-linecap:round}
.dsg-arc-peak{fill:none;stroke:#f59e0b;stroke-width:10;stroke-linecap:round}
.dsg-needle{transform-box:view-box;transform-origin:70px 70px;transform:rotate(-58deg);
  transition:transform .7s cubic-bezier(.34,1.56,.64,1)}
.dsg-root.dsg-peak .dsg-needle{transform:rotate(58deg)}
.dsg-needle line{stroke:#f9fafb;stroke-width:3;stroke-linecap:round}
.dsg-needle circle{fill:#f9fafb}
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

    function loadPos() {
      try {
        const raw = localStorage.getItem(LS_PREFIX + ':pos')
        if (raw) {
          const p = JSON.parse(raw)
          if (typeof p.x === 'number' && typeof p.y === 'number') return p
        }
      } catch {}
      return null
    }

    function savePos(p) {
      try { localStorage.setItem(LS_PREFIX + ':pos', JSON.stringify(p)) } catch {}
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

    function apply(ctx) {
      ctx.effect(() => {
        injectCss()

        const root = document.createElement('div')
        root.className = 'dsg-root'
        root.innerHTML = `
<div class="dsg-title" data-drag>
  <span class="dsg-title-text">DeepSeek 花费</span>
  <span class="dsg-light" title="余额预警灯"></span>
  <button class="dsg-gear" type="button" title="设置余额阈值">⚙</button>
</div>
<div class="dsg-gauge">
  <svg width="140" height="86" viewBox="0 0 140 88">
    <path class="dsg-arc-bg" d="M 15 70 A 55 55 0 0 1 125 70"></path>
    <path class="dsg-arc-std" d="M 15 70 A 55 55 0 0 1 70 15"></path>
    <path class="dsg-arc-peak" d="M 70 15 A 55 55 0 0 1 125 70"></path>
    <g class="dsg-needle">
      <line x1="70" y1="70" x2="70" y2="24"></line>
      <circle cx="70" cy="70" r="4.5"></circle>
    </g>
    <text x="13" y="85" class="dsg-gauge-label" text-anchor="start">标准</text>
    <text x="127" y="85" class="dsg-gauge-label" text-anchor="end">翻倍</text>
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
`
        document.body.appendChild(root)

        const titleEl = root.querySelector('.dsg-title')
        const lightEl = root.querySelector('.dsg-light')
        const gearEl = root.querySelector('.dsg-gear')
        const statusEl = root.querySelector('.dsg-status')
        const costEl = root.querySelector('.dsg-cost')
        const balanceEl = root.querySelector('.dsg-balance')
        const countdownEl = root.querySelector('.dsg-countdown')
        const thresholdEl = root.querySelector('.dsg-threshold')

        // 初始位置：左侧靠上（localStorage 记忆）。
        const saved = loadPos()
        root.style.left = (saved ? saved.x : 24) + 'px'
        root.style.top = (saved ? saved.y : 96) + 'px'

        let localThreshold = loadLocalThreshold()
        let lastData = null

        function currentThreshold(data) {
          if (localThreshold !== null) return localThreshold
          if (data && data.threshold !== undefined && Number.isFinite(data.threshold)) return data.threshold
          return DEFAULT_THRESHOLD
        }

        function render(data) {
          const threshold = currentThreshold(data)

          // 费率指针 + 状态文案 + 倒计时。
          const peak = !!(data.rate && data.rate.peak)
          root.classList.toggle('dsg-peak', peak)
          statusEl.className = 'dsg-status ' + (peak ? 'dsg-peak' : 'dsg-std')
          statusEl.textContent = peak ? '当前费率：翻倍（高峰）' : '当前费率：标准（空闲）'
          countdownEl.textContent = data.rate ? fmtCountdown(data.rate.countdownSeconds) : ''

          // 会话花费。
          const cost = data.cost
          costEl.textContent = cost && Number.isFinite(cost.cost) ? fmtMoney(cost.cost) : '—'

          // 余额 + 红灯。
          const bal = data.balance
          if (bal && bal.total !== undefined && Number.isFinite(bal.total)) {
            balanceEl.textContent = fmtMoney(bal.total)
            const low = bal.total < threshold
            root.classList.toggle('dsg-alarm', low)
            root.classList.toggle('dsg-ok', !low)
            lightEl.title = low
              ? `余额 ¥${bal.total.toFixed(2)} 低于阈值 ¥${threshold}，报警中`
              : `余额 ¥${bal.total.toFixed(2)}（阈值 ¥${threshold}）`
          } else {
            balanceEl.textContent = bal && bal.error ? '查询失败' : '—'
            root.classList.remove('dsg-alarm', 'dsg-ok')
            lightEl.title = (bal && bal.error) ? bal.error : '余额未知'
          }

          thresholdEl.value = String(threshold)
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

        // 拖动（标题栏）。
        let dragging = false
        let startX = 0
        let startY = 0
        let origX = 0
        let origY = 0
        titleEl.addEventListener('pointerdown', (e) => {
          if (e.target.closest('.dsg-gear')) return
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
          const dx = e.clientX - startX
          const dy = e.clientY - startY
          root.style.left = Math.max(0, origX + dx) + 'px'
          root.style.top = Math.max(0, origY + dy) + 'px'
        })
        const endDrag = (e) => {
          if (!dragging) return
          dragging = false
          savePos({ x: root.offsetLeft, y: root.offsetTop })
        }
        titleEl.addEventListener('pointerup', endDrag)
        titleEl.addEventListener('pointercancel', endDrag)

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

        // 首次拉取 + 定时轮询。
        poll()
        const timer = setInterval(poll, POLL_MS)

        return () => {
          clearInterval(timer)
          root.remove()
        }
      }, 'dsh-cost-gauge: widget')
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
