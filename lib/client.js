window.__ModuleLoader__.load({
  id: 'dsh-cost-gauge',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    /** 客户端依赖的 cordis 服务：sessions（读当前会话）。 */
    const inject = ['sessions']

    // core 是同包的按需 chunk：宿主不会自动注册它，必须经 require.async 取。
    const loadCore = () => require.async('./client.core.js')

    /* ================================================================
     * apply：浮窗挂载 + 数据轮询 + 拖动/缩放 + 记录面板 + 竖版停靠 + 磨砂玻璃
     * 语言状态由 core 持有（core.setLocale）；其余工具函数自 core 转发。
     * ================================================================ */
    async function apply(ctx) {
      const core = await loadCore()
      const {
      LS_PREFIX, DEFAULT_THRESHOLD, POLL_MS, TICK_MS, DEFAULT_W, MIN_W, MAX_W, MINI_W, ARC_W,
      CSS, I18N, localeTag, detectLocale, injectCss,
      loadLocalThreshold, saveLocalThreshold, loadJSON, saveJSON,
      fmtMoney, fmtTurnCost, fmtRemain,
      setModelBadge, modelColorOf, beijingPartsNow, dialPosOfHour,
      RATE_R, BAL_R, BAL_LO, BAL_HI, RATE_CAP_DEG,
      arcXY, arcD, arcBand, dialArcsFor, ticksMarkup,
      t,
      } = core
      // 语言在挂载时确定一次；挂载后固定，不做运行时热切换。
      core.setLocale(detectLocale(ctx))
      ctx.effect(() => {
        injectCss()

        const root = document.createElement('div')
        // 只保留明度（去色相/饱和度）+ 让每个颜色的不透明度 = 它的明度（Rec.709 相对亮度）
        const lumaId = 'dsg-luma-' + Math.random().toString(36).slice(2, 8)
        root.className = 'dsg-root'
        root.innerHTML = `
<div class="dsg-bg"></div>
<div class="dsg-frost"></div>
<div class="dsg-bar"></div>
<div class="dsg-hourglass" hidden>
  <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true" focusable="false">
    <defs>
      <clipPath id="dsg-hg-clip">
        <path d="M5 2.2h10c0 2.9-2 4-3.9 6.7v2.2c1.9 2.7 3.9 3.8 3.9 6.7H5c0-2.9 2-4 3.9-6.7v-2.2C7 6.2 5 5.1 5 2.2z"></path>
      </clipPath>
    </defs>
    <g clip-path="url(#dsg-hg-clip)">
      <rect class="dsg-hg-top" x="3" y="2" width="14" height="7.5"></rect>
      <rect class="dsg-hg-bot" x="3" y="18" width="14" height="0"></rect>
      <rect class="dsg-hg-fall" x="9.3" y="8.6" width="1.4" height="3.2"></rect>
    </g>
    <path class="dsg-hg-frame" d="M5 2.2h10c0 2.9-2 4-3.9 6.7v2.2c1.9 2.7 3.9 3.8 3.9 6.7H5c0-2.9 2-4 3.9-6.7v-2.2C7 6.2 5 5.1 5 2.2z"></path>
  </svg>
</div>
<svg class="dsg-filters" width="0" height="0" aria-hidden="true" focusable="false"
     style="position:absolute;width:0;height:0;overflow:hidden"></svg>
<div class="dsg-title" data-drag>
  <span class="dsg-title-text">${t('appTitle')}</span>
  <span class="dsg-badge">Basic</span>
  <span class="dsg-light" title="${t('balanceLight')}"></span>
  <button class="dsg-iconbtn dsg-min" type="button" title="${t('minimize')}">—</button>
  <button class="dsg-iconbtn dsg-gear" type="button" title="${t('gearTitle')}">⚙</button>
</div>
<div class="dsg-gauge">
  <button class="dsg-actbtn dsg-record" type="button" title="${t('viewRecords')}">🗒</button>
  <button class="dsg-actbtn dsg-zero" type="button" title="${t('resetCostHint')}">↺</button>
  <svg width="140" height="90" viewBox="0 0 140 90">
    <defs>
      <linearGradient id="dsg-bal-grad" gradientUnits="userSpaceOnUse" x1="23" y1="70" x2="117" y2="70">
        <stop offset="0" stop-color="#1e6fd9"></stop>
        <stop offset="1" stop-color="#59d2fe"></stop>
      </linearGradient>
    </defs>
    <path class="dsg-bal-track" d=""></path>
    <path class="dsg-bal-fill" d=""></path>
    <line class="dsg-bal-mark" x1="70" y1="70" x2="70" y2="70"></line>
    <path class="dsg-arc-std" d=""></path>
    <path class="dsg-arc-peak" d=""></path>
    <g class="dsg-ticks"></g>
    <g class="dsg-needle">
      <line class="dsg-hand-bg" x1="70" y1="70" x2="70" y2="14"></line>
      <line class="dsg-hand" x1="70" y1="70" x2="70" y2="14"></line>
      <line class="dsg-tail-bg" x1="70" y1="70" x2="70" y2="79"></line>
      <line class="dsg-tail" x1="70" y1="70" x2="70" y2="79"></line>
      <circle class="dsg-cap-rim" cx="70" cy="70" r="5.5"></circle>
      <circle class="dsg-cap" cx="70" cy="70" r="4"></circle>
    </g>
  </svg>
  <div class="dsg-meta">
    <div class="dsg-meta-col">
      <span class="dsg-meta-label dsg-label-rate">${t('currentRate')}</span>
      <span class="dsg-status">—</span>
    </div>
    <div class="dsg-meta-col">
      <span class="dsg-meta-label dsg-label-switch">${t('nextSwitch')}</span>
      <span class="dsg-countdown"></span>
    </div>
  </div>
  <div class="dsg-records">
    <div class="dsg-records-head">
      <span class="dsg-records-title">${t('sessionRecordsTitle')}</span>
      <span class="dsg-records-total">${t('totalWithValue', { v: '¥0.00' })}</span>
      <button class="dsg-records-close" type="button" title="${t('close')}">✕</button>
    </div>
    <div class="dsg-recbar">
      <div class="dsg-seg dsg-range">
        <button class="dsg-range-btn" data-range="all" type="button">${t('rangeAll')}</button>
        <button class="dsg-range-btn" data-range="year" type="button">${t('rangeYear')}</button>
        <button class="dsg-range-btn active" data-range="month" type="button">${t('rangeMonth')}</button>
        <button class="dsg-range-btn" data-range="week" type="button">${t('rangeWeek')}</button>
      </div>
      <div class="dsg-nav">
        <button class="dsg-prev" type="button" title="${t('prevPeriod')}">‹</button>
        <span class="dsg-range-label">—</span>
        <button class="dsg-next" type="button" title="${t('nextPeriod')}">›</button>
      </div>
      <div class="dsg-panel-actions">
        <div class="dsg-seg dsg-scopeseg">
          <button class="dsg-scope-btn active" data-scope="session" type="button" title="${t('scopeSessionTitle')}">${t('thisSession')}</button>
          <button class="dsg-scope-btn" data-scope="all" type="button" title="${t('scopeAllTitle')}">${t('allSessions')}</button>
        </div>
        <div class="dsg-seg dsg-viewseg">
          <button class="dsg-view-btn active" data-view="band" type="button">${t('byBand')}</button>
          <button class="dsg-view-btn" data-view="model" type="button">${t('byModel')}</button>
        </div>
        <button class="dsg-export" type="button" title="${t('exportTip')}">${t('exportBtn')}</button>
        <button class="dsg-open" type="button" title="${t('openTip')}" disabled>${t('openBtn')}</button>
      </div>
    </div>
    <div class="dsg-chart">
      <span class="dsg-chart-max"></span>
      <div class="dsg-bars"></div>
      <div class="dsg-legend"></div>
    </div>
    <div class="dsg-tablewrap"><table class="dsg-table"><thead></thead><tbody></tbody></table></div>
    <div class="dsg-records-foot">${t('panelNote')}</div>
  </div>
</div>
<div class="dsg-rows">
  <div class="dsg-row"><span class="dsg-lbl-turn">${t('turnCost')}</span><span class="dsg-val dsg-turncost">—</span></div>
  <div class="dsg-row"><span class="dsg-lbl-session">${t('sessionCost')}</span><span class="dsg-val dsg-cost">—</span></div>
  <div class="dsg-row"><span class="dsg-lbl-bal">${t('balance')}</span><span class="dsg-val dsg-balance">—</span></div>
</div>
<div class="dsg-settings">
  <label>${t('thresholdLabel')}</label>
  <input class="dsg-threshold" type="number" min="0" step="1" inputmode="decimal">
  <label>${t('excelFolderLabel')}</label>
  <div class="dsg-pathrow">
    <span class="dsg-path unset">${t('pathUnset')}</span>
    <button class="dsg-mini-btn dsg-pick" type="button" title="${t('pickFolderTitle')}">${t('select')}</button>
    <button class="dsg-mini-btn dsg-clearpath" type="button" title="${t('clearPathTitle')}">✕</button>
  </div>
  <label title="${t('minimaxKeyHint')}">${t('minimaxKeyLabel')}</label>
  <div class="dsg-keyrow">
    <input class="dsg-mmx-key" type="password" placeholder="sk-cp-…" autocomplete="off" spellcheck="false">
    <button class="dsg-mini-btn dsg-mmx-save" type="button">${t('minimaxKeySave')}</button>
    <button class="dsg-mini-btn dsg-mmx-clear" type="button" title="${t('minimaxKeyClearTitle')}">✕</button>
  </div>
  <div class="dsg-mmx-keystate"></div>
  <label class="dsg-check" title="${t('frostHint')}">
    <input class="dsg-frost-toggle" type="checkbox">
    <span>${t('frostLabel')}</span>
  </label>
  <div class="dsg-frostopts off">
    <div class="dsg-frow" title="${t('frostBlurHint')}">
      <span>${t('frostBlurLabel')}</span>
      <input class="dsg-frost-blur" type="range" min="0" max="24" step="1">
      <b class="dsg-frost-blur-val">9px</b>
    </div>
    <div class="dsg-frow" title="${t('frostTransHint')}">
      <span>${t('frostTransLabel')}</span>
      <input class="dsg-frost-trans" type="range" min="0" max="100" step="1">
      <b class="dsg-frost-trans-val">47%</b>
    </div>
    <div class="dsg-frow" title="${t('edgeHint')}">
      <span>${t('edgeLabel')}</span>
      <input class="dsg-edge-fade" type="range" min="0" max="40" step="1">
      <b class="dsg-edge-fade-val">14px</b>
    </div>
    <div class="dsg-frow" title="${t('bandTransHint')}">
      <span>${t('bandTransLabel')}</span>
      <input class="dsg-band-trans" type="range" min="0" max="60" step="1">
      <b class="dsg-band-trans-val">15%</b>
    </div>
    <div class="dsg-frow" title="${t('lumaGainHint')}">
      <span>${t('lumaGainLabel')}</span>
      <input class="dsg-luma-gain" type="range" min="0" max="100" step="1">
      <b class="dsg-luma-gain-val">100%</b>
    </div>
    <div class="dsg-frow" title="${t('lumaAlgoHint')}">
      <span>${t('lumaAlgoLabel')}</span>
      <select class="dsg-luma-algo">
        <option value="0">${t('luma709')}</option>
        <option value="1">${t('lumaHsl')}</option>
        <option value="2">${t('lumaHsv')}</option>
      </select>
    </div>
  </div>
  <label class="dsg-check" title="${t('snapHint')}">
    <input class="dsg-snap-toggle" type="checkbox">
    <span>${t('snapLabel')}</span>
  </label>
  <label class="dsg-check" title="${t('compactCostHint')}">
    <input class="dsg-compactcost-toggle" type="checkbox">
    <span>${t('compactCostLabel')}</span>
  </label>
  <div class="dsg-version" title="dsh-cost-gauge"></div>
</div>
<div class="dsg-toast"></div>
<div class="dsg-narrowbar" data-narrow title="${t('narrowTip')}">
  <span class="dsg-narrow-lamp"></span>
  <span class="dsg-narrow-cost">—</span>
  <span class="dsg-narrow-bal">—</span>
  <span class="dsg-badge dsg-narrow-badge">—</span>
</div>
<div class="dsg-mini" data-drag-mini title="${t('expandTip')}">
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
  <span class="dsg-badge dsg-mini-badge">—</span>
</div>
<div class="dsg-resizer" data-resize title="${t('resizeTip')}"></div>
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
        const miniBadgeEl = root.querySelector('.dsg-mini-badge')
        const hgEl = root.querySelector('.dsg-hourglass')
        const hgTopEl = root.querySelector('.dsg-hg-top')
        const hgBotEl = root.querySelector('.dsg-hg-bot')
        const hgFallEl = root.querySelector('.dsg-hg-fall')
        const statusEl = root.querySelector('.dsg-status')
        const costEl = root.querySelector('.dsg-cost')
        const turnCostEl = root.querySelector('.dsg-turncost')
        const balanceEl = root.querySelector('.dsg-balance')
        const lblTurnEl = root.querySelector('.dsg-lbl-turn')
        const lblSessionEl = root.querySelector('.dsg-lbl-session')
        const lblBalEl = root.querySelector('.dsg-lbl-bal')
        const countdownEl = root.querySelector('.dsg-countdown')
        const rateLabelEl = root.querySelector('.dsg-label-rate')
        const switchLabelEl = root.querySelector('.dsg-label-switch')
        const thresholdEl = root.querySelector('.dsg-threshold')
        const needleEl = root.querySelector('.dsg-needle')
        const stdArcEl = root.querySelector('.dsg-arc-std')
        const peakArcEl = root.querySelector('.dsg-arc-peak')
        const ticksEl = root.querySelector('.dsg-ticks')
        const balTrackEl = root.querySelector('.dsg-bal-track')
        const balFillEl = root.querySelector('.dsg-bal-fill')
        const balMarkEl = root.querySelector('.dsg-bal-mark')
        // 记录 / 归零 / 记录面板元素
        const recordBtnEl = root.querySelector('.dsg-record')
        const zeroBtnEl = root.querySelector('.dsg-zero')
        const recordsEl = root.querySelector('.dsg-records')
        const recordsHeadEl = root.querySelector('.dsg-records-head')
        const recordsCloseEl = root.querySelector('.dsg-records-close')
        const rangeBtns = root.querySelectorAll('.dsg-range-btn')
        const scopeBtns = root.querySelectorAll('.dsg-scope-btn')
        const viewBtns = root.querySelectorAll('.dsg-view-btn')
        const prevBtnEl = root.querySelector('.dsg-prev')
        const nextBtnEl = root.querySelector('.dsg-next')
        const rangeLabelEl = root.querySelector('.dsg-range-label')
        const barsEl = root.querySelector('.dsg-bars')
        const chartMaxEl = root.querySelector('.dsg-chart-max')
        const legendEl = root.querySelector('.dsg-legend')
        const tableHeadEl = root.querySelector('.dsg-table thead')
        const tableBodyEl = root.querySelector('.dsg-table tbody')
        const recordsTotalEl = root.querySelector('.dsg-records-total')
        const recordsTitleEl = root.querySelector('.dsg-records-title')
        const exportBtnEl = root.querySelector('.dsg-export')
        const openBtnEl = root.querySelector('.dsg-open')
        const pathEl = root.querySelector('.dsg-path')
        const versionEl = root.querySelector('.dsg-version')
        const pickBtnEl = root.querySelector('.dsg-pick')
        const clearPathBtnEl = root.querySelector('.dsg-clearpath')
        const mmxKeyEl = root.querySelector('.dsg-mmx-key')
        const mmxKeySaveEl = root.querySelector('.dsg-mmx-save')
        const mmxKeyClearEl = root.querySelector('.dsg-mmx-clear')
        const mmxKeyStateEl = root.querySelector('.dsg-mmx-keystate')
        const toastEl = root.querySelector('.dsg-toast')
        const frostEl = root.querySelector('.dsg-frost')
        const frostToggleEl = root.querySelector('.dsg-frost-toggle')
        const snapToggleEl = root.querySelector('.dsg-snap-toggle')
        const compactCostToggleEl = root.querySelector('.dsg-compactcost-toggle')
        // 竖版最小化（窗口过窄时自动切换）
        const narrowBarEl = root.querySelector('.dsg-narrowbar')
        const narrowLampEl = root.querySelector('.dsg-narrow-lamp')
        const narrowCostEl = root.querySelector('.dsg-narrow-cost')
        const narrowBalEl = root.querySelector('.dsg-narrow-bal')
        const narrowBadgeEl = root.querySelector('.dsg-narrow-badge')

        // 初始位置（左上）+ 宽度/最小化状态。
        // 注意：位置/尺寸可能是以前更宽的窗口存下的；若超出当前视口，打开时自动拉回。
        const saved = loadJSON('pos')
        const savedSize = loadJSON('size')
        let widthNow = savedSize && typeof savedSize.width === 'number'
          ? Math.min(MAX_W, Math.max(MIN_W, savedSize.width)) : DEFAULT_W
        const collapsedSaved = loadJSON('collapsed') === true
        root.style.width = (collapsedSaved ? MINI_W : widthNow) + 'px'
        root.style.left = (saved && typeof saved.x === 'number' ? saved.x : 24) + 'px'
        root.style.top = (saved && typeof saved.y === 'number' ? saved.y : 96) + 'px'

        // 视口保护：位置超出可视区时自动拉回（打开时、窗口尺寸变化、折叠/展开时各跑一次）。
        const EDGE_MARGIN = 8
        function clampIntoView() {
          // 视口为 0（窗口最小化 / 后台标签页）时不要钳制：否则会把位置算成 (0,0) 并写进 localStorage。
          if (window.innerWidth < 1 || window.innerHeight < 1) return
          const maxX = Math.max(0, window.innerWidth - root.offsetWidth - EDGE_MARGIN)
          const maxY = Math.max(0, window.innerHeight - root.offsetHeight - EDGE_MARGIN)
          const x = Math.min(Math.max(0, root.offsetLeft), maxX)
          const y = Math.min(Math.max(0, root.offsetTop), maxY)
          if (x !== root.offsetLeft || y !== root.offsetTop) {
            root.style.left = x + 'px'
            root.style.top = y + 'px'
            saveJSON('pos', { x, y })
          }
        }
        clampIntoView()
        window.addEventListener('resize', clampIntoView)

        let localThreshold = loadLocalThreshold()
let gaugeView = null
        // 今日法定节假日名（来自 /state）：整日按空闲计费，费率弧需全绿。

        // 余额环满刻度 = 历史最高余额（自动记忆，遇更高余额自动上移）。
        let histMax = (() => {
          const v = Number(loadJSON('maxBalance'))
          return Number.isFinite(v) && v > 0 ? v : 0
        })()

        // 画余额环：满刻度=histMax；绿/红填充=当前余额占比；琥珀竖线=报警阈值位置。
        function updateBalance(balance, threshold) {
          if (!Number.isFinite(balance) || balance < 0) {
            balFillEl.setAttribute('d', '')
            balMarkEl.style.display = 'none'
            return
          }
          if (balance > histMax) {
            histMax = balance
            saveJSON('maxBalance', histMax)
          }
          const denom = Math.max(histMax, 1e-9)
          balTrackEl.setAttribute('d', arcD(0, 180, BAL_R))
          const pEnd = Math.min(180, Math.max(0, (balance / denom) * 180))
          balFillEl.setAttribute('d', arcD(0, pEnd, BAL_R))
          const t = Number(threshold)
          if (Number.isFinite(t) && t > 0) {
            const pMark = Math.min(180, Math.max(0, (t / denom) * 180))
            const [x1, y1] = arcXY(pMark, BAL_LO)
            const [x2, y2] = arcXY(pMark, BAL_HI)
            balMarkEl.setAttribute('x1', x1.toFixed(1))
            balMarkEl.setAttribute('y1', y1.toFixed(1))
            balMarkEl.setAttribute('x2', x2.toFixed(1))
            balMarkEl.setAttribute('y2', y2.toFixed(1))
            balMarkEl.style.display = ''
          } else {
            balMarkEl.style.display = 'none'
          }
        }

        /** 阈值：本地覆盖优先，其次服务端下发的值，最后默认值。 */
        function currentThreshold(fromServer) {
          if (localThreshold !== null) return localThreshold
          if (Number.isFinite(fromServer)) return fromServer
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
          clampIntoView()
        }


        /**
         * 后台沙漏 —— 当前用的不是订阅制模型时，提醒那个订阅的窗口还剩多久重置。
         *
         * 沙面高度由 elapsed 决定：上仓的沙往下流走，下仓往上堆。
         * 变化极慢（5 小时窗口每秒只走 0.0055%），所以"在动"的观感由中间那条
         * 流动沙柱的 CSS 动画提供，沙面只负责表达进度。
         */
        function updateHourglass() {
          const hg = gaugeView && gaugeView.hourglass
          if (!hg) {
            if (!hgEl.hidden) hgEl.hidden = true
            root.classList.remove('dsg-hg-cooling')
            return
          }
          if (hgEl.hidden) hgEl.hidden = false
          root.classList.toggle('dsg-hg-cooling', hg.phase === 'cooling')

          const e = Math.min(1, Math.max(0, Number(hg.elapsed) || 0))
          // 上仓：倒三角，沙面从 y=2.2 往下退；下仓：正三角，沙面从 y=18 往上升
          const TOP_Y = 2.2, TOP_H = 6.7
          const BOT_Y = 18, BOT_H = 6.9
          hgTopEl.setAttribute('y', (TOP_Y + TOP_H * e).toFixed(2))
          hgTopEl.setAttribute('height', (TOP_H * (1 - e)).toFixed(2))
          hgBotEl.setAttribute('y', (BOT_Y - BOT_H * e).toFixed(2))
          hgBotEl.setAttribute('height', (BOT_H * e).toFixed(2))
          // 还有沙在流时才画沙柱
          hgFallEl.style.display = e < 0.995 ? '' : 'none'

          // 倒计时本地递减：服务端给打点 + 剩余毫秒
          const base = Number.isFinite(Number(hg.at)) ? Number(hg.at) : Date.now()
          const leftMs = Math.max(0, (Number(hg.untilResetMs) || 0) - (Date.now() - base))
          hgEl.title = t('hourglassTitle', { time: fmtRemain(Math.round(leftMs / 1000)) })
        }

        /**
         * 沙漏挂哪一侧：默认挂右边缘外侧；浮窗贴住屏幕左/右边缘时，右侧就没地方了，
         * 改挂下方（.dsg-hg-bottom）。竖条形态由 CSS 直接定成底部居中。
         */
        function syncHourglassSide() {
          if (!hgEl || hgEl.hidden) return
          const r = root.getBoundingClientRect()
          const nearLeft = r.left <= EDGE_MARGIN + 6
          const nearRight = r.right >= window.innerWidth - EDGE_MARGIN - 6
          root.classList.toggle('dsg-hg-bottom', nearLeft || nearRight)
        }

        /**
         * 把视图里的结构化 spec 渲染成文本。
         * i18n 与数字/时间格式化都留在浏览器侧 —— 服务端只给语义，不给成品字符串。
         */
        function specText(spec) {
          if (!spec || typeof spec !== 'object') return '—'
          switch (spec.kind) {
            case 'money':
              return Number.isFinite(spec.value) ? fmtMoney(spec.value) : '—'
            case 'turnMoney':
              return Number.isFinite(spec.value) ? fmtTurnCost(spec.value) : '—'
            case 'percent':
              return Number.isFinite(spec.value) ? Math.round(spec.value) + '%' : '—'
            case 'unlimited':
              return '∞'
            case 'duration': {
              const base = Number.isFinite(Number(spec.at)) ? Number(spec.at) : Date.now()
              const left = Number(spec.untilMs) - (Date.now() - base)
              if (!Number.isFinite(left)) return '—'
              return fmtRemain(Math.max(0, Math.round(left / 1000)))
            }
            case 'rateStatus':
              if (spec.holidayName) return t('statusHoliday', { name: spec.holidayName })
              if (spec.makeupWorkday) return t('statusMakeup')
              return spec.peak ? t('statusPeak') : t('statusStd')
            case 'text':
              return spec.value === undefined || spec.value === null ? '—' : String(spec.value)
            default:
              return '—'
          }
        }

        /** 拉不到数据时的占位视图：形状与真实视图一致，渲染函数不必到处判空。 */
        function emptyView() {
          const txt = { kind: 'text', value: '—' }
          return {
            mode: 'metered',
            meta: { version: '', threshold: DEFAULT_THRESHOLD, model: '', holidayYears: [], holidayYearCovered: true },
            dial: { kind: 'schedule', offAllDay: false, peak: false },
            ring: { fraction: 0, tone: 'std' },
            caption: {
              left: { labelKey: 'currentRate', spec: txt },
              right: { labelKey: 'nextSwitch', spec: txt },
            },
            rows: [
              { labelKey: 'turnCost', spec: txt },
              { labelKey: 'sessionCost', spec: txt },
              { labelKey: 'balance', spec: txt },
            ],
            compact: {
              primary: { labelKey: 'sessionCost', spec: txt, altLabelKey: 'turnCost', altSpec: txt },
              secondary: { labelKey: 'balance', spec: txt },
              tint: null,
            },
            balanceRing: null,
            tone: 'normal',
            alarm: false,
            error: null,
          }
        }

        function render(view) {
          view = view || emptyView()
          gaugeView = view
          const meta = view.meta || {}
          const threshold = currentThreshold(meta.threshold)

          // 模型徽标（标题栏 + 最小化条 + 竖版条）+ 指针颜色
          const modelRaw = meta.model ? String(meta.model) : ''
          setModelBadge(badgeEl, modelRaw)
          setModelBadge(miniBadgeEl, modelRaw, 'dsg-mini-badge')
          setModelBadge(narrowBadgeEl, modelRaw, 'dsg-narrow-badge')
          root.style.setProperty('--dsg-needle-color', modelColorOf(modelRaw))

          // 色调类：订阅制 / 用尽 / 余额告警
          const peak = !!(view.ring && view.ring.tone === 'peak')
          const subscription = view.mode === 'subscription'
          const exhausted = view.tone === 'exhausted'
          root.classList.toggle('dsg-peak', peak)
          root.classList.toggle('dsg-mmx', subscription)
          root.classList.toggle('dsg-mmx-out', exhausted)
          root.classList.toggle('dsg-alarm', view.alarm === true)
          root.classList.toggle('dsg-ok', view.alarm !== true)

          // 表盘下方两项
          rateLabelEl.textContent = t(view.caption.left.labelKey)
          statusEl.textContent = specText(view.caption.left.spec)
          statusEl.className = 'dsg-status ' + (exhausted ? 'dsg-out' : peak ? 'dsg-peak' : 'dsg-std')
          switchLabelEl.textContent = t(view.caption.right.labelKey)
          countdownEl.textContent = specText(view.caption.right.spec)

          // 三行
          lblTurnEl.textContent = t(view.rows[0].labelKey)
          turnCostEl.textContent = specText(view.rows[0].spec)
          lblSessionEl.textContent = t(view.rows[1].labelKey)
          costEl.textContent = specText(view.rows[1].spec)
          lblBalEl.textContent = t(view.rows[2].labelKey)
          balanceEl.textContent = specText(view.rows[2].spec)

          // 紧凑态：按量计费仍支持「本回合 / 会话」二选一，订阅制的 alt 为空
          const compact = view.compact
          const useAlt = compactCostMode === 'turn' && compact.primary.altSpec
          const pSpec = useAlt ? compact.primary.altSpec : compact.primary.spec
          const pKey = useAlt ? compact.primary.altLabelKey : compact.primary.labelKey
          miniCostEl.textContent = specText(pSpec)
          miniCostEl.title = t(pKey)
          narrowCostEl.textContent = specText(pSpec)
          narrowCostEl.title = t(pKey)
          miniBalEl.textContent = specText(compact.secondary.spec)
          miniBalEl.title = t(compact.secondary.labelKey)
          narrowBalEl.textContent = specText(compact.secondary.spec)
          narrowBalEl.title = t(compact.secondary.labelKey)

          // 标题栏余额灯的提示（余额环画的是账户余额，与当前模型无关）
          const balSpec = view.rows[2].spec
          lightEl.title = balSpec.kind === 'money'
            ? (view.alarm
                ? t('balanceLowTitle', { bal: balSpec.value.toFixed(2), t: threshold })
                : t('balanceOkTitle', { bal: balSpec.value.toFixed(2), t: threshold }))
            : (balSpec.error || t('balanceUnknown'))
          narrowLampEl.title = lightEl.title

          // 阈值输入框
          thresholdEl.value = String(threshold)

          // 版本 + 节假日覆盖范围
          const ver = typeof meta.version === 'string' ? meta.version.trim() : ''
          const years = Array.isArray(meta.holidayYears) ? meta.holidayYears : []
          const staleYear = meta.holidayYearCovered === false ? beijingPartsNow().year : null
          if (ver) {
            const base = 'dsh-cost-gauge v' + ver
            const extra = staleYear
              ? '⚠ ' + t('holidayStale', { year: staleYear })
              : years.length ? t('holidaySource', { years: years.join('/') }) : ''
            const text = extra ? base + ' · ' + extra : base
            if (versionEl.dataset.ver !== text) {
              versionEl.dataset.ver = text
              versionEl.textContent = text
            }
            versionEl.style.display = ''
            versionEl.classList.toggle('dsg-version-warn', !!staleYear)
          } else {
            versionEl.style.display = 'none'
          }

          // 余额内环（既有 UI：两种模式都画，与模型无关）
          updateBalance(
            view.balanceRing && Number.isFinite(view.balanceRing.total) ? view.balanceRing.total : undefined,
            threshold,
          )

          updateHourglass()
          updateDial()
          tick()
        }

        // 每秒：刷新倒计时文案 + 最小化态的倒计时饼图；同时根据会话是否执行中切换“工作灯”。
        function isSessionRunning() {
          try {
            const id = currentSessionId()
            if (!id) return false
            const snap = ctx.sessions.list.getSnapshot()
            const row = snap && snap.byId && snap.byId[id]
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
          // 段边界跳变（06:00 / 18:00 均为右端→左端）：瞬时跳回，不平滑扫过。
          if (lastDialDeg > 60 && deg < -60) {
            needleEl.style.transition = 'none'
            needleEl.style.transform = `rotate(${deg}deg)`
            void needleEl.getBoundingClientRect()
            needleEl.style.transition = 'transform .6s linear'
          } else {
            needleEl.style.transform = `rotate(${deg}deg)`
          }
          lastDialDeg = deg

          /*
           * 外圈弧只看 view.dial：UI 不知道当前是哪个模型，也不知道阶段语义。
           *   schedule —— 按小时的费率时段表（几何由 dialArcsFor 算）
           *   window   —— 单段弧，起止角度与颜色都由服务端给好
           */
          const d = (gaugeView && gaugeView.dial) ? gaugeView.dial : { kind: 'schedule', offAllDay: false }
          if (d.kind === 'window') {
            peakArcEl.setAttribute('d', '')
            peakArcEl.style.display = 'none'
            const span = Number.isFinite(d.fromDeg) && Number.isFinite(d.toDeg) ? d.toDeg - d.fromDeg : 0
            if (span > 0.5 && d.color) {
              stdArcEl.setAttribute('d', arcD(d.fromDeg, d.toDeg, RATE_R))
              stdArcEl.style.stroke = d.color
            } else {
              stdArcEl.setAttribute('d', '')
              stdArcEl.style.stroke = ''
            }
          } else {
            stdArcEl.style.stroke = ''
            const arcs = dialArcsFor(p, !!d.offAllDay)
            stdArcEl.setAttribute('d', arcs.std)
            peakArcEl.setAttribute('d', arcs.peak)
            peakArcEl.style.display = arcs.peak ? '' : 'none'
          }
        }

        function tick() {
          // 对话执行阶段：标题灯 + 最小化状态灯发光闪烁；结束后恢复正常。
          root.classList.toggle('dsg-working', isSessionRunning())
          updateDial()
          scheduleFrost() // 浮窗位置/视口/布局变化时重算磨砂区域
          if (!gaugeView) return

          // 服务端给的是打点，不是成品字符串：每秒只需重算「时长」类文本
          countdownEl.textContent = specText(gaugeView.caption.right.spec)
          if (gaugeView.rows[1]) costEl.textContent = specText(gaugeView.rows[1].spec)

          // 后台沙漏：沙面 + 倒计时 + 挂靠哪一侧
          updateHourglass()
          syncHourglassSide()

          // 最小化圆环：比例与颜色全部来自视图
          const ring = gaugeView.ring || {}
          const frac = Number.isFinite(ring.fraction) ? Math.min(1, Math.max(0, ring.fraction)) : 0
          miniProg.style.strokeDashoffset = String(100 * (1 - frac))

          // 提示语用「左项值 · 右项值」，不依赖任何模型字段
          miniWrap.title = specText(gaugeView.caption.left.spec) + ' · ' + specText(gaugeView.caption.right.spec)
          miniLamp.title = miniWrap.title
        }


        async function poll() {
          const sid = currentSessionId()
          // @wire 表盘 -> /api/cost-gauge/gauge（归一化视图：UI 不认模型，只认这一种形状）
          const url = '/api/cost-gauge/gauge' + (sid ? '?session=' + encodeURIComponent(sid) : '')
          try {
            const res = await fetch(url)
            if (!res.ok) throw new Error('HTTP ' + res.status)
            gaugeView = await res.json()
          } catch (e) {
            const v = emptyView()
            v.error = e && e.message ? e.message : String(e)
            gaugeView = v
          }
          render(gaugeView)
        }

        /* ---------- MiniMax 订阅额度 ----------
         * 独立接口、独立节流：额度按小时计，60 秒一次足够；倒计时由本地递减，
         * 查询失败只影响额度显示，不动其它区域。
         */



        // 拖动（标题栏；最小化时拖最小化条；已停靠时拖竖条本体）。
        let dragActive = false // 正在手动拖拽：期间不做自动让位
        let dragSnapEdge = null // 本次拖拽命中的吸附边（null = 未吸附）
        let dragStartPos = null // 按下时的左上角（吸附预览会改位置，故必须提前记下）
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
            dragActive = true
            moved = false
            dragSnapEdge = null
            dragStartPos = { left: root.style.left, top: root.style.top }
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
            const rawX = Math.max(0, ox + dx)
            const rawY = Math.max(0, oy + dy)
            let nx = rawX
            let ny = rawY
            dragSnapEdge = null
            if (snapEnabled) {
              // 吸附预览：拖到窗口边缘时先「粘住」贴边（松手后才真正变形为竖条）。
              const s = snapToEdges(rawX, rawY, root.offsetWidth, root.offsetHeight,
                window.innerWidth, window.innerHeight, SNAP_DIST, EDGE_MARGIN)
              nx = s.x
              ny = s.y
              dragSnapEdge = s.edge
            }
            root.style.left = nx + 'px'
            root.style.top = ny + 'px'
            scheduleFrost()
          })
          const end = () => {
            if (!dragging) return
            dragging = false
            dragActive = false
            if (moved) {
              commitDrag()
              scheduleFrost()
            } else if (typeof onTap === 'function') {
              onTap()
            }
          }
          handleEl.addEventListener('pointerup', end)
          handleEl.addEventListener('pointercancel', end)
        }
        attachDrag(titleEl)
        attachDrag(miniEl, () => setCollapsed(false))
        attachDrag(narrowBarEl)

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
            if (gaugeView) render(gaugeView)
          } else {
            thresholdEl.value = String(currentThreshold(gaugeView && gaugeView.meta ? gaugeView.meta.threshold : undefined))
          }
        })

        // ===== 记录面板（时间筛选 + 柱状图 + 表格 + 导出/打开）与归零 =====
        const SEG_COLORS = {
          std: '#22c55e', peak: '#f59e0b',
          pro: '#fcd34d', flash: '#7dd3fc', vision: '#e879f9',
        }
        const panel = {
          range: 'month', view: 'band',
          year: 0, month: 0, weekStart: '',
          days: [], groups: [], resetAt: null, excelDir: '', lastExport: '',
          scope: 'session', title: '', sessionCount: 0,
          x: null, y: null, // 面板位置（viewport 坐标，拖动后记忆）
        }
        let toastTimer = null
        let zeroTimer = null

        // ===== 记录面板：可拖动 + 视口钳制（越界自动拉回窗口内） =====
        const PANEL_MARGIN = 8
        let panelDrag = null

        /** 把面板放到 (x, y)，并保证完整落在窗口内。 */
        function placePanel(x, y) {
          const w = recordsEl.offsetWidth || 480
          const h = recordsEl.offsetHeight || 320
          const maxX = Math.max(PANEL_MARGIN, window.innerWidth - w - PANEL_MARGIN)
          const maxY = Math.max(PANEL_MARGIN, window.innerHeight - h - PANEL_MARGIN)
          panel.x = Math.min(Math.max(PANEL_MARGIN, Math.round(x)), maxX)
          panel.y = Math.min(Math.max(PANEL_MARGIN, Math.round(y)), maxY)
          recordsEl.style.left = panel.x + 'px'
          recordsEl.style.top = panel.y + 'px'
        }
        function clampPanelToView() {
          if (!root.classList.contains('dsg-records-open')) return
          placePanel(panel.x, panel.y)
        }
        /** 打开面板：恢复上次位置（首次打开落在指示器下方），越界自动拉回。 */
        function openRecordsPanel() {
          const saved = loadJSON('panelPos')
          let x = panel.x
          let y = panel.y
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
              x = saved.x
              y = saved.y
            } else {
              x = root.offsetLeft
              y = root.offsetTop + root.offsetHeight + PANEL_MARGIN
            }
          }
          root.classList.add('dsg-records-open')
          placePanel(x, y)
          saveJSON('panelPos', { x: panel.x, y: panel.y })
        }
        function attachPanelDrag() {
          recordsHeadEl.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button')) return
            panelDrag = { sx: e.clientX, sy: e.clientY, ox: panel.x, oy: panel.y }
            try { recordsHeadEl.setPointerCapture(e.pointerId) } catch {}
            e.preventDefault()
            e.stopPropagation()
          })
          recordsHeadEl.addEventListener('pointermove', (e) => {
            if (!panelDrag) return
            const ox = Number.isFinite(panelDrag.ox) ? panelDrag.ox : 0
            const oy = Number.isFinite(panelDrag.oy) ? panelDrag.oy : 0
            placePanel(ox + (e.clientX - panelDrag.sx), oy + (e.clientY - panelDrag.sy))
          })
          const end = () => {
            if (!panelDrag) return
            panelDrag = null
            saveJSON('panelPos', { x: panel.x, y: panel.y })
          }
          recordsHeadEl.addEventListener('pointerup', end)
          recordsHeadEl.addEventListener('pointercancel', end)
        }
        const onWindowResizePanel = () => clampPanelToView()
        window.addEventListener('resize', onWindowResizePanel)

        // ===== 视口过窄 → 自动竖版最小化（ResizeObserver + 迟滞） =====
        // 阈值可用 localStorage 覆盖：dsh-cost-gauge:narrowEnter / dsh-cost-gauge:narrowExit
        const narrowEnterCfg = Number(loadJSON('narrowEnter'))
        const narrowExitCfg = Number(loadJSON('narrowExit'))
        const NARROW_ENTER = narrowEnterCfg > 0 ? narrowEnterCfg : 780
        const NARROW_EXIT = narrowExitCfg > 0 ? narrowExitCfg : Math.max(NARROW_ENTER + 40, 860)
        let narrowMode = false
        let narrowDismissed = false // 竖版下点开过：本段窄窗口内不再自动收窄
        let narrowPosSnapshot = null // 进入竖版前的位置，退出时恢复
        const narrowWidthCfg = Number(loadJSON('narrowWidth'))
        const NARROW_W = narrowWidthCfg > 0 ? narrowWidthCfg : 36 // 竖条宽度（可 localStorage 覆盖）

        // ===== 边缘吸附 → 贴边竖条（**纯前端特性**：只改浮窗自身的形态与位置，不涉及宿主 / 路由）=====
        // 吸附距离可用 localStorage 覆盖：dsh-cost-gauge:snapDist；开关：dsh-cost-gauge:snapEnabled
        const snapDistCfg = Number(loadJSON('snapDist'))
        const SNAP_DIST = snapDistCfg > 0 ? snapDistCfg : 24
        let snapEnabled = loadJSON('snapEnabled') !== false // 默认开
        // 两个紧凑态（最小化胶囊 / 贴边竖条）显示哪一个花费：'session'（默认，历史行为）| 'turn'。
        // 存字符串而不是布尔：既表达「选哪个」，也把「从未设置过」显式落到默认值上。
        let compactCostMode = loadJSON('compactCost') === 'turn' ? 'turn' : 'session'
        let docked = (() => { // 手动贴边停靠状态：{ edge:'left'|'right', y:number } | null
          const d = loadJSON('dock')
          return d && (d.edge === 'left' || d.edge === 'right') && Number.isFinite(d.y) ? d : null
        })()
        let stripOn = false // 当前是否处于竖条形态（自动窄屏 narrowMode **或** 手动停靠 docked）

        /**
         * 边缘吸附判定（**纯函数**：无 DOM、无副作用，便于单测）。
         * @returns {{x:number, y:number, edge:'left'|'right'|'top'|'bottom'|null}} 吸附后的左上角与命中的边
         *
         * 左右边优先于上下边 —— 因为只有左右边会把浮窗**变形为竖条**（竖条本身是纵向的），
         * 上下边只做「贴边」不做变形；四个角落因此归给左右边。
         */
        function snapToEdges(x, y, w, h, vw, vh, thr, gap) {
          const maxX = Math.max(gap, vw - w - gap)
          const maxY = Math.max(gap, vh - h - gap)
          const cx = Math.min(Math.max(gap, x), maxX)
          const cy = Math.min(Math.max(gap, y), maxY)
          if (x <= gap + thr) return { x: gap, y: cy, edge: 'left' }
          if (x >= maxX - thr) return { x: maxX, y: cy, edge: 'right' }
          if (y <= gap + thr) return { x: cx, y: gap, edge: 'top' }
          if (y >= maxY - thr) return { x: cx, y: maxY, edge: 'bottom' }
          return { x, y, edge: null }
        }

        /** 拖拽结束：命中左右边 → 停靠成竖条；从停靠状态拖离 → 就地解除停靠；否则保存位置。 */
        function commitDrag() {
          const edge = dragSnapEdge
          dragSnapEdge = null
          if (edge === 'left' || edge === 'right') {
            // 不覆盖用户原来的 pos —— 解除停靠时要回到拖之前的位置。
            // 注意：吸附预览已经把浮窗挪到贴边处了，快照必须用「按下时」的位置，
            // 否则点竖条展开会停在边缘，而不是用户原本放浮窗的地方。
            if (!stripOn && dragStartPos) narrowPosSnapshot = dragStartPos
            docked = { edge, y: root.offsetTop }
            saveJSON('dock', docked)
            syncStrip(false)
            return
          }
          if (docked) {
            docked = null
            saveJSON('dock', null)
            syncStrip(true) // 就地展开，不回到旧位置
            if (!stripOn) saveJSON('pos', { x: root.offsetLeft, y: root.offsetTop })
            return
          }
          saveJSON('pos', { x: root.offsetLeft, y: root.offsetTop })
        }

        // ===== 侧边栏状态探测 =====
        // 侧栏自动收起时 DSH 会在三栏 frame 上切换 data-sidebar-collapsed；再用实测宽度兜底。
        function getSidebarEl() {
          try {
            return document.querySelector('[class*="sidebarCol" i], aside[class*="sidebar" i]')
          } catch { return null }
        }
        /**
         * 取 DSH 的三栏 frame 元素。
         * - dsh ≤ 0.1.6：frame 自带 [data-dsh-frame]；
         * - dsh 0.1.7 起：该属性已被移除 —— frame 上只剩 data-sidebar-collapsed /
         *   data-panel-conversation 这类**条件性**属性（展开态根本不渲染），无法再直接选中，
         *   因此改为由列子节点（侧栏列 / 中间列 / 右栏列）反查父节点。
         */
        let frameElCache = null
        function getFrameEl() {
          try {
            // 该函数会随 rAF 的玻璃化刷新每帧调用，而反查用的属性选择器要全文档扫描，故做一次缓存；
            // 用 isConnected 兜住 React 重建整个 shell 的情况（元素被卸载即自动重查）。
            if (frameElCache && frameElCache.isConnected) return frameElCache
            frameElCache = null
            const legacy = document.querySelector('[data-dsh-frame]')
            if (legacy) { frameElCache = legacy; return legacy }
            const anchor = document.querySelector('[class*="sidebarCol" i], [class*="centerCol" i], [data-rightbar-col], [class*="rightbarCol" i]')
            if (!anchor) return null
            // 逐级上溯，取同时含「中间列 / 右栏列」的那一层（0.1.7 中即列的直接父节点）。
            let el = anchor.parentElement
            for (let i = 0; el && i < 3; i++) {
              if (el.querySelector('[class*="centerCol" i], [data-rightbar-col], [class*="rightbarCol" i]')) { frameElCache = el; return el }
              el = el.parentElement
            }
            frameElCache = anchor.parentElement
            return frameElCache
          } catch { return null }
        }
        function sidebarCollapsedNow() {
          try {
            const frame = getFrameEl()
            if (frame && frame.hasAttribute('data-sidebar-collapsed')) return true
            const side = getSidebarEl()
            if (!side) return false
            const r = side.getBoundingClientRect()
            // 收起时的列宽：Windows 标题栏模式整列为 0（0×0）、macOS/Linux 为 56 竖条，故用 <= 96 覆盖 0。
            // 但首帧尚未布局时整棵 frame 都是 0×0，不能据此判成「已收起」——
            // 故用 frame 是否已布局来区分「真收起」与「还没布局」（不能只看侧栏列自己的高度：
            // 它在某些合法布局下本就可能是 0）。
            const f = frame ? frame.getBoundingClientRect() : null
            const laidOut = f ? (f.width > 0 && f.height > 0) : (r.height > 0)
            if (laidOut && r.width <= 96) return true
          } catch {}
          return false
        }

        // ===== 竖版停靠：自动移动到 DSH 侧边栏「会话 / 工作区」标题下方 =====
        // 优先级：字面「会话/Sessions」标题 → 「工作区/Workspaces」分组标题 → 「新会话」按钮 → 保持原位
        const DOCK_TEXTS = ['会话', 'Sessions', 'Session', '工作区', 'Workspaces', 'Workspace']
        function ownTextOf(el) {
          let s = ''
          for (const n of el.childNodes) if (n.nodeType === 3) s += n.textContent
          return s.trim()
        }
        function findDockAnchor() {
          try {
            const visible = (r) => r.width >= 8 && r.height >= 8 && r.top < window.innerHeight * 0.85
            const inSide = (r) => r.left < Math.min(360, window.innerWidth * 0.45)
            const best = {}
            for (const el of document.querySelectorAll('span, button, div, h1, h2, h3, h4, p')) {
              if (el.closest('.dsg-root')) continue
              const own = ownTextOf(el)
              if (!own || own.length > 10) continue
              const idx = DOCK_TEXTS.indexOf(own)
              if (idx < 0) continue
              const r = el.getBoundingClientRect()
              if (!visible(r) || !inSide(r)) continue
              if (best[idx] === undefined || r.top < best[idx].top) best[idx] = { top: r.top, rect: r }
            }
            for (let i = 0; i < DOCK_TEXTS.length; i++) {
              if (best[i]) return best[i].rect
            }
            // 退路：新会话按钮
            const ns = document.querySelector('[class*="newSession" i]')
            if (ns) {
              const r = ns.getBoundingClientRect()
              if (visible(r) && inSide(r)) return r
            }
          } catch {}
          return null
        }
        /** 竖条定位（钳制在窗口内；不写入 localStorage —— 停靠是临时的）。 */
        function placeNarrow(x, y) {
          const w = root.offsetWidth || NARROW_W
          const h = root.offsetHeight || 150
          const nx = Math.min(Math.max(8, Math.round(x)), Math.max(8, window.innerWidth - w - 8))
          const ny = Math.min(Math.max(8, Math.round(y)), Math.max(8, window.innerHeight - h - 8))
          root.style.left = nx + 'px'
          root.style.top = ny + 'px'
        }
        /** 停靠：侧栏收起时停在它右侧；否则停在「会话 / 工作区」标题下方。 */
        function dockNarrowToSessions() {
          try {
            if (sidebarCollapsedNow()) {
              const side = getSidebarEl()
              if (side) {
                const r = side.getBoundingClientRect()
                if (r.width > 0 && r.height > 0) {
                  placeNarrow(r.right + 8, r.top + 8)
                  return true
                }
              }
            }
            const rect = findDockAnchor()
            if (rect) {
              placeNarrow(rect.left, rect.bottom + 8)
              return true
            }
          } catch {}
          return false
        }

        /** 竖条落位：手动贴边停靠优先；否则沿用原来的「DSH 侧栏『会话 / 工作区』标题下方」停靠。 */
        function placeStrip() {
          if (docked) {
            const w = root.offsetWidth || NARROW_W
            const x = docked.edge === 'left'
              ? EDGE_MARGIN
              : Math.max(EDGE_MARGIN, window.innerWidth - w - EDGE_MARGIN)
            placeNarrow(x, docked.y) // placeNarrow 已把 y 钳制在窗口内
            if (Math.abs(root.offsetTop - docked.y) > 0.5) {
              docked.y = root.offsetTop
              saveJSON('dock', docked)
            }
            return
          }
          if (!dockNarrowToSessions()) clampIntoView()
        }

        /**
         * 应用 / 退出竖条形态。
         * keepPos = true 时退出竖条**保留当前位置**（从边缘拖开的情形）；
         * 否则回到「进入竖条前」的位置（点竖条展开 / 视口变宽）。
         */
        function applyStrip(keepPos) {
          root.classList.toggle('dsg-narrow', stripOn)
          root.classList.toggle('dsg-docked', stripOn && !!docked)
          narrowBarEl.title = t(stripOn && docked ? 'dockedTip' : 'narrowTip')
          if (stripOn) {
            if (!narrowPosSnapshot) narrowPosSnapshot = { left: root.style.left, top: root.style.top }
            root.style.setProperty('width', NARROW_W + 'px', 'important')
            placeStrip()
          } else {
            // 退出竖条：恢复用户自己的宽度（展开或手动最小化）与位置
            root.style.removeProperty('width')
            root.style.width = (root.classList.contains('dsg-collapsed') ? MINI_W : widthNow) + 'px'
            if (!keepPos && narrowPosSnapshot) {
              if (narrowPosSnapshot.left) root.style.left = narrowPosSnapshot.left
              if (narrowPosSnapshot.top) root.style.top = narrowPosSnapshot.top
            }
            narrowPosSnapshot = null
            clampIntoView()
          }
        }

        /** 竖条形态该不该开：自动（视口窄 / 侧栏收起）**或** 手动贴边停靠。 */
        function stripWanted() {
          return narrowMode || !!docked
        }
        /**
         * 把竖条形态同步到目标状态。
         * 注意「已在目标状态」时仍要 placeStrip()：视口 / 侧栏变化、或拖动结束都需要重新落位。
         */
        function syncStrip(keepPos) {
          const want = stripWanted()
          if (want === stripOn) {
            if (stripOn) placeStrip()
            return
          }
          stripOn = want
          applyStrip(keepPos)
        }
        /**
         * 触发：视口过窄（< NARROW_ENTER）**或** 左侧边栏收起（DSH 自动缩小时）。
         * 退出：视口 ≥ NARROW_EXIT 且侧栏已展开（迟滞避免抖动）。
         */
        function evaluateNarrow() {
          const w = window.innerWidth
          const rail = sidebarCollapsedNow()
          if (narrowDismissed && w >= NARROW_EXIT && !rail) narrowDismissed = false
          const shouldEnter = w < NARROW_ENTER || rail
          const shouldStay = w < NARROW_EXIT || rail
          narrowMode = !narrowDismissed && (narrowMode ? shouldStay : shouldEnter)
          // 竖条形态 = narrowMode（自动）或 docked（手动贴边）任一成立；已在竖条时此处会重新落位。
          syncStrip(false)
        }
        // 侧栏属性/尺寸变化时立即重算（DSH 自动收起时会切换 data-sidebar-collapsed）
        let sideObserver = null
        let sideObserverTarget = null
        let frameAttrObserver = null
        let narrowRecheckTimer = null
        function watchSidebar() {
          try {
            if (!frameAttrObserver) {
              frameAttrObserver = new MutationObserver(() => scheduleNarrowRecheck())
              frameAttrObserver.observe(document.body, {
                subtree: true,
                attributes: true,
                attributeFilter: ['data-sidebar-collapsed'],
              })
            }
            const side = getSidebarEl()
            if (side && typeof ResizeObserver === 'function' && side !== sideObserverTarget) {
              if (sideObserver) sideObserver.disconnect()
              sideObserver = new ResizeObserver(() => scheduleNarrowRecheck())
              sideObserver.observe(side)
              sideObserverTarget = side
            }
          } catch {}
        }
        /**
         * 观察回调统一入口：立即重算 + 160ms 后补算一次。
         * 侧栏展开时「属性移除」与「宽度变化」可能不在同一帧，补算可避免漏判。
         */
        function scheduleNarrowRecheck() {
          evaluateNarrow()
          watchSidebar()
          if (narrowRecheckTimer) clearTimeout(narrowRecheckTimer)
          narrowRecheckTimer = setTimeout(() => { evaluateNarrow(); watchSidebar() }, 160)
        }
        const narrowObserver = (typeof ResizeObserver === 'function')
          ? new ResizeObserver(() => scheduleNarrowRecheck())
          : undefined
        if (narrowObserver) narrowObserver.observe(document.documentElement)
        else window.addEventListener('resize', scheduleNarrowRecheck)
        watchSidebar()
        narrowBarEl.addEventListener('click', (e) => {
          e.stopPropagation()
          narrowDismissed = true
          narrowMode = false
          if (docked) { // 点竖条 = 解除贴边停靠，回到拖之前的位置
            docked = null
            saveJSON('dock', null)
          }
          syncStrip(false)
        })

        // 设置：拖到窗口边缘自动吸附成竖条（默认开）
        snapToggleEl.checked = snapEnabled
        snapToggleEl.addEventListener('change', () => {
          snapEnabled = snapToggleEl.checked !== false
          saveJSON('snapEnabled', snapEnabled)
          if (!snapEnabled && docked) { // 关掉开关时一并解除已有停靠
            docked = null
            saveJSON('dock', null)
            syncStrip(false)
          }
        })

        // 设置：两个紧凑态（最小化胶囊 / 贴边竖条）显示「本回合花费」（默认关 = 会话花费）。
        // 纯显示切换，不影响任何记账；改了立即重渲染，不用等下一轮轮询。
        compactCostToggleEl.checked = compactCostMode === 'turn'
        compactCostToggleEl.addEventListener('change', () => {
          compactCostMode = compactCostToggleEl.checked ? 'turn' : 'session'
          saveJSON('compactCost', compactCostMode)
          if (gaugeView) render(gaugeView)
        })

        // ===== 遮挡对话区时的「局部磨砂玻璃」 =====
        // 开关默认关闭；开启后只把浮窗与「中间对话区」相交的那一块做成半透明磨砂。
        let frostEnabled = loadJSON('frostEnabled') === true
        let frostRaf = 0
        const clampNum = (v, lo, hi, dflt) => {
          if (v === null || v === undefined || v === '') return dflt
          const n = Number(v)
          return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
        }
        let frostBlur = Math.round(clampNum(loadJSON('frostBlur'), 0, 24, 9))       // 磨砂强度：模糊半径 px
        let frostTrans = Math.round(clampNum(loadJSON('frostTrans'), 0, 100, 47))   // 透明强度：越大白雾越淡、越通透
        let bandTrans = Math.round(clampNum(loadJSON('bandTrans'), 0, 60, 15))      // 标题栏/底部行的透明度 %
        let edgeFade = Math.round(clampNum(loadJSON('edgeFade'), 0, 40, 14))        // 正常区 ↔ 玻璃区的过渡宽度 px
        let lumaAlgo = Math.round(clampNum(loadJSON('lumaAlgo'), 0, 2, 0))          // 0=Rec.709 亮度 1=HSL 明度 2=HSV 明度
        let lumaGain = Math.round(clampNum(loadJSON('lumaGain'), 0, 100, 100))      // 内容不透明度系数 %（100% = 严格按明度）
        const LUMA_NAMES = ['Rec.709', 'HSL', 'HSV']
        /** 过渡带宽度（px）：由设置里的「边缘过渡」决定（0 = 硬边）。 */
        const frostFeather = () => edgeFade
        const lumaSvgEl = root.querySelector('.dsg-filters')
        /**
         * 「洞口」用 feFlood 的**滤镜原始子区域**做出来（x/y/width/height 会被裁剪成矩形，
         * 坐标是「元素自身左上角」起的 px，靠 filterUnits="userSpaceOnUse" 保证）。
         * 再把「洞内的变换结果」与「洞外的原图」叠起来：只有压进对话区的那块会变，其余保持原样。
         */
        function shapeAndCut(tag) {
          return '<feFlood data-shape="' + tag + '" flood-color="#fff" x="0" y="0" width="0" height="0" result="S_' + tag + '"/>'
            + '<feGaussianBlur in="S_' + tag + '" stdDeviation="' + Math.max(0, edgeFade * 0.6).toFixed(1) + '" result="SF_' + tag + '"/>'
            + '<feComposite in="' + (tag === 'gauge' ? 'GG' : 'D') + '" in2="SF_' + tag + '" operator="in" result="I_' + tag + '"/>'
            + '<feComposite in="SourceGraphic" in2="SF_' + tag + '" operator="out" result="O_' + tag + '"/>'
            + '<feComposite in="I_' + tag + '" in2="O_' + tag + '" operator="over"/>'
        }
        /** 明度链：算 L（三种算法之一），再把「L × 系数」写进 alpha。 */
        function lumaChain(algo, gain) {
          const ch = (i) => {
            const row = [0, 1, 2].map((k) => (k === i ? 1 : 0)).join(' ')
            return '<feColorMatrix in="SourceGraphic" result="c' + i + '" type="matrix" values="'
              + row + ' 0 0  ' + row + ' 0 0  ' + row + ' 0 0  0 0 0 1 0"/>'
          }
          const g = Math.max(0, gain) / 100
          const alphaRows = (a, b, c) => '<feColorMatrix in="L" result="G" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  '
            + a.toFixed(4) + ' ' + b.toFixed(4) + ' ' + c.toFixed(4) + ' 0 0"/>'
            + '<feComposite in="G" in2="SourceGraphic" operator="in" result="GG"/>'
          if (algo === 2) {   // HSV 明度 = max(R,G,B)
            return ch(0) + ch(1) + ch(2)
              + '<feBlend in="c0" in2="c1" mode="lighten" result="m1"/>'
              + '<feBlend in="m1" in2="c2" mode="lighten" result="L"/>'
              + alphaRows(g, 0, 0)
          }
          if (algo === 1) {   // HSL 明度 = (max + min) / 2
            return ch(0) + ch(1) + ch(2)
              + '<feBlend in="c0" in2="c1" mode="lighten" result="mx1"/>'
              + '<feBlend in="mx1" in2="c2" mode="lighten" result="L"/>'
              + '<feBlend in="c0" in2="c1" mode="darken" result="mn1"/>'
              + '<feBlend in="mn1" in2="c2" mode="darken" result="mn"/>'
              + '<feComposite in="L" in2="mn" operator="arithmetic" k1="0" k2="0.5" k3="0.5" k4="0" result="L2"/>'
              + alphaRows(g, 0, 0).replace('in="L" result="G"', 'in="L2" result="G"')
          }
          return '<feColorMatrix in="SourceGraphic" result="L" type="matrix" values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"/>'
            + alphaRows(0.2126 * g, 0.7152 * g, 0.0722 * g)
        }
        /** 标题栏 / 底部行 / 设置：只在洞内把整体不透明度乘 A。 */
        function alphaChain(a) {
          return '<feComponentTransfer in="SourceGraphic" result="D">'
            + '<feFuncA type="linear" slope="' + a.toFixed(3) + '" intercept="0"/></feComponentTransfer>'
        }
        let lastOverlapRect = null   // 最近一次算出的洞口矩形（重建滤镜后要立刻补写回去）
        function renderLumaFilter() {
          if (!lumaSvgEl) return
          const A = 1 - bandTrans / 100
          const filter = (id, chain, tag) => '<filter id="' + id + '" color-interpolation-filters="sRGB"'
            + ' filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="0" y="0" width="0" height="0">'
            + chain + shapeAndCut(tag) + '</filter>'
          lumaSvgEl.innerHTML = filter(lumaId, lumaChain(lumaAlgo, lumaGain), 'gauge')
            + filter(lumaId + '-t', alphaChain(A), 'title')
            + filter(lumaId + '-r', alphaChain(A), 'rows')
            + filter(lumaId + '-s', alphaChain(A), 'settings')
          root.style.setProperty('--dsg-luma', 'url(#' + lumaId + ')')
          root.style.setProperty('--dsg-a-title', 'url(#' + lumaId + '-t)')
          root.style.setProperty('--dsg-a-rows', 'url(#' + lumaId + '-r)')
          root.style.setProperty('--dsg-a-settings', 'url(#' + lumaId + '-s)')
          // 重建后 feFlood 子区域都是 0×0，必须马上按上次的洞口矩形写回，否则内容变换会消失
          if (lastOverlapRect) updateShapes(lastOverlapRect[0], lastOverlapRect[1], lastOverlapRect[2], lastOverlapRect[3])
        }
        /** 把洞口矩形换算成各元素包围盒内的比例，写进对应的 feImage。 */
        function updateShapes(x1, y1, x2, y2) {
          if (!lumaSvgEl) return
          const targets = [
            ['gauge', root.querySelector('.dsg-gauge')],
            ['title', root.querySelector('.dsg-title')],
            ['rows', root.querySelector('.dsg-rows')],
            ['settings', root.querySelector('.dsg-settings')],
          ]
          for (const [tag, el] of targets) {
            const shape = lumaSvgEl.querySelector('feFlood[data-shape="' + tag + '"]')
            if (!shape) continue
            const filterEl = shape.closest('filter')
            if (!el) { if (filterEl) filterEl.setAttribute('width', '0'); shape.setAttribute('width', '0'); shape.setAttribute('height', '0'); continue }
            const r = el.getBoundingClientRect()
            if (r.width < 1 || r.height < 1) { if (filterEl) filterEl.setAttribute('width', '0'); shape.setAttribute('width', '0'); shape.setAttribute('height', '0'); continue }
            // 滤镜区域 = 元素自身盒子（userSpaceOnUse，原点就是元素左上角）
            if (filterEl) {
              filterEl.setAttribute('width', r.width.toFixed(1))
              filterEl.setAttribute('height', r.height.toFixed(1))
            }
            // 洞口矩形（相对元素左上角，px）；超出元素的部分由滤镜区域自动裁掉
            shape.setAttribute('x', (x1 - r.left).toFixed(1))
            shape.setAttribute('y', (y1 - r.top).toFixed(1))
            shape.setAttribute('width', (x2 - x1).toFixed(1))
            shape.setAttribute('height', (y2 - y1).toFixed(1))
          }
        }
        /** 把强度/透明换成 CSS 变量：白雾浓度 = 0.32 ×（1 - 透明强度），过渡宽度随模糊半径走。 */
        function applyFrostStyle() {
          const tint = Math.max(0, 0.32 * (1 - frostTrans / 100))
          root.style.setProperty('--dsg-blur', frostBlur + 'px')
          root.style.setProperty('--dsg-tint', tint.toFixed(3))
          root.style.setProperty('--dsg-feather', edgeFade + 'px')            // 洞口外侧（背景/磨砂层）的过渡
          root.style.setProperty('--dsg-band-feather', edgeFade + 'px')       // 三条带之间（标题/中间/底部）的过渡
          root.style.setProperty('--dsg-bar-a', (1 - bandTrans / 100).toFixed(3))   // 背景层不透明度（1 = 完全不透明）
        }
        /** 清掉洞口（把洞挪到画布外并置零），未磨砂时背景保持完整不透明。 */
        function clearHoleVars() {
          root.style.setProperty('--dsg-hole-x', '-999px')
          root.style.setProperty('--dsg-hole-y', '-999px')
          root.style.setProperty('--dsg-hole-w', '0px')
          root.style.setProperty('--dsg-hole-h', '0px')
          root.style.setProperty('--dsg-band-y', '-999px')
          root.style.setProperty('--dsg-band-h', '0px')
          root.style.setProperty('--dsg-bar-a', '1')   // 1 = 标题栏/底部行完全不透明
        }
        /** 取「中间对话区」矩形：frame 中位于侧栏右侧、足够宽高的最宽子元素（回退 scrollBody）。 */
        let chatPanelEl = null // 最近识别到的对话面板元素：把 scrollBody / 输入卡的查找限定在中间列里
        function getChatAreaRect() {
          try {
            chatPanelEl = null
            const side = getSidebarEl()
            const sideRight = side ? side.getBoundingClientRect().right : 0
            const frame = getFrameEl()
            let best = null
            if (frame) {
              for (const el of frame.children) {
                const r = el.getBoundingClientRect()
                if (r.width < 300 || r.height < window.innerHeight * 0.5) continue
                if (r.left < sideRight - 4) continue
                if (!best || r.width > best.width) { best = r; chatPanelEl = el }
              }
            }
            if (!best) {
              const sb = document.querySelector('[class*="scrollBody" i]')
              if (sb) { best = sb.getBoundingClientRect(); chatPanelEl = sb }
            }
            return best
          } catch { return null }
        }
        /**
         * 取「对话内容列」矩形：中间列里居中、宽度 = --dsh-chat-content-width 的实际内容带
         * （对话面板两侧留白不算内容）。取不到 CSS 变量时退回整个中间列。
         */
        function resolveCssLength(expr) {
          // 用探针元素让浏览器把 clamp()/calc() 之类的表达式算成 px。
          try {
            const probe = document.createElement('div')
            probe.style.cssText = 'position:absolute;left:-9999px;top:0;width:' + expr
            document.body.appendChild(probe)
            const w = probe.getBoundingClientRect().width
            probe.remove()
            return w
          } catch { return NaN }
        }
        function getChatContentRect() {
          const panel = getChatAreaRect()
          if (!panel) return null
          let w = NaN
          let padded = false
          try {
            const sb = (chatPanelEl && chatPanelEl.querySelector ? chatPanelEl.querySelector('[class*="scrollBody" i]') : null)
              || document.querySelector('[class*="scrollBody" i]')
            const raw = (getComputedStyle(sb || document.body).getPropertyValue('--dsh-chat-content-width') || '').trim()
            // 该变量常常是 clamp(680px, calc(… * .64), 920px) 这类表达式，得让浏览器自己算。
            if (/^[\d.]+px$/.test(raw)) w = parseFloat(raw)
            else if (raw) w = resolveCssLength(raw)
            if (!(w > 0 && w <= panel.width)) w = NaN // 表达式非法/量到的不是内容列宽度：走退路
          } catch {}
          if (!Number.isFinite(w) || w <= 0) {
            // 退路：对话面板里居中的输入卡（宽度 = 内容列 + 两侧 16px 留白）。
            try {
              const hero = (chatPanelEl && chatPanelEl.querySelector ? chatPanelEl.querySelector('[class*="composerHero" i]') : null)
                || document.querySelector('[class*="composerHero" i]')
              if (hero) {
                const hr = hero.getBoundingClientRect()
                if (hr.width > 120 && hr.width < panel.width) { w = hr.width; padded = true }
              }
            } catch {}
          }
          if (!Number.isFinite(w) || w <= 0) { w = panel.width; padded = true } // 都取不到：按整个面板处理
          if (!padded) w += 32 // 内容列 + 两侧 16px 安全边距
          w = Math.min(w, panel.width)
          const left = panel.left + (panel.width - w) / 2
          return { left, right: left + w, top: panel.top, bottom: panel.bottom, width: w, height: panel.height }
        }
        let frostTipShown = loadJSON('frostTip') === true // 提示只弹一次
        /** 没开磨砂却正压着对话文字时，提示一次（免得用户以为功能没生效）。 */
        function maybeFrostTip() {
          if (frostTipShown) return
          try {
            const chat = getChatContentRect()
            if (!chat) return
            const rr = root.getBoundingClientRect()
            const ow = Math.min(rr.right, chat.right) - Math.max(rr.left, chat.left)
            const oh = Math.min(rr.bottom, chat.bottom) - Math.max(rr.top, chat.top)
            if (!(ow > 0 && oh > 0)) return
            if (ow * oh < rr.width * rr.height * 0.35) return // 遮挡得够多才提示
            frostTipShown = true
            saveJSON('frostTip', true)
            showToast(t('frostTip'), true)
          } catch {}
        }
        /** 计算交集 → 在背景层挖洞、把磨砂层铺在洞口上。 */
        function updateFrost() {
          // 折叠态 / 竖版小条：保持原样，不做玻璃化（内容都在把手条上，透明了反而看不清）
          const tiny = root.classList.contains('dsg-collapsed') || root.classList.contains('dsg-narrow')
          const off = () => { root.classList.remove('dsg-frosting'); clearHoleVars() }
          if (!frostEnabled || tiny) {
            off()
            if (!frostEnabled) maybeFrostTip()
            return
          }
          const chat = getChatContentRect()
          if (!chat) { off(); return }
          const rr = root.getBoundingClientRect()
          const x1 = Math.max(rr.left, chat.left)
          const x2 = Math.min(rr.right, chat.right)
          const y1 = Math.max(rr.top, chat.top)
          const y2 = Math.min(rr.bottom, chat.bottom)
          const iw = x2 - x1
          const ih = y2 - y1
          if (iw < 3 || ih < 8) { off(); return }
          // 三条带（相对浮窗）：标题栏 | 中间（仪表盘 + 文字）| 底部（会话花费/余额 [+ 设置]）
          const titleEl = root.querySelector('.dsg-title')
          const rowsEl = root.querySelector('.dsg-rows')
          const tRect = titleEl ? titleEl.getBoundingClientRect() : null
          const rRect = rowsEl ? rowsEl.getBoundingClientRect() : null
          const bodyTop = tRect ? Math.max(0, tRect.bottom - rr.top) : 0
          const bodyBottom = (rRect && rRect.height > 0) ? Math.min(rr.height, rRect.top - rr.top) : rr.height
          const bandY = Math.max(y1 - rr.top, bodyTop)
          const bandBottom = Math.min(y2 - rr.top, bodyBottom)
          const bandH = bandBottom - bandY
          if (bandH < 8) { off(); return }   // 中间带太窄就不做（例如只剩标题栏）
          // ① 与对话区重叠的那一段列（横向遮罩 + 磨砂层用）
          root.style.setProperty('--dsg-hole-x', (x1 - rr.left).toFixed(1) + 'px')
          root.style.setProperty('--dsg-hole-w', iw.toFixed(1) + 'px')
          // ② 整个重叠块（磨砂层的模糊/白雾铺满这块）
          root.style.setProperty('--dsg-hole-y', (y1 - rr.top).toFixed(1) + 'px')
          root.style.setProperty('--dsg-hole-h', ih.toFixed(1) + 'px')
          // ③ 中间带：背景全透明；带外（标题栏 / 底部行）由 .dsg-bar 按 --dsg-bar-a 叠色
          root.style.setProperty('--dsg-band-y', bandY.toFixed(1) + 'px')
          root.style.setProperty('--dsg-band-h', bandH.toFixed(1) + 'px')
          root.style.setProperty('--dsg-bar-a', (1 - bandTrans / 100).toFixed(3))
          lastOverlapRect = [x1, y1, x2, y2]
          updateShapes(x1, y1, x2, y2)   // 内容变换只作用在「压进对话区」的那块矩形里
          root.classList.add('dsg-frosting')
        }
        function scheduleFrost() {
          if (frostRaf) return
          frostRaf = requestAnimationFrame(() => { frostRaf = 0; updateFrost() })
        }
        // 磨砂强度 / 透明强度
        const frostBlurEl = root.querySelector('.dsg-frost-blur')
        const frostTransEl = root.querySelector('.dsg-frost-trans')
        const frostBlurValEl = root.querySelector('.dsg-frost-blur-val')
        const frostTransValEl = root.querySelector('.dsg-frost-trans-val')
        const frostOptsEl = root.querySelector('.dsg-frostopts')
        function syncFrostControls() {
          if (frostBlurEl) {
            frostBlurEl.value = String(frostBlur)
            if (frostBlurValEl) frostBlurValEl.textContent = frostBlur + 'px'
          }
          if (frostTransEl) {
            frostTransEl.value = String(frostTrans)
            if (frostTransValEl) frostTransValEl.textContent = frostTrans + '%'
          }
          if (edgeFadeEl) {
            edgeFadeEl.value = String(edgeFade)
            if (edgeFadeValEl) edgeFadeValEl.textContent = edgeFade + 'px'
          }
          if (bandTransEl) {
            bandTransEl.value = String(bandTrans)
            if (bandTransValEl) bandTransValEl.textContent = bandTrans + '%'
          }
          if (lumaAlgoEl) lumaAlgoEl.value = String(lumaAlgo)
          if (lumaGainEl) {
            lumaGainEl.value = String(lumaGain)
            if (lumaGainValEl) lumaGainValEl.textContent = lumaGain + '%'
          }
          if (frostOptsEl) frostOptsEl.classList.toggle('off', !frostEnabled)
        }
        if (frostBlurEl) {
          frostBlurEl.addEventListener('input', () => {
            frostBlur = Math.round(clampNum(frostBlurEl.value, 0, 24, 9))
            saveJSON('frostBlur', frostBlur)
            applyFrostStyle(); syncFrostControls(); updateFrost()
          })
        }
        if (frostTransEl) {
          frostTransEl.addEventListener('input', () => {
            frostTrans = Math.round(clampNum(frostTransEl.value, 0, 100, 47))
            saveJSON('frostTrans', frostTrans)
            applyFrostStyle(); syncFrostControls(); updateFrost()
          })
        }
        const edgeFadeEl = root.querySelector('.dsg-edge-fade')
        const edgeFadeValEl = root.querySelector('.dsg-edge-fade-val')
        const bandTransEl = root.querySelector('.dsg-band-trans')
        const bandTransValEl = root.querySelector('.dsg-band-trans-val')
        const lumaAlgoEl = root.querySelector('.dsg-luma-algo')
        const lumaGainEl = root.querySelector('.dsg-luma-gain')
        const lumaGainValEl = root.querySelector('.dsg-luma-gain-val')
        if (edgeFadeEl) {
          edgeFadeEl.addEventListener('input', () => {
            edgeFade = Math.round(clampNum(edgeFadeEl.value, 0, 40, 14))
            saveJSON('edgeFade', edgeFade)
            renderLumaFilter(); applyFrostStyle(); syncFrostControls(); updateFrost()
          })
        }
        if (bandTransEl) {
          bandTransEl.addEventListener('input', () => {
            bandTrans = Math.round(clampNum(bandTransEl.value, 0, 60, 15))
            saveJSON('bandTrans', bandTrans)
            renderLumaFilter(); applyFrostStyle(); syncFrostControls(); updateFrost()
          })
        }
        if (lumaGainEl) {
          lumaGainEl.addEventListener('input', () => {
            lumaGain = Math.round(clampNum(lumaGainEl.value, 0, 100, 100))
            saveJSON('lumaGain', lumaGain)
            renderLumaFilter(); syncFrostControls(); updateFrost()
          })
        }
        if (lumaAlgoEl) {
          lumaAlgoEl.addEventListener('change', () => {
            lumaAlgo = Math.round(clampNum(lumaAlgoEl.value, 0, 2, 0))
            saveJSON('lumaAlgo', lumaAlgo)
            renderLumaFilter(); syncFrostControls(); updateFrost()
          })
        }
        if (frostToggleEl) {
          frostToggleEl.checked = frostEnabled
          frostToggleEl.addEventListener('change', () => {
            frostEnabled = !!frostToggleEl.checked
            saveJSON('frostEnabled', frostEnabled)
            syncFrostControls()
            updateFrost()
          })
        }
        root.style.setProperty('--dsg-luma', 'url(#' + lumaId + ')')
        renderLumaFilter()
        applyFrostStyle()
        syncFrostControls()
        window.addEventListener('resize', scheduleFrost)

        // ===== 窗口尺寸变化时，自动让出中间的对话区 =====
        // 规则：拉伸/缩放窗口后，若浮窗压住了「对话内容列」，就把它挪到这一侧的空白处：
        //   偏左（浮窗中心在内容列左侧）→ 往左让；偏右 → 往右让。
        //   每一侧优先落在对话面板内的留白（内容列旁边），放不下再退到面板外（侧栏/右侧空档）；
        //   首选侧实在放不下时用另一侧；两侧都不行则保持原位（只做视口保护）。
        // 只在窗口尺寸变化时触发（不干扰手动拖拽），竖版小条模式下不参与。
        const CHAT_GAP = 8
        let chatYieldTimer = 0
        /** 两矩形相交面积（不相交为 0）。 */
        function overlapArea(a, b) {
          const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          return (w > 0 && h > 0) ? w * h : 0
        }
        /** 底部输入框区域：composer seat → 输入卡 → 覆盖层。 */
        function getComposerRect() {
          try {
            const pick = (sel) => (chatPanelEl && chatPanelEl.querySelector ? chatPanelEl.querySelector(sel) : null) || document.querySelector(sel)
            // 用「输入卡」本身判定（而不是横跨整个面板的 seat 容器）：内容列两侧的留白本身是空的，
            // 停在那里不该被当成压住输入框。
            const el = pick('[class*="composerHero" i]') || pick('[data-conversation-composer-overlay]') || pick('[class*="composerSeat" i]')
            if (!el) return null
            const r = el.getBoundingClientRect()
            if (r.width < 80 || r.height < 20) return null
            return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
          } catch { return null }
        }
        /** 两侧侧栏（左：sidebarCol/aside；右：rightbarCol）。收起状态（窄于 40px）不算。 */
        function getSidebarRects() {
          const out = []
          try {
            for (const el of [getSidebarEl(), document.querySelector('[class*="rightbarCol" i]')]) {
              if (!el) continue
              const r = el.getBoundingClientRect()
              if (r.width < 40 || r.height < 80) continue
              out.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height })
            }
          } catch {}
          return out
        }
        // 打分优先级：不压「对话内容列」（硬约束）→ 不压底部输入框 → 不压两侧侧栏；
        // 同分保留先考察的落点（即更符合「偏左往左、偏右往右」且移动更小的那个）。
        function keepOutOfChatArea() {
          if (narrowMode || dragActive) return
          const panel = getChatAreaRect()
          const content = getChatContentRect()
          if (!panel || !content) return
          const rr = root.getBoundingClientRect()
          const w = rr.width
          const h = rr.height
          // 与内容列的交集：几乎没有遮挡就不动。
          const ox = Math.min(rr.right, content.right) - Math.max(rr.left, content.left)
          const oy = Math.min(rr.bottom, content.bottom) - Math.max(rr.top, content.top)
          if (ox < 32 || oy < Math.min(20, h * 0.25)) return
          const composer = getComposerRect()
          const bars = getSidebarRects()
          const minX = EDGE_MARGIN
          const maxX = window.innerWidth - w - EDGE_MARGIN
          const minY = EDGE_MARGIN
          const maxY = Math.max(minY, window.innerHeight - h - EDGE_MARGIN)
          const y0 = Math.round(Math.min(Math.max(minY, rr.top), maxY))
          const ys = [y0]
          if (composer) {
            // 允许同时上移，躲开底部输入框。
            const above = Math.round(composer.top - h - CHAT_GAP)
            if (above >= minY && above <= maxY && above !== y0) ys.push(above)
          }
          /** 该横向位置上是否会与底部输入卡相撞（左右各留 CHAT_GAP 余量）。 */
          const cardSide = (v) => !!composer && v < composer.right + CHAT_GAP && v + w > composer.left - CHAT_GAP
          /** 留白里靠下放置的 y：能贴底就贴底，会撞到输入卡就停在输入卡上方。 */
          const bottomYOf = (v) => cardSide(v) ? Math.round(Math.min(maxY, composer.top - h - CHAT_GAP)) : maxY
          const cx = (rr.left + rr.right) / 2
          const contentCx = (content.left + content.right) / 2
          // 每侧两个落点：
          //   1) 面板内「内容列与侧栏之间的留白」——够宽就停在留白正中（既不压文字区也不压侧栏）；
          //   2) 面板外的空档（会压到侧栏，只在留白放不下时使用）。
          const candidates = (side) => side < 0
            ? [
              { x: panel.left + (content.left - panel.left - w) / 2, inside: () => (content.left - panel.left) >= w + CHAT_GAP * 2, bottom: true },
              { x: panel.left - w - CHAT_GAP },
            ]
            : [
              { x: content.right + (panel.right - content.right - w) / 2, inside: () => (panel.right - content.right) >= w + CHAT_GAP * 2, bottom: true },
              { x: panel.right + CHAT_GAP },
            ]
          const order = cx < contentCx ? [-1, 1] : [1, -1]
          let best = null
          const consider = (x, y) => {
            if (x < minX - 0.5 || x > maxX + 0.5 || y < minY - 0.5 || y > maxY + 0.5) return
            const box = { left: x, right: x + w, top: y, bottom: y + h }
            if (overlapArea(box, content) > 0) return
            const mOver = composer ? overlapArea(box, composer) : 0
            let sOver = 0
            for (const b of bars) sOver += overlapArea(box, b)
            if (!best || mOver < best.mOver || (mOver === best.mOver && sOver < best.sOver)) best = { x, y, mOver, sOver }
          }
          for (const side of order) {
            for (const cand of candidates(side)) {
              const v = Math.round(cand.x)
              if (cand.inside && !cand.inside(v)) continue
              // 面板内留白 → 靠下放置；面板外的空档 → 沿用当前位置（尽量少动）。
              const list = cand.bottom ? [bottomYOf(v), y0].filter((y, i, a) => a.indexOf(y) === i) : ys
              for (const y of list) consider(v, y)
            }
          }
          if (!best) return
          if (best.x === root.offsetLeft && best.y === root.offsetTop) return
          root.style.left = best.x + 'px'
          root.style.top = best.y + 'px'
          saveJSON('pos', { x: best.x, y: best.y })
          scheduleFrost()
        }
        function onWindowResizeYield() {
          if (chatYieldTimer) clearTimeout(chatYieldTimer)
          chatYieldTimer = setTimeout(keepOutOfChatArea, 150)
        }
        window.addEventListener('resize', onWindowResizeYield)

        function showToast(msg, ok) {
          toastEl.textContent = msg
          toastEl.style.background = ok ? 'rgba(34,197,94,.16)' : 'rgba(239,68,68,.16)'
          toastEl.style.borderColor = ok ? 'rgba(34,197,94,.5)' : 'rgba(239,68,68,.5)'
          toastEl.style.color = ok ? '#bbf7d0' : '#fecaca'
          root.classList.add('dsg-toast-show')
          clearTimeout(toastTimer)
          toastTimer = setTimeout(() => root.classList.remove('dsg-toast-show'), 2600)
        }
        function pad2(n) { return String(n).padStart(2, '0') }
        function money2(v) { return '¥' + (Number.isFinite(v) ? v : 0).toFixed(2) }
        function addDaysStr(s, n) {
          const d = new Date(s + 'T00:00:00Z')
          d.setUTCDate(d.getUTCDate() + n)
          return d.toISOString().slice(0, 10)
        }
        function weekStartOf(s) {
          const d = new Date(s + 'T00:00:00Z')
          return addDaysStr(s, -((d.getUTCDay() + 6) % 7))
        }
        function todayStr() {
          const p = beijingPartsNow()
          return p.year + '-' + pad2(p.month) + '-' + pad2(p.day)
        }
        /** DSH 自己持久化「当前选中哪个会话」的 localStorage 键（由 dsh-client-ui-workspace 写入）。 */
        const CURRENT_SESSION_KEY = 'dsh.sessions.current'
        /**
         * 当前会话 id。
         *
         * DSH 0.1.7 起客户端 `sessions` 服务的 list 快照**不再有 `current` 字段**
         * （dsh-api-session-controller/lib/client.js 的 list 只有 ids / byId / phase /
         * projectionsBySession；其源码注释即写明「view selection remains outside the
         * Controller」）。选中状态改由 dsh-client-ui-workspace 私有维护，且没有
         * provide 成服务（0.1.7 客户端仅提供 sessions / layout / resources / modules /
         * documentPreviews / uiRenderer / sidebarRightTabs / sidebarRight 八个服务），
         * 插件无从注入。故按可靠性依次取：
         *   1) localStorage['dsh.sessions.current'] —— DSH 自己持久化的选择，形如
         *      { sessionId }；dsh-client-store 的 attachPersistence 在每次变更时**同步**
         *      写回，故是实时信号；
         *   2) data-sidebar-right-session —— 右栏当前会话元素，同样由 DSH 自己写入；
         *   3) 旧版快照的 .current —— 0.1.6 及更早版本。
         * 三者皆不可得时返回 undefined，调用方退化为不带 ?session= 的请求。
         */
        function currentSessionId() {
          try {
            const raw = localStorage.getItem(CURRENT_SESSION_KEY)
            if (raw) {
              const id = JSON.parse(raw).sessionId
              if (typeof id === 'string' && id) return id
            }
          } catch {}
          try {
            const el = document.querySelector('[data-sidebar-right-session]:not([hidden])')
            const id = el && el.getAttribute('data-sidebar-right-session')
            if (id) return id
          } catch {}
          try { return ctx.sessions.list.getSnapshot().current } catch { return undefined }
        }
        function lastDayOfMonthKey(ym) {
          const y = Number(ym.slice(0, 4))
          const m = Number(ym.slice(5, 7))
          const d = new Date(Date.UTC(y, m, 0)).getUTCDate()
          return ym + '-' + pad2(d)
        }
        function ymd(s) { return String(s).replace(/-/g, '') }
        /** 导出内容实际覆盖的时间段（没有记录时回退到当前选择的时间段）。 */
        function periodSpan() {
          const groups = Array.isArray(panel.groups) ? panel.groups : []
          if (groups.length) {
            const first = String(groups[0].key || '')
            const last = String(groups[groups.length - 1].key || '')
            const start = first.length === 7 ? first + '-01' : first
            const end = last.length === 7 ? lastDayOfMonthKey(last) : last
            if (start && end) return { start, end }
          }
          ensurePanelCursor()
          if (panel.range === 'year') return { start: panel.year + '-01-01', end: panel.year + '-12-31' }
          if (panel.range === 'month') {
            const ym = panel.year + '-' + pad2(panel.month)
            return { start: ym + '-01', end: lastDayOfMonthKey(ym) }
          }
          if (panel.range === 'week') return { start: panel.weekStart, end: addDaysStr(panel.weekStart, 6) }
          const today = todayStr()
          return { start: today, end: today }
        }
        /** 默认文件名：会话名称_起-止（如 花费指示器插件_20260808-20260911）。 */
        function exportBaseName() {
          const scopeName = panel.scope === 'all' ? t('allSessions') : (panel.title || t('sessionFallback'))
          const span = periodSpan()
          return scopeName + '_' + ymd(span.start) + '-' + ymd(span.end)
        }
        /** 导出 Excel 首行说明。 */
        function exportNote() {
          const span = periodSpan()
          const scopeText = panel.scope === 'all'
            ? (t('allSessions') + (panel.sessionCount ? t('sessionCountShort', { n: panel.sessionCount }) : ''))
            : (t('thisSession') + ' · ' + (panel.title || t('sessionFallback')))
          const reset = panel.scope === 'session' && panel.resetAt
            ? new Date(panel.resetAt).toLocaleString(localeTag(), { hour12: false })
            : t('none')
          return t('exportNoteSession') + scopeText
            + ' · ' + t('exportNoteBilling') + span.start + ' ~ ' + span.end
            + ' · ' + t('exportNoteRange') + rangeText()
            + ' · ' + t('exportNoteLastReset') + reset
            + ' · ' + t('exportNoteExportedAt') + new Date().toLocaleString(localeTag(), { hour12: false })
        }
        function ensurePanelCursor() {
          if (panel.year) return
          const p = beijingPartsNow()
          panel.year = p.year
          panel.month = p.month
          panel.weekStart = weekStartOf(todayStr())
        }
        function dayIndex() {
          const map = {}
          for (const d of panel.days) map[d.date] = d
          return map
        }
        function sumDays(days, map) {
          const g = { std: 0, peak: 0, pro: 0, flash: 0, vision: 0, total: 0 }
          for (const ds of days) {
            const d = map[ds]
            if (!d) continue
            g.std += d.std; g.peak += d.peak; g.pro += d.pro; g.flash += d.flash; g.vision += d.vision; g.total += d.total
          }
          return g
        }
        function rangeText() {
          if (panel.range === 'all') return t('rangeAll')
          if (panel.range === 'year') return t('rangeYearText', { year: panel.year })
          if (panel.range === 'month') return panel.year + '-' + pad2(panel.month)
          return panel.weekStart + ' ~ ' + addDaysStr(panel.weekStart, 6)
        }
        function buildGroups() {
          ensurePanelCursor()
          const map = dayIndex()
          const dates = Object.keys(map).sort()
          const out = []
          if (panel.range === 'all') {
            const months = []
            for (const d of dates) { const m = d.slice(0, 7); if (months.indexOf(m) < 0) months.push(m) }
            for (const m of months) {
              const days = dates.filter((d) => d.slice(0, 7) === m)
              out.push(Object.assign({ key: m, label: m.replace('-', '/') }, sumDays(days, map)))
            }
          } else if (panel.range === 'year') {
            for (let mo = 1; mo <= 12; mo++) {
              const prefix = panel.year + '-' + pad2(mo)
              const days = dates.filter((d) => d.slice(0, 7) === prefix)
              out.push(Object.assign({ key: prefix, label: t('monthLabel', { m: pad2(mo) }), short: pad2(mo) }, sumDays(days, map)))
            }
          } else if (panel.range === 'month') {
            const prefix = panel.year + '-' + pad2(panel.month)
            const last = new Date(Date.UTC(panel.year, panel.month, 0)).getUTCDate()
            for (let dy = 1; dy <= last; dy++) {
              const ds = prefix + '-' + pad2(dy)
              out.push(Object.assign({ key: ds, label: pad2(dy), short: pad2(dy) }, sumDays([ds], map)))
            }
          } else {
            const wdNames = [t('wdMon'), t('wdTue'), t('wdWed'), t('wdThu'), t('wdFri'), t('wdSat'), t('wdSun')]
            for (let w = 0; w < 7; w++) {
              const ds = addDaysStr(panel.weekStart, w)
              out.push(Object.assign({ key: ds, label: wdNames[w] + ' ' + ds.slice(5), short: ds.slice(5) }, sumDays([ds], map)))
            }
          }
          return out
        }
        function isAtLatest() {
          const today = todayStr()
          if (panel.range === 'year') return panel.year >= Number(today.slice(0, 4))
          if (panel.range === 'month') {
            return panel.year === Number(today.slice(0, 4)) && panel.month >= Number(today.slice(5, 7))
          }
          if (panel.range === 'week') return panel.weekStart >= weekStartOf(today)
          return true
        }
        function shiftPeriod(delta) {
          if (panel.range === 'year') { panel.year += delta; return }
          if (panel.range === 'month') {
            let m = panel.month + delta
            let y = panel.year
            if (m < 1) { m = 12; y -= 1 } else if (m > 12) { m = 1; y += 1 }
            panel.month = m; panel.year = y; return
          }
          if (panel.range === 'week') panel.weekStart = addDaysStr(panel.weekStart, delta * 7)
        }
        function segsFor(g) {
          return panel.view === 'band'
            ? [['std', t('offPeak'), g.std], ['peak', t('peak'), g.peak]]
            : [['pro', 'v4-pro', g.pro], ['flash', 'v4-flash', g.flash], ['vision', 'flash-vision', g.vision]]
        }
        function renderPanel() {
          const groups = buildGroups()
          // 明细与导出只列出「有使用记录」的时段；柱状图仍按完整时间轴展示。
          const used = groups.filter((g) => (Number(g.total) || 0) > 1e-9)
          const sum = { std: 0, peak: 0, pro: 0, flash: 0, vision: 0, total: 0 }
          let max = 0.0001
          for (const g of groups) {
            sum.std += g.std; sum.peak += g.peak; sum.pro += g.pro
            sum.flash += g.flash; sum.vision += g.vision; sum.total += g.total
            if (g.total > max) max = g.total
          }
          recordsTotalEl.textContent = t('totalWithValue', { v: money2(sum.total) })
          recordsTitleEl.textContent = panel.scope === 'all'
            ? t('allRecordsTitle') + (panel.sessionCount ? t('sessionCountSuffix', { n: panel.sessionCount }) : '')
            : t('thisSession') + ' · ' + (panel.title || t('spendRecords')) +
              (panel.resetAt ? t('lastResetSuffix', { t: new Date(panel.resetAt).toLocaleString(localeTag(), { hour12: false }) }) : '')
          rangeLabelEl.textContent = rangeText()
          prevBtnEl.style.display = panel.range === 'all' ? 'none' : ''
          nextBtnEl.style.display = panel.range === 'all' ? 'none' : ''
          nextBtnEl.disabled = isAtLatest()
          chartMaxEl.textContent = t('maxWithValue', { v: money2(max) })

          let bars = ''
          for (const g of groups) {
            const segs = segsFor(g)
            const tip = g.label + ' · ' + t('totalWithValue', { v: money2(g.total) }) + '\n' +
              segs.map((s) => s[1] + ' ' + money2(s[2])).join('\n')
            let inner = ''
            const reversed = segs.slice().reverse()
            for (const s of reversed) {
              if (!(s[2] > 0)) continue
              inner += '<div class="dsg-bar-seg" style="height:' + (s[2] / max * 100).toFixed(2) +
                '%;background:' + SEG_COLORS[s[0]] + '"></div>'
            }
            bars += '<div class="dsg-bar" title="' + tip + '"><div class="dsg-bar-stack">' + inner +
              '</div><div class="dsg-bar-label">' + (g.short !== undefined ? g.short : g.label.replace(/^周./, '')) + '</div></div>'
          }
          barsEl.innerHTML = groups.length ? bars : ''

          let legend = ''
          const legendItems = panel.view === 'band'
            ? [['std', t('offPeak')], ['peak', t('peak')]]
            : [['pro', 'v4-pro'], ['flash', 'v4-flash'], ['vision', 'flash-vision']]
          for (const s of legendItems) {
            legend += '<span><i style="background:' + SEG_COLORS[s[0]] + '"></i>' + s[1] + '</span>'
          }
          legendEl.innerHTML = legend

          const head = panel.view === 'band'
            ? [t('period'), t('offPeak'), t('peak'), t('total')]
            : [t('period'), 'v4-pro', 'v4-flash', 'flash-vision', t('total')]
          tableHeadEl.innerHTML = '<tr>' + head.map((h) => '<th>' + h + '</th>').join('') + '</tr>'
          let rows = ''
          for (const g of used) {
            rows += panel.view === 'band'
              ? '<tr><td>' + g.label + '</td><td class="dsg-cell-std">' + money2(g.std) +
                '</td><td class="dsg-cell-peak">' + money2(g.peak) + '</td><td>' + money2(g.total) + '</td></tr>'
              : '<tr><td>' + g.label + '</td><td>' + money2(g.pro) + '</td><td>' + money2(g.flash) +
                '</td><td>' + money2(g.vision) + '</td><td>' + money2(g.total) + '</td></tr>'
          }
          if (used.length === 0) {
            rows = '<tr><td colspan="' + head.length + '" style="text-align:center;color:#6b7280">' + t('noRecords') + '</td></tr>'
          } else {
            rows += panel.view === 'band'
              ? '<tr class="dsg-sum"><td>' + t('total') + '</td><td>' + money2(sum.std) + '</td><td>' + money2(sum.peak) + '</td><td>' + money2(sum.total) + '</td></tr>'
              : '<tr class="dsg-sum"><td>' + t('total') + '</td><td>' + money2(sum.pro) + '</td><td>' + money2(sum.flash) + '</td><td>' + money2(sum.vision) + '</td><td>' + money2(sum.total) + '</td></tr>'
          }
          tableBodyEl.innerHTML = rows
          panel.groups = used
          // 内容渲染后高度会变，重新钳制一次，保证整块面板仍在窗口内
          if (root.classList.contains('dsg-records-open')) clampPanelToView()
        }
        async function fetchRecords() {
          try {
            const sid = currentSessionId()
            const params = []
            if (sid) params.push('session=' + encodeURIComponent(sid))
            if (panel.scope === 'all') params.push('scope=all')
            // @wire 记录面板 -> /api/cost-gauge/records
            const res = await fetch('/api/cost-gauge/records' + (params.length ? '?' + params.join('&') : ''))
            if (!res.ok) throw new Error('HTTP ' + res.status)
            const data = await res.json()
            panel.days = Array.isArray(data.days) ? data.days : []
            panel.resetAt = data.scope === 'all' ? null : (data.resetAt || null)
            panel.title = data.title || ''
            panel.sessionCount = Number(data.sessionCount) || 0
          } catch {
            panel.days = []
          }
          renderPanel()
        }
        function setPathDisplay(dir) {
          panel.excelDir = dir || ''
          if (panel.excelDir) {
            pathEl.textContent = panel.excelDir
            pathEl.classList.remove('unset')
          } else {
            pathEl.textContent = t('pathUnset')
            pathEl.classList.add('unset')
          }
        }
        async function refreshPrefs() {
          try {
            // @wire 设置面板 -> /api/cost-gauge/prefs
            const res = await fetch('/api/cost-gauge/prefs')
            if (!res.ok) return
            const data = await res.json()
            setPathDisplay(data.excelDir || '')
            panel.lastExport = data.lastExport || ''
            openBtnEl.disabled = !panel.lastExport
            setKeyState(data.minimaxKeySet === true)
          } catch {}
        }

        /**
         * Key 状态行：只显示「已配置 / 未配置」，不回显任何字符。
         * 页面里从不保留 Key 原文，提交后立刻清空输入框。
         */
        function setKeyState(isSet, message, kind) {
          if (!mmxKeyStateEl) return
          mmxKeyStateEl.classList.remove('ok', 'err')
          if (kind === 'ok' || kind === 'err') {
            mmxKeyStateEl.classList.add(kind)
            mmxKeyStateEl.textContent = message || ''
            return
          }
          mmxKeyStateEl.textContent = isSet ? t('minimaxKeyIsSet') : t('minimaxKeyNotSet')
        }

        async function saveMiniMaxKey() {
          const raw = mmxKeyEl ? mmxKeyEl.value.trim() : ''
          if (!raw) return
          try {
            const res = await fetch('/api/cost-gauge/prefs', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              // @wire 设置面板 -> /api/cost-gauge/prefs（写入 Key）
              body: JSON.stringify({ minimaxKey: raw }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || data.ok === false) {
              setKeyState(false, t('minimaxKeySaveFailed', { msg: data.error || ('HTTP ' + res.status) }), 'err')
              return
            }
            if (mmxKeyEl) mmxKeyEl.value = ''
            setKeyState(data.minimaxKeySet === true, t('minimaxKeySaved'), 'ok')
            // 立刻用新 Key 拉一次，用户马上能看到额度
            poll()
          } catch (e) {
            setKeyState(false, t('minimaxKeySaveFailed', { msg: e && e.message ? e.message : String(e) }), 'err')
          }
        }

        async function clearMiniMaxKey() {
          try {
            const res = await fetch('/api/cost-gauge/prefs', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ minimaxKey: '' }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok || data.ok === false) {
              setKeyState(true, t('minimaxKeySaveFailed', { msg: data.error || ('HTTP ' + res.status) }), 'err')
              return
            }
            if (mmxKeyEl) mmxKeyEl.value = ''
            setKeyState(false, t('minimaxKeyCleared'), 'ok')
            // 清掉额度数据，表盘弧与最小化环立刻回到「无数据」形态
            updateDial()
          } catch {}
        }
        function exportPayload() {
          // 与面板明细一致：只导出有使用记录的时段（panel.groups 已过滤）
          const groups = Array.isArray(panel.groups) ? panel.groups : buildGroups()
          const sum = groups.reduce((a, g) => {
            a.std += g.std; a.peak += g.peak; a.total += g.total
            a.pro += g.pro; a.flash += g.flash; a.vision += g.vision
            return a
          }, { std: 0, peak: 0, total: 0, pro: 0, flash: 0, vision: 0 })
          const round2 = (v) => Number(v.toFixed(2))
          const bandRows = groups.length
            ? groups.map((g) => [g.label, round2(g.std), round2(g.peak), round2(g.total)])
              .concat([[t('total'), round2(sum.std), round2(sum.peak), round2(sum.total)]])
            : [[t('noRecords'), 0, 0, 0]]
          const modelRows = groups.length
            ? groups.map((g) => [g.label, round2(g.pro), round2(g.flash), round2(g.vision), round2(g.total)])
              .concat([[t('total'), round2(sum.pro), round2(sum.flash), round2(sum.vision), round2(sum.total)]])
            : [[t('noRecords'), 0, 0, 0, 0]]
          return {
            rangeLabel: rangeText(),
            fileName: exportBaseName(),
            note: exportNote(),
            bandHead: [t('period'), t('offPeak'), t('peak'), t('total')],
            bandRows,
            modelHead: [t('period'), 'v4-pro', 'v4-flash', 'flash-vision', t('total')],
            modelRows,
          }
        }
        async function doExport() {
          try {
            // @wire 导出按钮 -> /api/cost-gauge/export
            const res = await fetch('/api/cost-gauge/export', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(exportPayload()),
            })
            const data = await res.json()
            if (data && data.ok) {
              panel.lastExport = data.path
              setPathDisplay(data.dir || panel.excelDir)
              openBtnEl.disabled = false
              showToast(t('toastExported', { path: data.path }), true)
            } else if (data && data.cancelled) {
              showToast(t('toastExportCancelled'), false)
            } else {
              showToast(t('toastExportFailed', { msg: (data && data.error) || t('unknownError') }), false)
            }
          } catch (e) {
            showToast(t('toastExportFailed', { msg: e && e.message ? e.message : String(e) }), false)
          }
        }
        async function doOpen() {
          if (!panel.lastExport) return
          try {
            // @wire 打开文件夹 -> /api/cost-gauge/open-folder
            const res = await fetch('/api/cost-gauge/open-folder', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ path: panel.lastExport }),
            })
            const data = await res.json()
            if (data && data.ok) showToast(t('toastRevealed', { path: panel.lastExport }), true)
            else showToast(t('toastOpenFailed', { msg: (data && data.error) || t('unknownError') }), false)
          } catch (e) {
            showToast(t('toastOpenFailed', { msg: e && e.message ? e.message : String(e) }), false)
          }
        }
        async function doPickFolder() {
          try {
            // @wire 选目录 -> /api/cost-gauge/pick-folder
            const res = await fetch('/api/cost-gauge/pick-folder', { method: 'POST' })
            const data = await res.json()
            if (data && data.ok) {
              setPathDisplay(data.excelDir || '')
              showToast(t('toastDefaultSet', { path: data.excelDir }), true)
            } else if (data && data.cancelled) {
              showToast(t('toastPickCancelled'), false)
            } else {
              showToast(t('toastSettingFailed', { msg: (data && data.error) || t('unknownError') }), false)
            }
          } catch (e) {
            showToast(t('toastSettingFailed', { msg: e && e.message ? e.message : String(e) }), false)
          }
        }
        async function doClearFolder() {
          try {
            const res = await fetch('/api/cost-gauge/prefs', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ excelDir: '' }),
            })
            const data = await res.json()
            if (data && data.ok) {
              setPathDisplay('')
              showToast(t('toastCleared'), true)
            } else {
              showToast(t('toastClearFailed'), false)
            }
          } catch {}
        }
        async function doReset() {
          const sid = currentSessionId()
          if (!sid) { showToast(t('toastNoSession'), false); return }
          try {
            // @wire 归零按钮 -> /api/cost-gauge/reset
            const res = await fetch('/api/cost-gauge/reset', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ session: sid }),
            })
            const data = await res.json()
            if (data && data.ok) {
              showToast(t('toastResetDone'), true)
              poll()
              fetchRecords()
            } else {
              showToast(t('toastResetFailed', { msg: (data && data.error) || t('unknownError') }), false)
            }
          } catch (e) {
            showToast(t('toastResetFailed', { msg: e && e.message ? e.message : String(e) }), false)
          }
        }
        function resetZeroButton() {
          zeroBtnEl.dataset.confirm = '0'
          zeroBtnEl.classList.remove('confirming')
          zeroBtnEl.textContent = '↺'
          zeroBtnEl.title = t('resetCostHint')
        }
        function bindPanel() {
          recordBtnEl.addEventListener('click', (e) => {
            e.stopPropagation()
            const open = root.classList.toggle('dsg-records-open')
            if (open) {
              openRecordsPanel()
              fetchRecords()
            }
          })
          attachPanelDrag()
          recordsCloseEl.addEventListener('click', (e) => {
            e.stopPropagation()
            root.classList.remove('dsg-records-open')
          })
          Array.prototype.forEach.call(rangeBtns, (b) => {
            b.addEventListener('click', () => {
              panel.range = b.getAttribute('data-range')
              Array.prototype.forEach.call(rangeBtns, (x) => x.classList.toggle('active', x === b))
              renderPanel()
            })
          })
          Array.prototype.forEach.call(scopeBtns, (b) => {
            b.addEventListener('click', () => {
              panel.scope = b.getAttribute('data-scope') === 'all' ? 'all' : 'session'
              Array.prototype.forEach.call(scopeBtns, (x) => x.classList.toggle('active', x === b))
              fetchRecords()
            })
          })
          Array.prototype.forEach.call(viewBtns, (b) => {
            b.addEventListener('click', () => {
              panel.view = b.getAttribute('data-view')
              Array.prototype.forEach.call(viewBtns, (x) => x.classList.toggle('active', x === b))
              renderPanel()
            })
          })
          prevBtnEl.addEventListener('click', () => { shiftPeriod(-1); renderPanel() })
          nextBtnEl.addEventListener('click', () => { shiftPeriod(1); renderPanel() })
          exportBtnEl.addEventListener('click', (e) => { e.stopPropagation(); doExport() })
          openBtnEl.addEventListener('click', (e) => { e.stopPropagation(); doOpen() })
          pickBtnEl.addEventListener('click', (e) => { e.stopPropagation(); doPickFolder() })
          clearPathBtnEl.addEventListener('click', (e) => { e.stopPropagation(); doClearFolder() })
          if (mmxKeySaveEl) mmxKeySaveEl.addEventListener('click', (e) => { e.stopPropagation(); saveMiniMaxKey() })
          if (mmxKeyClearEl) mmxKeyClearEl.addEventListener('click', (e) => { e.stopPropagation(); clearMiniMaxKey() })
          if (mmxKeyEl) {
            // 回车即保存；同时阻止按键冒泡到宿主的全局快捷键
            mmxKeyEl.addEventListener('keydown', (e) => {
              e.stopPropagation()
              if (e.key === 'Enter') { e.preventDefault(); saveMiniMaxKey() }
            })
          }
          zeroBtnEl.addEventListener('click', (e) => {
            e.stopPropagation()
            if (zeroBtnEl.dataset.confirm !== '1') {
              zeroBtnEl.dataset.confirm = '1'
              zeroBtnEl.classList.add('confirming')
              zeroBtnEl.textContent = t('confirm')
              zeroBtnEl.title = t('confirmResetTip')
              clearTimeout(zeroTimer)
              zeroTimer = setTimeout(resetZeroButton, 2500)
              return
            }
            clearTimeout(zeroTimer)
            resetZeroButton()
            doReset()
          })
        }

        // 初始状态 + 轮询 + 每秒 tick。
        setCollapsed(collapsedSaved)
        ticksEl.innerHTML = ticksMarkup()
        updateDial()
        poll()
        poll()
        bindPanel()
        refreshPrefs()
        fetchRecords()
        scheduleNarrowRecheck()
        updateFrost()
        const timer = setInterval(poll, POLL_MS)
        const ticker = setInterval(tick, TICK_MS)
        return () => {
          clearInterval(timer)
          clearInterval(ticker)
          clearTimeout(toastTimer)
          clearTimeout(zeroTimer)
          clearTimeout(narrowRecheckTimer)
          window.removeEventListener('resize', clampIntoView)
          window.removeEventListener('resize', onWindowResizePanel)
          if (narrowObserver) narrowObserver.disconnect()
          else window.removeEventListener('resize', scheduleNarrowRecheck)
          if (sideObserver) sideObserver.disconnect()
          if (frameAttrObserver) frameAttrObserver.disconnect()
          window.removeEventListener('resize', scheduleFrost)
          window.removeEventListener('resize', onWindowResizeYield)
          if (chatYieldTimer) clearTimeout(chatYieldTimer)
          if (frostRaf) cancelAnimationFrame(frostRaf)
          root.remove()
        }
      }, 'dsh-cost-gauge: widget')
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})