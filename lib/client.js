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
    const ARC_W = 11 // 费率弧线宽（CSS 与几何共用；圆头半径 = ARC_W/2）

    const CSS = `
.dsg-root{position:fixed;z-index:2147483000;width:${DEFAULT_W}px;box-sizing:border-box;
  container-type:inline-size;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  background:transparent;color:#e5e7eb;border:1px solid rgba(255,255,255,.10);
  border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.38);padding:7px 10px 9px;
  user-select:none;-webkit-user-select:none}
/* ===== 背景层 + 磨砂层（遮挡对话区时只把「压进去的那块」做成磨砂玻璃） ===== */
.dsg-bg{position:absolute;inset:0;z-index:0;border-radius:14px;background:rgba(20,22,28,.94);
  -webkit-mask-image:linear-gradient(#000,#000),linear-gradient(#000,#000);
  mask-image:linear-gradient(#000,#000),linear-gradient(#000,#000);
  -webkit-mask-size:100% 100%,var(--dsg-hole-w,0px) var(--dsg-hole-h,0px);
  mask-size:100% 100%,var(--dsg-hole-w,0px) var(--dsg-hole-h,0px);
  -webkit-mask-position:0 0,var(--dsg-hole-x,0px) var(--dsg-hole-y,0px);
  mask-position:0 0,var(--dsg-hole-x,0px) var(--dsg-hole-y,0px);
  -webkit-mask-repeat:no-repeat,no-repeat;mask-repeat:no-repeat,no-repeat;
  -webkit-mask-composite:xor;mask-composite:exclude}
.dsg-frost{position:absolute;left:0;top:0;z-index:1;display:none;pointer-events:none;
  border-radius:9px;
  background:linear-gradient(180deg,rgba(255,255,255,.17),rgba(255,255,255,.11));
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.10);
  -webkit-backdrop-filter:blur(9px) saturate(1.2) brightness(1.12);
  backdrop-filter:blur(9px) saturate(1.2) brightness(1.12)}
.dsg-root.dsg-frosting .dsg-frost{display:block}
/* 内容层抬到背景/磨砂之上 */
.dsg-root>*{z-index:2}
.dsg-root>.dsg-title,.dsg-root>.dsg-rows,.dsg-root>.dsg-settings,
.dsg-root>.dsg-mini,.dsg-root>.dsg-narrowbar{position:relative}
.dsg-root>.dsg-bg{z-index:0}
.dsg-root>.dsg-frost{z-index:1}
.dsg-root.dsg-collapsed{padding:8px 10px;cursor:pointer}
.dsg-title{display:flex;align-items:center;gap:7px;cursor:grab;padding-bottom:6px;
  border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:7px}
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
.dsg-gauge{text-align:center;position:relative}
.dsg-gauge svg{display:block;margin:0 auto;width:100%;max-width:320px;height:auto}
.dsg-arc-bg{fill:none;stroke:rgba(255,255,255,.12);stroke-width:${ARC_W}px;stroke-linecap:round}
.dsg-arc-std{fill:none;stroke:#22c55e;stroke-width:${ARC_W}px;stroke-linecap:round}
.dsg-arc-peak{fill:none;stroke:#f59e0b;stroke-width:${ARC_W}px;stroke-linecap:round}
.dsg-bal-track{fill:none;stroke:rgba(255,255,255,.04);stroke-width:5;stroke-linecap:round}
.dsg-bal-fill{fill:none;stroke:url(#dsg-bal-grad);stroke-width:5;stroke-linecap:round;opacity:.5;transition:stroke .3s,opacity .3s}
.dsg-root.dsg-alarm .dsg-bal-fill{stroke:#ef4444;opacity:.95}
.dsg-bal-mark{stroke:rgba(255,255,255,.7);stroke-width:1.5;stroke-linecap:round;opacity:.7}
.dsg-needle{transform-box:view-box;transform-origin:70px 70px;transform:rotate(-90deg);
  transition:transform .6s linear;filter:drop-shadow(1px 2px 3px rgba(0,0,0,.6))}
.dsg-needle .dsg-hand-bg{stroke:rgba(0,0,0,.45);stroke-width:5;stroke-linecap:round}
.dsg-needle .dsg-hand{stroke:var(--dsg-needle-color,#f9fafb);stroke-width:3;stroke-linecap:round}
.dsg-needle .dsg-tail-bg{stroke:rgba(0,0,0,.3);stroke-width:3.5;stroke-linecap:round}
.dsg-needle .dsg-tail{stroke:var(--dsg-needle-color,#f9fafb);stroke-width:1.6;stroke-linecap:round;stroke-opacity:.55}
.dsg-needle .dsg-cap-rim{fill:none;stroke:rgba(0,0,0,.5);stroke-width:1.2}
.dsg-needle .dsg-cap{fill:var(--dsg-needle-color,#f9fafb)}
.dsg-ticks line{stroke:rgba(255,255,255,.22);stroke-width:1;stroke-linecap:round}
.dsg-ticks line.maj{stroke:rgba(255,255,255,.6)}
.dsg-gauge-label{fill:#9ca3af;font-size:11px}
.dsg-meta{display:flex;justify-content:center;gap:30px;margin-top:3px}
.dsg-meta-col{display:flex;flex-direction:column;align-items:center;gap:1px;min-width:0}
.dsg-meta-label{color:#8b8f98;font-size:10px}
.dsg-status{font-size:12px;font-weight:600;white-space:nowrap}
.dsg-status.dsg-std{color:#4ade80}
.dsg-status.dsg-peak{color:#fbbf24}
.dsg-countdown{color:#d1d5db;font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.dsg-rows{border-top:1px solid rgba(255,255,255,.08);padding-top:6px;margin-top:5px}
.dsg-row{display:flex;justify-content:space-between;align-items:center;font-size:12px;
  color:#9ca3af;padding:3px 0}
.dsg-val{color:#f3f4f6;font-variant-numeric:tabular-nums;font-weight:600}
.dsg-settings{display:none;margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)}
.dsg-root.dsg-settings-open .dsg-settings{display:block}
.dsg-settings label{font-size:11px;color:#9ca3af;display:block;margin-bottom:4px}
.dsg-check{display:flex;align-items:center;gap:6px;margin-top:9px;cursor:pointer;
  font-size:11px;color:#9ca3af}
.dsg-check input{margin:0;accent-color:#60a5fa;cursor:pointer}
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
.dsg-mini-badge{margin-left:auto;flex:none}
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
/* ===== 表盘区「记录 / 归零」按钮（纯图标，悬停有 title 提示） ===== */
.dsg-actbtn{position:absolute;top:1px;z-index:4;width:18px;height:18px;display:flex;
  align-items:center;justify-content:center;font-size:11px;line-height:1;border-radius:5px;
  cursor:pointer;background:transparent;border:none;color:#9ca3af;padding:0;font-family:inherit}
.dsg-actbtn:hover{background:rgba(255,255,255,.12);color:#f3f4f6}
.dsg-actbtn.dsg-record{left:0}
.dsg-actbtn.dsg-zero{right:0;color:#fcd34d}
.dsg-actbtn.dsg-zero:hover{background:rgba(252,211,77,.16);color:#fde68a}
.dsg-actbtn.dsg-zero.confirming{width:auto;min-width:18px;padding:0 5px;font-size:10px;
  background:rgba(239,68,68,.22);color:#fecaca}
/* ===== 记录面板：可拖动、可覆盖指示器；打开/拖动/窗口变化时自动钳制在窗口内 ===== */
.dsg-records{display:none;position:fixed;left:0;top:0;z-index:2147483000;
  width:580px;max-width:min(580px,92vw);max-height:calc(100vh - 16px);overflow:auto;
  background:rgba(15,17,22,.99);
  border:1px solid rgba(255,255,255,.14);border-radius:12px;box-shadow:0 18px 44px rgba(0,0,0,.6);
  padding:10px 12px 12px;text-align:left;cursor:default}
.dsg-root.dsg-records-open .dsg-records{display:block}
.dsg-records-head{display:flex;align-items:center;gap:8px;padding-bottom:7px;margin-bottom:8px;
  border-bottom:1px solid rgba(255,255,255,.10);cursor:grab}
.dsg-records-head:active{cursor:grabbing}
.dsg-records-title{font-size:12px;color:#f3f4f6;font-weight:600;flex:1;min-width:0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsg-records-total{font-size:12px;color:#7dd3fc;font-weight:700;font-variant-numeric:tabular-nums}
.dsg-records-close{border:none;background:transparent;color:#9ca3af;cursor:pointer;font-size:13px;
  line-height:1;padding:2px 4px;border-radius:6px}
.dsg-records-close:hover{color:#e5e7eb;background:rgba(255,255,255,.1)}
.dsg-recbar{display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.dsg-seg{display:flex;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);
  border-radius:8px;padding:2px}
.dsg-seg button{border:none;background:transparent;color:#9ca3af;font-size:11px;cursor:pointer;
  padding:4px 9px;border-radius:6px;font-family:inherit;white-space:nowrap}
.dsg-seg button.active{background:rgba(96,165,250,.22);color:#dbeafe;font-weight:600}
.dsg-nav{display:flex;align-items:center;gap:4px}
.dsg-nav button{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);
  color:#cbd5e1;font-size:11px;line-height:1;padding:4px 7px;border-radius:7px;cursor:pointer;
  font-family:inherit}
.dsg-nav button:hover:not([disabled]){background:rgba(255,255,255,.14);color:#f3f4f6}
.dsg-nav button[disabled]{opacity:.35;cursor:not-allowed}
.dsg-range-label{font-size:11px;color:#e5e7eb;font-weight:600;font-variant-numeric:tabular-nums}
.dsg-panel-actions{margin-left:auto;display:flex;align-items:center;gap:6px}
.dsg-export,.dsg-open{display:flex;align-items:center;gap:5px;font-size:11px;cursor:pointer;
  padding:5px 9px;border-radius:8px;font-family:inherit;white-space:nowrap}
.dsg-export{border:1px solid rgba(34,197,94,.45);background:rgba(34,197,94,.14);color:#bbf7d0}
.dsg-export:hover{background:rgba(34,197,94,.24);color:#dcfce7}
.dsg-open{border:1px solid rgba(96,165,250,.45);background:rgba(96,165,250,.14);color:#bfdbfe}
.dsg-open:hover{background:rgba(96,165,250,.24);color:#dbeafe}
.dsg-export[disabled],.dsg-open[disabled]{opacity:.42;cursor:not-allowed;
  border-color:rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#8b8f98}
.dsg-chart{position:relative;margin:2px 0 8px;padding:14px 4px 0;background:rgba(255,255,255,.025);
  border:1px solid rgba(255,255,255,.06);border-radius:10px}
.dsg-chart-max{position:absolute;left:8px;top:3px;font-size:9px;color:#6b7280;
  font-variant-numeric:tabular-nums}
.dsg-bars{display:flex;align-items:flex-end;gap:2px;height:104px}
.dsg-bar{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:flex-end}
.dsg-bar-stack{display:flex;flex-direction:column;justify-content:flex-end;height:100%;
  border-radius:3px 3px 0 0;overflow:hidden;background:rgba(255,255,255,.03)}
.dsg-bar-seg{width:100%}
.dsg-bar-label{height:12px;line-height:12px;font-size:8px;color:#6b7280;text-align:center;
  margin-top:2px;overflow:hidden;white-space:nowrap}
.dsg-bar:hover .dsg-bar-stack{outline:1px solid rgba(255,255,255,.35)}
.dsg-legend{display:flex;align-items:center;gap:10px;margin-top:6px;padding:0 8px 7px;
  font-size:10px;color:#8b8f98;flex-wrap:wrap}
.dsg-legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;
  vertical-align:middle}
.dsg-tablewrap{max-height:186px;overflow:auto;border-top:1px solid rgba(255,255,255,.08);
  padding-top:4px}
.dsg-table{width:100%;border-collapse:collapse;font-size:11px;font-variant-numeric:tabular-nums}
.dsg-table th{position:sticky;top:0;background:rgba(15,17,22,.99);color:#6b7280;font-weight:500;
  text-align:right;padding:3px 4px;border-bottom:1px solid rgba(255,255,255,.08);white-space:nowrap}
.dsg-table th:first-child{text-align:left}
.dsg-table td{color:#cbd5e1;padding:4px;text-align:right;border-bottom:1px solid rgba(255,255,255,.04)}
.dsg-table td:first-child{text-align:left;color:#9ca3af}
.dsg-table tr.dsg-sum td{color:#f3f4f6;font-weight:600;border-bottom:none;
  border-top:1px solid rgba(255,255,255,.12);position:sticky;bottom:0;background:rgba(15,17,22,.99)}
.dsg-table .dsg-cell-std{color:#4ade80}
.dsg-table .dsg-cell-peak{color:#fbbf24}
.dsg-records-foot{margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,255,255,.08);
  font-size:10px;color:#6b7280;line-height:1.6}
.dsg-records-empty{padding:14px 4px;font-size:11px;color:#6b7280;text-align:center}
/* ===== 设置：Excel 默认保存位置 ===== */
.dsg-pathrow{display:flex;align-items:center;gap:5px;margin-top:0}
.dsg-path{flex:1;min-width:0;font-size:10px;line-height:1.4;color:#cbd5e1;
  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:7px;
  padding:5px 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsg-path.unset{color:#6b7280}
.dsg-mini-btn{flex:none;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);
  color:#cbd5e1;font-size:11px;line-height:1;padding:5px 7px;border-radius:7px;cursor:pointer;
  font-family:inherit}
.dsg-mini-btn:hover{background:rgba(255,255,255,.14);color:#f3f4f6}
/* ===== 面板提示条 ===== */
.dsg-toast{position:absolute;left:50%;bottom:8px;transform:translateX(-50%) translateY(6px);
  z-index:2147483000;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;
  background:rgba(34,197,94,.16);border:1px solid rgba(34,197,94,.5);color:#bbf7d0;
  font-size:11px;line-height:1.3;padding:5px 9px;border-radius:10px;max-width:88%;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsg-root.dsg-toast-show .dsg-toast{opacity:1;transform:translateX(-50%) translateY(0)}
/* ===== 视口过窄：竖版最小化（ResizeObserver + 迟滞触发） ===== */
.dsg-root.dsg-narrow{width:36px!important;padding:7px 5px;cursor:pointer;
  display:flex;flex-direction:column;align-items:center}
.dsg-root.dsg-narrow .dsg-title,
.dsg-root.dsg-narrow .dsg-gauge,
.dsg-root.dsg-narrow .dsg-rows,
.dsg-root.dsg-narrow .dsg-settings,
.dsg-root.dsg-narrow .dsg-resizer,
.dsg-root.dsg-narrow .dsg-mini{display:none!important}
.dsg-narrowbar{display:none;flex-direction:column;align-items:center;gap:7px;width:100%}
.dsg-root.dsg-narrow .dsg-narrowbar{display:flex}
.dsg-narrow-lamp{width:12px;height:12px;border-radius:50%;flex:none;background:#22c55e;
  box-shadow:0 0 7px 2px rgba(34,197,94,.55);transition:background .4s,box-shadow .4s}
.dsg-root.dsg-peak .dsg-narrow-lamp{background:#fbbf24;box-shadow:0 0 7px 2px rgba(250,204,21,.6)}
.dsg-root.dsg-alarm .dsg-narrow-lamp{background:#ef4444;animation:dsg-blink 1s ease-in-out infinite}
.dsg-root.dsg-working .dsg-narrow-lamp{animation:dsg-work 1s ease-in-out infinite}
.dsg-narrow-cost{color:#ffffff;font-size:11px;font-weight:700;font-variant-numeric:tabular-nums;
  writing-mode:vertical-rl;text-orientation:mixed;letter-spacing:.4px;max-height:96px;overflow:hidden}
.dsg-narrow-bal{color:#9ca3af;font-size:10px;font-variant-numeric:tabular-nums;
  writing-mode:vertical-rl;text-orientation:mixed;letter-spacing:.4px;max-height:96px;overflow:hidden}
.dsg-narrow-badge{font-size:9px!important;padding:.3em .4em!important;
  writing-mode:vertical-rl;text-orientation:mixed;letter-spacing:.2px!important;max-height:80px;overflow:hidden}
`

    // ===== 中英双语字典（键集合 zh / en 必须完全一致）=====
    const I18N = {
      zh: {
        // 标题栏 / 最小化条
        appTitle: '花费指示器',
        balanceLight: '余额预警灯',
        minimize: '最小化',
        gearTitle: '设置余额阈值',
        viewRecords: '查看本会话每日花费记录',
        resetCostHint: '会话花费归零，从此刻起重新累计',
        expandTip: '点击展开',
        resizeTip: '拖拽缩放',
        narrowTip: '窗口较窄：已切为竖版最小化，点击展开',
        // 表盘状态区
        currentRate: '当前费率',
        nextSwitch: '距离切换',
        statusStd: '标准（空闲）',
        statusPeak: '翻倍（高峰）',
        countdownHM: '距切换 {h}小时{m}分',
        countdownMS: '距切换 {m}分{s}秒',
        countdownS: '距切换 {s}秒',
        remainHM: '{h}小时{m}分',
        remainMS: '{m}分{s}秒',
        remainS: '{s}秒',
        // 展开态行
        sessionCost: '会话花费',
        balance: '余额',
        // 设置区
        thresholdLabel: '余额报警阈值（人民币）',
        excelFolderLabel: 'Excel 默认保存位置',
        pathUnset: '未设置 — 导出时弹窗选择',
        pickFolderTitle: '选择默认保存文件夹',
        select: '选择',
        clearPathTitle: '清除默认保存位置',
        frostLabel: '遮挡对话区时磨砂玻璃',
        frostHint: '开启后，浮窗压到中间对话区域的那部分会变成半透明磨砂玻璃',
        frostTip: '提示：可在设置里开启「遮挡对话区时磨砂玻璃」',
        // 余额灯 / 模型徽标提示
        balanceLowTitle: '余额 ¥{bal} 低于阈值 ¥{t}，报警中',
        balanceOkTitle: '余额 ¥{bal}（阈值 ¥{t}）',
        balanceQueryFailed: '查询失败',
        balanceUnknown: '余额未知',
        currentModel: '当前模型：{model}',
        noSessionModel: '暂无会话模型',
        // 记录面板
        sessionRecordsTitle: '本会话 · 花费记录',
        allRecordsTitle: '全部会话 · 花费记录',
        spendRecords: '花费记录',
        sessionFallback: '会话',
        sessionCountSuffix: '（{n} 个会话）',
        sessionCountShort: '（{n} 个）',
        lastResetSuffix: '（上次归零 {t}）',
        close: '关闭',
        rangeAll: '总时间',
        rangeYear: '年',
        rangeMonth: '月',
        rangeWeek: '周',
        rangeYearText: '{year} 年',
        monthLabel: '{m}月',
        wdMon: '周一',
        wdTue: '周二',
        wdWed: '周三',
        wdThu: '周四',
        wdFri: '周五',
        wdSat: '周六',
        wdSun: '周日',
        prevPeriod: '上一个时段',
        nextPeriod: '下一个时段',
        scopeSessionTitle: '只统计当前会话',
        scopeAllTitle: '合并统计所有会话',
        thisSession: '本会话',
        allSessions: '全部会话',
        byBand: '峰谷拆分',
        byModel: '模型拆分',
        exportTip: '导出 Excel（2 个工作表：按峰谷拆分 / 按模型拆分）',
        exportBtn: '⬇ 导出',
        openBtn: '📂 打开',
        openTip: '导出后可用：打开文件所在文件夹',
        totalWithValue: '合计 {v}',
        maxWithValue: '最大 {v}',
        period: '时段',
        offPeak: '空闲（标准）',
        peak: '高峰（翻倍）',
        total: '合计',
        noRecords: '暂无使用记录',
        panelNote: '按北京时间按日聚合（回放会话日志，含完整历史）；导出文件含 2 个工作表：<b>按峰谷拆分</b>、<b>按模型拆分</b>。',
        // 导出说明行
        exportNoteSession: '会话：',
        exportNoteBilling: '计费时间段：',
        exportNoteRange: '时间筛选：',
        exportNoteLastReset: '上次归零：',
        none: '无',
        exportNoteExportedAt: '导出时间：',
        unknownError: '未知错误',
        // 提示条（toast）
        toastExported: '已导出：{path}',
        toastExportCancelled: '已取消选择保存位置',
        toastExportFailed: '导出失败：{msg}',
        toastRevealed: '已在资源管理器中定位：{path}',
        toastOpenFailed: '打开失败：{msg}',
        toastDefaultSet: '已设为默认保存位置：{path}',
        toastPickCancelled: '已取消选择',
        toastSettingFailed: '设置失败：{msg}',
        toastCleared: '已清除默认保存位置',
        toastClearFailed: '清除失败',
        toastNoSession: '暂无会话可归零',
        toastResetDone: '已归零 · 会话花费重新累计',
        toastResetFailed: '归零失败：{msg}',
        confirm: '确认？',
        confirmResetTip: '再点一次确认归零',
      },
      en: {
        // Title bar / mini bar
        appTitle: 'Cost Gauge',
        balanceLight: 'Balance alert light',
        minimize: 'Minimize',
        gearTitle: 'Set balance threshold',
        viewRecords: "View this session's daily spend",
        resetCostHint: 'Reset session cost and start counting from now',
        expandTip: 'Click to expand',
        resizeTip: 'Drag to resize',
        narrowTip: 'Narrow window: compact mode, click to expand',
        // Gauge status area
        currentRate: 'Current rate',
        nextSwitch: 'Next switch',
        statusStd: 'Standard (off-peak)',
        statusPeak: 'Double (peak)',
        countdownHM: 'in {h}h {m}m',
        countdownMS: 'in {m}m {s}s',
        countdownS: 'in {s}s',
        remainHM: '{h}h {m}m',
        remainMS: '{m}m {s}s',
        remainS: '{s}s',
        // Expanded rows
        sessionCost: 'Session cost',
        balance: 'Balance',
        // Settings
        thresholdLabel: 'Balance alert threshold (CNY)',
        excelFolderLabel: 'Default Excel folder',
        pathUnset: 'Not set — pick a folder on export',
        pickFolderTitle: 'Choose the default save folder',
        select: 'Select',
        clearPathTitle: 'Clear the default save location',
        frostLabel: 'Frosted glass over the chat area',
        frostHint: 'When on, the part of the widget overlapping the middle chat area turns into translucent frosted glass',
        frostTip: 'Tip: turn on "Frosted glass over the chat area" in settings',
        // Balance lamp / model badge titles
        balanceLowTitle: 'Balance ¥{bal} is below the threshold ¥{t} — alerting',
        balanceOkTitle: 'Balance ¥{bal} (threshold ¥{t})',
        balanceQueryFailed: 'Query failed',
        balanceUnknown: 'Balance unknown',
        currentModel: 'Current model: {model}',
        noSessionModel: 'No session model',
        // Records panel
        sessionRecordsTitle: 'This session · Spend records',
        allRecordsTitle: 'All sessions · Spend records',
        spendRecords: 'Spend records',
        sessionFallback: 'Session',
        sessionCountSuffix: ' ({n} sessions)',
        sessionCountShort: ' ({n})',
        lastResetSuffix: ' (last reset {t})',
        close: 'Close',
        rangeAll: 'All time',
        rangeYear: 'Year',
        rangeMonth: 'Month',
        rangeWeek: 'Week',
        rangeYearText: 'Year {year}',
        monthLabel: '{m}',
        wdMon: 'Mon',
        wdTue: 'Tue',
        wdWed: 'Wed',
        wdThu: 'Thu',
        wdFri: 'Fri',
        wdSat: 'Sat',
        wdSun: 'Sun',
        prevPeriod: 'Previous period',
        nextPeriod: 'Next period',
        scopeSessionTitle: 'Count this session only',
        scopeAllTitle: 'Combine all sessions',
        thisSession: 'This session',
        allSessions: 'All sessions',
        byBand: 'By peak/off-peak',
        byModel: 'By model',
        exportTip: 'Export Excel (2 sheets: by peak/off-peak / by model)',
        exportBtn: '⬇ Export',
        openBtn: '📂 Open',
        openTip: 'Available after export: open the containing folder',
        totalWithValue: 'Total {v}',
        maxWithValue: 'Max {v}',
        period: 'Period',
        offPeak: 'Off-peak (standard)',
        peak: 'Peak (double)',
        total: 'Total',
        noRecords: 'No usage records',
        panelNote: 'Aggregated by day in Beijing time (replayed from the session log, full history); the exported file contains 2 sheets: <b>By peak/off-peak</b> and <b>By model</b>.',
        // Export note line
        exportNoteSession: 'Session: ',
        exportNoteBilling: 'Billing period: ',
        exportNoteRange: 'Range: ',
        exportNoteLastReset: 'Last reset: ',
        none: 'none',
        exportNoteExportedAt: 'Exported at: ',
        unknownError: 'unknown error',
        // Toasts
        toastExported: 'Exported: {path}',
        toastExportCancelled: 'Folder selection cancelled',
        toastExportFailed: 'Export failed: {msg}',
        toastRevealed: 'Revealed in Explorer: {path}',
        toastOpenFailed: 'Open failed: {msg}',
        toastDefaultSet: 'Default save location set: {path}',
        toastPickCancelled: 'Selection cancelled',
        toastSettingFailed: 'Failed to save setting: {msg}',
        toastCleared: 'Default save location cleared',
        toastClearFailed: 'Failed to clear',
        toastNoSession: 'No session to reset',
        toastResetDone: 'Session cost reset · counting from now',
        toastResetFailed: 'Reset failed: {msg}',
        confirm: 'Confirm?',
        confirmResetTip: 'Click again to confirm reset',
      },
    }

    /** 当前语言：挂载时由 detectLocale(ctx) 决定，挂载后固定（不做运行时热切换）。 */
    let locale = 'en'
    /** 当前语言字典。 */
    let L = I18N[locale]

    /** 取词：用 {name} 占位符替换；缺 key 时原样返回 key。 */
    function t(key, params) {
      const s = Object.prototype.hasOwnProperty.call(L, key) ? L[key] : key
      if (!params) return s
      let out = String(s)
      for (const k in params) {
        if (!Object.prototype.hasOwnProperty.call(params, k)) continue
        out = out.split('{' + k + '}').join(String(params[k]))
      }
      return out
    }

    /** 日期时间本地化标签（均为 24 小时制）。 */
    function localeTag() {
      return locale === 'zh' ? 'zh-CN' : 'en-US'
    }

    /** 语言检测：优先 DSH 客户端 locale 服务，取不到时用系统/浏览器语言。 */
    function detectLocale(ctx) {
      try {
        const loc = ctx.get && ctx.get('locale')
        const snap = loc && typeof loc.getSnapshot === 'function' ? loc.getSnapshot() : null
        const active = snap && snap.active
        if (typeof active === 'string' && active) return /^zh/i.test(active) ? 'zh' : 'en'
      } catch {}
      try {
        const nav = (navigator.languages && navigator.languages[0]) || navigator.language || 'en'
        return /^zh/i.test(String(nav)) ? 'zh' : 'en'
      } catch {}
      return 'en'
    }

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
      if (h > 0) return t('countdownHM', { h, m })
      if (m > 0) return t('countdownMS', { m, s: sec })
      return t('countdownS', { s: sec })
    }

    /** 纯剩余时长（无「距切换」前缀），用于状态区的值。 */
    function fmtRemain(s) {
      if (!Number.isFinite(s) || s < 0) return ''
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      const sec = Math.floor(s % 60)
      if (h > 0) return t('remainHM', { h, m })
      if (m > 0) return t('remainMS', { m, s: sec })
      return t('remainS', { s: sec })
    }

    /** 设置模型徽标：文本=模型缩写，配色按 pro=金 / vision=紫 / flash=蓝。 */
    function setModelBadge(el, modelRaw) {
      const raw = modelRaw ? String(modelRaw) : ''
      const lower = raw.toLowerCase()
      const cls = lower.includes('pro') ? 'dsg-badge-pro'
        : lower.includes('vision') ? 'dsg-badge-vision'
        : raw ? 'dsg-badge-flash' : ''
      el.className = 'dsg-badge' + (cls ? ' ' + cls : '')
      el.textContent = raw ? (raw.split('/').pop() || raw).replace(/^deepseek-/i, '') : '—'
      el.title = raw ? t('currentModel', { model: raw }) : t('noSessionModel')
    }

    /** 模型代表色：pro=金 / vision=紫 / flash(基础)=蓝；无模型时回退白。 */
    function modelColorOf(modelRaw) {
      const lower = String(modelRaw || '').toLowerCase()
      if (lower.includes('pro')) return '#fcd34d'
      if (lower.includes('vision')) return '#e879f9'
      if (modelRaw) return '#7dd3fc'
      return '#f9fafb'
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

    // ===== 双同心环几何：外圈=时间费率带，内圈=余额环 =====
    const RATE_R = 58 // 费率带中心半径（带宽 9 → 54.5–62.5，最外圈）
    const BAL_R = 47 // 余额环中心半径（带宽 10 → 42–52）
    const BAL_LO = 42.5 // 余额环内缘（阈值标记用）
    const BAL_HI = 51.5 // 余额环外缘（阈值标记用）
    // 圆头线帽半径占用的弧长换算成表盘角度：每段弧两端各内缩该角度后，
    // 圆头外缘正好止于时间边界（既保留圆头观感，又不侵入相邻时段）。
    const RATE_CAP_DEG = (ARC_W / 2) / RATE_R * 180 / Math.PI // ≈5.43° ≈ 21.6 分钟

    // 弧上一点坐标（p∈[0,180]，圆心 70,70，半径 r）。
    function arcXY(p, r) {
      const a = (180 - p) * Math.PI / 180
      return [70 + r * Math.cos(a), 70 - r * Math.sin(a)]
    }

    // 一段从 a° 到 b° 的弧路径（半径 r）。
    function arcD(a, b, r) {
      const [x1, y1] = arcXY(a, r)
      const [x2, y2] = arcXY(b, r)
      return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`
    }

    // 费率弧：把 a–b 两端各内缩 RATE_CAP_DEG 再画，圆头恰好抵在 a/b 边界上（只用于黄段）。
    function arcBand(a, b, r) {
      return arcD(a + RATE_CAP_DEG, b - RATE_CAP_DEG, r)
    }

    // 当日费率带（外圈）：周末全天全绿；工作日白天(6:00–18:00)按 绿(标准)+黄(高峰 9–12 / 14–18)；
    // 夜间(18:00–次日6:00)无高峰段 → 整弧绿色，避免夜里指针扫到“白天的黄段”。
    // 只对黄段(高峰)做圆头内缩，且只缩内部边界（9:00 / 12:00 / 14:00）：黄段在 SVG 里绘制于绿段之上，
    // 边界处的绿段圆头被黄段覆盖，可见边界由黄段精确决定；绿段与黄段在 18:00 的端头保持原样（圆头不缩）。
    function dialArcsFor(p) {
      const day = p.hour >= 6 && p.hour < 18
      if (p.weekday === 0 || p.weekday === 6 || !day) return { std: arcD(0, 180, RATE_R), peak: '' }
      return {
        std: arcD(0, 45, RATE_R) + arcD(90, 120, RATE_R),
        // 9:00–12:00：两端都是内部边界 → 都内缩；14:00–18:00：只缩 14:00 端，18:00 端头不缩。
        peak: arcBand(45, 90, RATE_R) + arcD(120 + RATE_CAP_DEG, 180, RATE_R),
      }
    }

    // 整点刻度线：折叠表盘的整数小时恰好落在 15° 一格；置于双环内侧（贴余额环内缘）。
    function ticksMarkup() {
      const R1 = 40.5
      const R2 = 36.5
      let out = ''
      for (let p = 0; p <= 180; p += 15) {
        const rad = Math.PI * (180 - p) / 180
        const x1 = (70 + R1 * Math.cos(rad)).toFixed(1)
        const y1 = (70 - R1 * Math.sin(rad)).toFixed(1)
        const x2 = (70 + R2 * Math.cos(rad)).toFixed(1)
        const y2 = (70 - R2 * Math.sin(rad)).toFixed(1)
        const cls = p % 45 === 0 ? ' class="maj"' : ''
        out += `<line${cls} x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line>`
      }
      return out
    }

    function apply(ctx) {
      // 语言在挂载时确定一次；挂载后固定，不做运行时热切换。
      locale = detectLocale(ctx)
      L = I18N[locale] || I18N.en
      ctx.effect(() => {
        injectCss()

        const root = document.createElement('div')
        root.className = 'dsg-root'
        root.innerHTML = `
<div class="dsg-bg"></div>
<div class="dsg-frost"></div>
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
      <span class="dsg-meta-label">${t('currentRate')}</span>
      <span class="dsg-status">—</span>
    </div>
    <div class="dsg-meta-col">
      <span class="dsg-meta-label">${t('nextSwitch')}</span>
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
  <div class="dsg-row"><span>${t('sessionCost')}</span><span class="dsg-val dsg-cost">—</span></div>
  <div class="dsg-row"><span>${t('balance')}</span><span class="dsg-val dsg-balance">—</span></div>
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
  <label class="dsg-check" title="${t('frostHint')}">
    <input class="dsg-frost-toggle" type="checkbox">
    <span>${t('frostLabel')}</span>
  </label>
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
        const statusEl = root.querySelector('.dsg-status')
        const costEl = root.querySelector('.dsg-cost')
        const balanceEl = root.querySelector('.dsg-balance')
        const countdownEl = root.querySelector('.dsg-countdown')
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
        const pickBtnEl = root.querySelector('.dsg-pick')
        const clearPathBtnEl = root.querySelector('.dsg-clearpath')
        const toastEl = root.querySelector('.dsg-toast')
        const frostEl = root.querySelector('.dsg-frost')
        const frostToggleEl = root.querySelector('.dsg-frost-toggle')
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
        let lastData = null

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
          clampIntoView()
        }

        function render(data) {
          const threshold = currentThreshold(data)

          // 费率指针 + 状态文案 + 颜色类。
          const peak = !!(data.rate && data.rate.peak)
          root.classList.toggle('dsg-peak', peak)
          statusEl.className = 'dsg-status ' + (peak ? 'dsg-peak' : 'dsg-std')
          statusEl.textContent = peak ? t('statusPeak') : t('statusStd')
          miniLamp.title = peak ? t('statusPeak') : t('statusStd')

          // 会话花费（展开 + 最小化）。
          const cost = data.cost
          const costText = cost && Number.isFinite(cost.cost) ? fmtMoney(cost.cost) : '—'
          costEl.textContent = costText
          miniCostEl.textContent = costText
          narrowCostEl.textContent = costText

          // 模型徽标（标题栏 + 最小化条 + 竖版条各一个）。
          const modelRaw = (cost && cost.model) ? String(cost.model) : ''
          setModelBadge(badgeEl, modelRaw)
          setModelBadge(miniBadgeEl, modelRaw)
          setModelBadge(narrowBadgeEl, modelRaw)
          narrowBadgeEl.classList.add('dsg-narrow-badge')
          // 指针颜色与当前模型代表色同步。
          root.style.setProperty('--dsg-needle-color', modelColorOf(modelRaw))

          // 余额 + 红灯。
          const bal = data.balance
          if (bal && bal.total !== undefined && Number.isFinite(bal.total)) {
            const balText = fmtMoney(bal.total)
            balanceEl.textContent = balText
            miniBalEl.textContent = balText
            narrowBalEl.textContent = balText
            const low = bal.total < threshold
            root.classList.toggle('dsg-alarm', low)
            root.classList.toggle('dsg-ok', !low)
            lightEl.title = low
              ? t('balanceLowTitle', { bal: bal.total.toFixed(2), t: threshold })
              : t('balanceOkTitle', { bal: bal.total.toFixed(2), t: threshold })
          } else {
            const errText = bal && bal.error ? t('balanceQueryFailed') : '—'
            balanceEl.textContent = errText
            miniBalEl.textContent = errText
            narrowBalEl.textContent = errText
            root.classList.remove('dsg-alarm', 'dsg-ok')
            lightEl.title = (bal && bal.error) ? bal.error : t('balanceUnknown')
          }

          thresholdEl.value = String(threshold)
          // 竖版条的灯沿用余额灯提示与状态
          narrowLampEl.title = lightEl.title
          // 余额环：剩余余额 + 报警阈值标记。
          updateBalance(
            bal && Number.isFinite(bal.total) ? bal.total : undefined,
            threshold,
          )
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
          scheduleFrost() // 浮窗位置/视口/布局变化时重算磨砂区域
          if (!lastData || !lastData.rate) return
          const rate = lastData.rate
          const rem = Math.max(0, Math.round((rate.nextSwitchAt - Date.now()) / 1000))
          countdownEl.textContent = fmtRemain(rem)
          const period = Number(rate.periodSeconds)
          const frac = Number.isFinite(period) && period > 0 ? Math.min(1, rem / period) : 0
          miniProg.style.strokeDashoffset = String(100 * (1 - frac))
          const peakNow = !!rate.peak
          miniWrap.title = (peakNow ? t('statusPeak') : t('statusStd')) + ' · ' + fmtCountdown(rem)
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
        let dragActive = false // 正在手动拖拽：期间不做自动让位
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
            scheduleFrost()
          })
          const end = (e) => {
            if (!dragging) return
            dragging = false
            dragActive = false
            if (moved) {
              saveJSON('pos', { x: root.offsetLeft, y: root.offsetTop })
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

        // ===== 侧边栏状态探测 =====
        // DSH 在自动收起侧栏时会切换 [data-dsh-frame][data-sidebar-collapsed]；再用实测宽度兜底。
        function getSidebarEl() {
          try {
            return document.querySelector('[class*="sidebarCol" i], aside[class*="sidebar" i]')
          } catch { return null }
        }
        function sidebarCollapsedNow() {
          try {
            const frame = document.querySelector('[data-dsh-frame]')
            if (frame && frame.hasAttribute('data-sidebar-collapsed')) return true
            const side = getSidebarEl()
            if (side) {
              const w = side.getBoundingClientRect().width
              if (w > 0 && w <= 96) return true
            }
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

        function applyNarrow() {
          root.classList.toggle('dsg-narrow', narrowMode)
          if (narrowMode) {
            if (!narrowPosSnapshot) narrowPosSnapshot = { left: root.style.left, top: root.style.top }
            root.style.setProperty('width', NARROW_W + 'px', 'important')
            if (!dockNarrowToSessions()) clampIntoView()
          } else {
            // 退出竖版：恢复用户自己的宽度（展开或手动最小化）与位置
            root.style.removeProperty('width')
            root.style.width = (root.classList.contains('dsg-collapsed') ? MINI_W : widthNow) + 'px'
            if (narrowPosSnapshot) {
              if (narrowPosSnapshot.left) root.style.left = narrowPosSnapshot.left
              if (narrowPosSnapshot.top) root.style.top = narrowPosSnapshot.top
              narrowPosSnapshot = null
            }
            clampIntoView()
          }
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
          const should = !narrowDismissed && (narrowMode ? shouldStay : shouldEnter)
          if (should !== narrowMode) {
            narrowMode = should
            applyNarrow()
          } else if (narrowMode) {
            // 已在竖版：视口/侧栏变化时重新停靠
            if (!dockNarrowToSessions()) clampIntoView()
          }
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
          applyNarrow()
        })

        // ===== 遮挡对话区时的「局部磨砂玻璃」 =====
        // 开关默认关闭；开启后只把浮窗与「中间对话区」相交的那一块做成半透明磨砂。
        let frostEnabled = loadJSON('frostEnabled') === true
        let frostRaf = 0
        /** 取「中间对话区」矩形：frame 中位于侧栏右侧、足够宽高的最宽子元素（回退 scrollBody）。 */
        let chatPanelEl = null // 最近识别到的对话面板元素：把 scrollBody / 输入卡的查找限定在中间列里
        function getChatAreaRect() {
          try {
            chatPanelEl = null
            const side = getSidebarEl()
            const sideRight = side ? side.getBoundingClientRect().right : 0
            const frame = document.querySelector('[data-dsh-frame]')
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
          if (!frostEnabled) {
            root.classList.remove('dsg-frosting')
            maybeFrostTip()
            return
          }
          const chat = getChatContentRect()
          if (!chat) {
            root.classList.remove('dsg-frosting')
            return
          }
          const rr = root.getBoundingClientRect()
          const x1 = Math.max(rr.left, chat.left)
          const y1 = Math.max(rr.top, chat.top)
          const x2 = Math.min(rr.right, chat.right)
          const y2 = Math.min(rr.bottom, chat.bottom)
          const iw = x2 - x1
          const ih = y2 - y1
          if (iw < 3 || ih < 3) {
            root.classList.remove('dsg-frosting')
            return
          }
          const pad = 1
          const hx = Math.max(0, x1 - rr.left + pad)
          const hy = Math.max(0, y1 - rr.top + pad)
          const hw = Math.max(0, iw - pad * 2)
          const hh = Math.max(0, ih - pad * 2)
          root.style.setProperty('--dsg-hole-x', hx.toFixed(1) + 'px')
          root.style.setProperty('--dsg-hole-y', hy.toFixed(1) + 'px')
          root.style.setProperty('--dsg-hole-w', hw.toFixed(1) + 'px')
          root.style.setProperty('--dsg-hole-h', hh.toFixed(1) + 'px')
          frostEl.style.left = hx.toFixed(1) + 'px'
          frostEl.style.top = hy.toFixed(1) + 'px'
          frostEl.style.width = hw.toFixed(1) + 'px'
          frostEl.style.height = hh.toFixed(1) + 'px'
          root.classList.add('dsg-frosting')
        }
        function scheduleFrost() {
          if (frostRaf) return
          frostRaf = requestAnimationFrame(() => { frostRaf = 0; updateFrost() })
        }
        if (frostToggleEl) {
          frostToggleEl.checked = frostEnabled
          frostToggleEl.addEventListener('change', () => {
            frostEnabled = !!frostToggleEl.checked
            saveJSON('frostEnabled', frostEnabled)
            updateFrost()
          })
        }
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
        function currentSessionId() {
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
            const res = await fetch('/api/cost-gauge/prefs')
            if (!res.ok) return
            const data = await res.json()
            setPathDisplay(data.excelDir || '')
            panel.lastExport = data.lastExport || ''
            openBtnEl.disabled = !panel.lastExport
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
