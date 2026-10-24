window.__ModuleLoader__.load({
  id: 'dsh-cost-gauge',
  chunk: 'client.core.js',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    /* ---------- 常量 ---------- */
    const LS_PREFIX = 'dsh-cost-gauge'
    const DEFAULT_THRESHOLD = 10
    const POLL_MS = 5000
    const TICK_MS = 1000
    const DEFAULT_W = 216
    const MIN_W = 180
    const MAX_W = 340
    const MINI_W = 210
    const ARC_W = 11 // 费率弧线宽（CSS 与几何共用；圆头半径 = ARC_W/2）

    /* ---------- CSS ---------- */
    const CSS = `
.dsg-root{position:fixed;z-index:2147483000;width:${DEFAULT_W}px;box-sizing:border-box;
  container-type:inline-size;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  background:transparent;color:#e5e7eb;border:1px solid rgba(255,255,255,.10);
  border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.38);padding:7px 10px 9px;
  /* DSH 桌面端（Electron）把窗口顶部一条做成窗口拖动热区：
     [data-windows-titlebar] .frame:before{inset:0 0 auto;-webkit-app-region:drag}
     浮窗若落进那一带，鼠标事件会被系统当成「拖窗口」吞掉 —— 点不亮、拖不动，还会把主窗口拖走。
     显式声明 no-drag，把自己的矩形从热区里挖掉。
     依据：DSH 自己也这么处理左上角那个 position:fixed 的侧栏开关
     （[data-windows-titlebar] .sidebar .toggle{...-webkit-app-region:no-drag}）——
     说明「fixed 元素压在热区上必须自己声明 no-drag」正是上游的既定做法。 */
  -webkit-app-region:no-drag;app-region:no-drag;
  user-select:none;-webkit-user-select:none}
/* ===== 背景层 + 磨砂层（遮挡对话区时只把「压进去的那块」做成磨砂玻璃） ===== */
.dsg-bg{position:absolute;inset:0;z-index:0;border-radius:14px;background:rgba(20,22,28,.94);
  /* 玻璃化（两层 add 叠加）：
     ① 横向：只在「与对话区重叠的那几列」里降低背景不透明度（两端 --dsg-feather 渐变过渡）；
     ② 纵向（.dsg-bar 层）：中间带（标题栏底 → 「会话花费/余额」行顶）全透明，标题栏与底部行按 --dsg-bar-a 叠实色；
     不在对话区上方时两层都是 1，背景保持完全不透明。 */
  -webkit-mask-image:linear-gradient(90deg,#000 0,#000 calc(var(--dsg-hole-x,0px) - var(--dsg-feather,8px)),rgba(0,0,0,0) calc(var(--dsg-hole-x,0px) + var(--dsg-feather,8px)),rgba(0,0,0,0) calc(var(--dsg-hole-x,0px) + var(--dsg-hole-w,0px) - var(--dsg-feather,8px)),#000 calc(var(--dsg-hole-x,0px) + var(--dsg-hole-w,0px) + var(--dsg-feather,8px)),#000 100%);
  mask-image:linear-gradient(90deg,#000 0,#000 calc(var(--dsg-hole-x,0px) - var(--dsg-feather,8px)),rgba(0,0,0,0) calc(var(--dsg-hole-x,0px) + var(--dsg-feather,8px)),rgba(0,0,0,0) calc(var(--dsg-hole-x,0px) + var(--dsg-hole-w,0px) - var(--dsg-feather,8px)),#000 calc(var(--dsg-hole-x,0px) + var(--dsg-hole-w,0px) + var(--dsg-feather,8px)),#000 100%);
  -webkit-mask-composite:source-over;mask-composite:add}
.dsg-frost{position:absolute;inset:0;z-index:1;display:none;pointer-events:none;border-radius:14px;
  background:linear-gradient(180deg,rgba(255,255,255,var(--dsg-tint,.16)),rgba(255,255,255,calc(var(--dsg-tint,.16) * .62)));
  box-shadow:inset 0 0 0 1px rgba(255,255,255,calc(var(--dsg-tint,.16) * .6));
  -webkit-backdrop-filter:blur(var(--dsg-blur,9px)) saturate(1.2) brightness(1.12);
  backdrop-filter:blur(var(--dsg-blur,9px)) saturate(1.2) brightness(1.12);
  -webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) calc(var(--dsg-hole-x,0px) - var(--dsg-feather,8px)),#000 calc(var(--dsg-hole-x,0px) + var(--dsg-feather,8px)),#000 calc(var(--dsg-hole-x,0px) + var(--dsg-hole-w,0px) - var(--dsg-feather,8px)),rgba(0,0,0,0) calc(var(--dsg-hole-x,0px) + var(--dsg-hole-w,0px) + var(--dsg-feather,8px)),rgba(0,0,0,0) 100%),linear-gradient(180deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) calc(var(--dsg-hole-y,0px) - var(--dsg-feather,8px)),#000 calc(var(--dsg-hole-y,0px) + var(--dsg-feather,8px)),#000 calc(var(--dsg-hole-y,0px) + var(--dsg-hole-h,0px) - var(--dsg-feather,8px)),rgba(0,0,0,0) calc(var(--dsg-hole-y,0px) + var(--dsg-hole-h,0px) + var(--dsg-feather,8px)),rgba(0,0,0,0) 100%);
  mask-image:linear-gradient(90deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) calc(var(--dsg-hole-x,0px) - var(--dsg-feather,8px)),#000 calc(var(--dsg-hole-x,0px) + var(--dsg-feather,8px)),#000 calc(var(--dsg-hole-x,0px) + var(--dsg-hole-w,0px) - var(--dsg-feather,8px)),rgba(0,0,0,0) calc(var(--dsg-hole-x,0px) + var(--dsg-hole-w,0px) + var(--dsg-feather,8px)),rgba(0,0,0,0) 100%),linear-gradient(180deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) calc(var(--dsg-hole-y,0px) - var(--dsg-feather,8px)),#000 calc(var(--dsg-hole-y,0px) + var(--dsg-feather,8px)),#000 calc(var(--dsg-hole-y,0px) + var(--dsg-hole-h,0px) - var(--dsg-feather,8px)),rgba(0,0,0,0) calc(var(--dsg-hole-y,0px) + var(--dsg-hole-h,0px) + var(--dsg-feather,8px)),rgba(0,0,0,0) 100%);
  -webkit-mask-composite:source-in;mask-composite:intersect}
.dsg-root.dsg-frosting .dsg-frost{display:block}
/* 标题栏 / 底部行的背景层：玻璃化时才出现，用 --dsg-bar-a 控制不透明度（1 = 完全不透明）。
   压在磨砂层之上，所以这两条带背后是「模糊后的背景」再叠一层实色。
   注意：这一层的类名与图表的柱子同名（都叫 .dsg-bar）。这里必须限定成 .dsg-root 的直接子元素，
   否则柱子的定位/背景会被这层覆盖 —— 30 根柱子各自绝对定位铺满图表区，最后一根的不透明底把整张图盖成空的。 */
.dsg-root>.dsg-bar{position:absolute;inset:0;z-index:1;display:none;pointer-events:none;border-radius:14px;
  background:rgba(20,22,28,1);
  -webkit-mask-image:linear-gradient(90deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) calc(var(--dsg-hole-x,0px) - var(--dsg-feather,8px)),#000 calc(var(--dsg-hole-x,0px) + var(--dsg-feather,8px)),#000 calc(var(--dsg-hole-x,0px) + var(--dsg-hole-w,0px) - var(--dsg-feather,8px)),rgba(0,0,0,0) calc(var(--dsg-hole-x,0px) + var(--dsg-hole-w,0px) + var(--dsg-feather,8px)),rgba(0,0,0,0) 100%),linear-gradient(180deg,rgba(0,0,0,var(--dsg-bar-a,1)) 0,rgba(0,0,0,var(--dsg-bar-a,1)) calc(var(--dsg-band-y,0px) - var(--dsg-band-feather,6px)),rgba(0,0,0,0) calc(var(--dsg-band-y,0px) + var(--dsg-band-feather,6px)),rgba(0,0,0,0) calc(var(--dsg-band-y,0px) + var(--dsg-band-h,0px) - var(--dsg-band-feather,6px)),rgba(0,0,0,var(--dsg-bar-a,1)) calc(var(--dsg-band-y,0px) + var(--dsg-band-h,0px) + var(--dsg-band-feather,6px)),rgba(0,0,0,var(--dsg-bar-a,1)) 100%);
  mask-image:linear-gradient(90deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) calc(var(--dsg-hole-x,0px) - var(--dsg-feather,8px)),#000 calc(var(--dsg-hole-x,0px) + var(--dsg-feather,8px)),#000 calc(var(--dsg-hole-x,0px) + var(--dsg-hole-w,0px) - var(--dsg-feather,8px)),rgba(0,0,0,0) calc(var(--dsg-hole-x,0px) + var(--dsg-hole-w,0px) + var(--dsg-feather,8px)),rgba(0,0,0,0) 100%),linear-gradient(180deg,rgba(0,0,0,var(--dsg-bar-a,1)) 0,rgba(0,0,0,var(--dsg-bar-a,1)) calc(var(--dsg-band-y,0px) - var(--dsg-band-feather,6px)),rgba(0,0,0,0) calc(var(--dsg-band-y,0px) + var(--dsg-band-feather,6px)),rgba(0,0,0,0) calc(var(--dsg-band-y,0px) + var(--dsg-band-h,0px) - var(--dsg-band-feather,6px)),rgba(0,0,0,var(--dsg-bar-a,1)) calc(var(--dsg-band-y,0px) + var(--dsg-band-h,0px) + var(--dsg-band-feather,6px)),rgba(0,0,0,var(--dsg-bar-a,1)) 100%);
  -webkit-mask-composite:source-in;mask-composite:intersect}
.dsg-root.dsg-frosting>.dsg-bar{display:block}
/* 中间带：仪表盘与文字只保留明度（去色相/饱和度），且每个颜色的不透明度 = 它的明度
   （模板里的 #dsg-luma-* 滤镜把明度写进 alpha 通道） */
.dsg-root.dsg-frosting .dsg-gauge{filter:var(--dsg-luma,none)}
/* 标题栏与底部「会话花费 / 余额」：稍微透明 */
.dsg-root.dsg-frosting .dsg-title{filter:var(--dsg-a-title,none)}
.dsg-root.dsg-frosting .dsg-rows{filter:var(--dsg-a-rows,none)}
.dsg-root.dsg-frosting .dsg-settings{filter:var(--dsg-a-settings,none)}
/* 内容层抬到背景/磨砂之上 */
.dsg-root>*{z-index:2}
.dsg-root>.dsg-title,.dsg-root>.dsg-rows,.dsg-root>.dsg-settings,
.dsg-root>.dsg-mini,.dsg-root>.dsg-narrowbar{position:relative}
.dsg-root>.dsg-bg{z-index:0}
.dsg-root>.dsg-frost{z-index:1}
.dsg-root>.dsg-bar{z-index:1}
/* 最小化态的宽度由内容决定（贴住内容，右侧不留空——原先固定 MINI_W=210，模型名短时
   右边会空一大块）。注意必须同时把 container-type 关掉：inline-size 容器自带
   inline-size 收缩，会让 width:auto 直接算成 0。代价是最小化态量不了 cqw，
   故徽标字号在下面写成定值。 */
.dsg-root.dsg-collapsed{container-type:normal;width:auto!important;padding:3px 7px 4px;cursor:pointer}
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
/* 设置面板底部：版本号（小字、次要色） */
.dsg-version{margin-top:9px;padding-top:7px;border-top:1px solid rgba(255,255,255,.08);
  font-size:10px;line-height:1.3;color:#6b7280;text-align:center;letter-spacing:.2px;
  font-variant-numeric:tabular-nums;user-select:text;-webkit-user-select:text;cursor:text}
/* 节假日数据未覆盖当前年份：把提示染成告警色，避免误以为费率判断仍然准确 */
.dsg-version-warn{color:#d97706}
.dsg-check{display:flex;align-items:center;gap:6px;margin-top:9px;cursor:pointer;
  font-size:11px;color:#9ca3af}
.dsg-check input{margin:0;accent-color:#60a5fa;cursor:pointer}
.dsg-frow{display:flex;align-items:center;gap:7px;margin-top:7px;font-size:11px;color:#9ca3af}
.dsg-frow span{flex:none;min-width:48px}
.dsg-frow input[type=range]{flex:1;min-width:0;height:14px;accent-color:#60a5fa;background:transparent;cursor:pointer}
.dsg-frow b{flex:none;min-width:36px;text-align:right;color:#e5e7eb;font-weight:600;font-variant-numeric:tabular-nums}
.dsg-frow select{flex:1;min-width:0;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);
  border-radius:7px;color:#f3f4f6;font-size:11px;padding:3px 6px;cursor:pointer}
.dsg-frow select:focus{outline:none;border-color:rgba(96,165,250,.6)}
.dsg-frostopts{margin-left:20px}
.dsg-frostopts.off{opacity:.4}
.dsg-threshold{width:100%;box-sizing:border-box;background:rgba(255,255,255,.08);
  border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#f3f4f6;font-size:13px;padding:6px 8px}
.dsg-threshold:focus{outline:none;border-color:rgba(96,165,250,.6)}

/* ===== 最小化态 ===== */
.dsg-root.dsg-collapsed .dsg-title,
.dsg-root.dsg-collapsed .dsg-gauge,
.dsg-root.dsg-collapsed .dsg-rows,
.dsg-root.dsg-collapsed .dsg-settings,
.dsg-root.dsg-collapsed .dsg-resizer{display:none}
.dsg-mini{display:none;align-items:center;gap:6px;min-height:20px;cursor:pointer}
.dsg-root.dsg-collapsed .dsg-mini{display:flex}
.dsg-mini-lampwrap{position:relative;width:20px;height:20px;flex:none}
.dsg-mini-lampwrap svg{position:absolute;inset:0;width:20px;height:20px;transform:rotate(-90deg)}
.dsg-mini-track{fill:none;stroke:rgba(255,255,255,.14);stroke-width:5;stroke-linecap:round}
.dsg-mini-prog{fill:none;stroke:#22c55e;stroke-width:5;stroke-linecap:round;
  transition:stroke .4s}
.dsg-root.dsg-peak .dsg-mini-prog{stroke:#fbbf24}
.dsg-mini-lamp{position:absolute;left:50%;top:50%;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;
  border-radius:50%;background:#22c55e;box-shadow:0 0 6px 2px rgba(34,197,94,.55);
  transition:background .4s,box-shadow .4s}
.dsg-root.dsg-peak .dsg-mini-lamp{background:#fbbf24;box-shadow:0 0 7px 2px rgba(250,204,21,.6)}
/* minimax 模式：圆环与中心灯改用 5 小时窗口语义（橙红=可用 / 灰=已用尽）。
   放在 .dsg-peak 之后，同优先级下覆盖费率配色。 */
.dsg-root.dsg-mmx .dsg-mini-prog{stroke:#e0432d}
.dsg-root.dsg-mmx .dsg-mini-lamp{background:#e0432d;box-shadow:0 0 7px 2px rgba(224,67,45,.55)}
.dsg-root.dsg-mmx.dsg-mmx-out .dsg-mini-prog{stroke:#6b7280}
.dsg-root.dsg-mmx.dsg-mmx-out .dsg-mini-lamp{background:#6b7280;box-shadow:0 0 6px 1px rgba(107,114,128,.5)}
/* 冷却期「剩余额度 0%」不该沿用费率的绿/黄，改成与弧、圆环同族的灰 */
.dsg-root.dsg-mmx.dsg-mmx-out .dsg-status{color:#9ca3af}
.dsg-mini-text{display:flex;flex-direction:column;gap:0;min-width:0}
.dsg-mini-cost{color:#ffffff;font-size:12px;line-height:1.15;font-weight:700;
  font-variant-numeric:tabular-nums;white-space:nowrap}
.dsg-mini-bal{color:#9ca3af;font-size:10px;line-height:1.15;font-variant-numeric:tabular-nums;
  white-space:nowrap}
/* 最小化态没有 inline-size 容器可量，字号只能定值；限宽 + 省略号（.dsg-badge 已有
   overflow/text-overflow），长模型名不会把胶囊重新撑开。 */
.dsg-mini-badge{flex:none;font-size:9px;max-width:44px}
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
  /* 同 .dsg-root：记录面板是 fixed 定位、矩形可能超出浮窗本体，桌面端的窗口拖动热区
     同样会吞掉它的鼠标事件（它自己也是可拖动的），故一并声明。 */
  -webkit-app-region:no-drag;app-region:no-drag;
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
/* ===== MiniMax 订阅 Key（设置面板内） ===== */
.dsg-keyrow{display:flex;align-items:center;gap:5px;margin-top:0}
.dsg-mmx-key{flex:1;min-width:0;font-size:11px;line-height:1.4;color:#e5e7eb;
  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.10);border-radius:7px;
  padding:5px 7px;font-family:inherit;box-sizing:border-box}
.dsg-mmx-key:focus{outline:none;border-color:rgba(96,165,250,.55)}
.dsg-mmx-key::placeholder{color:#6b7280}
.dsg-mmx-keystate{margin-top:3px;font-size:9px;line-height:1.35;color:#8b8f98}
.dsg-mmx-keystate.ok{color:#4ade80}
.dsg-mmx-keystate.err{color:#fca5a5}
/* ===== 后台沙漏：切到别的模型时提醒订阅窗口的重置倒计时 =====
   挂在浮窗右上角外侧，28px 圆；最小化 / 竖条态不显示（太小会挤）。 */
.dsg-hourglass{position:absolute;right:-26px;top:0;width:28px;height:28px;
  border-radius:50%;background:#0b0f14;border:1px solid rgba(255,255,255,.16);
  display:flex;align-items:center;justify-content:center;
  box-shadow:0 3px 10px rgba(0,0,0,.5);z-index:6;cursor:default;
  transition:top .18s ease,bottom .18s ease,right .18s ease}
.dsg-hourglass[hidden]{display:none}
/* 最小化：胶囊只有 34px 高，挂右侧边缘并垂直居中 */
.dsg-root.dsg-collapsed .dsg-hourglass{top:50%;transform:translateY(-50%)}
/* 浮窗贴住屏幕左/右边缘时，右侧没有落脚处 → 改挂下方 */
.dsg-root.dsg-hg-bottom .dsg-hourglass{top:auto;bottom:-26px;right:12px;transform:none}
/* 竖条形态：挂底部居中 */
.dsg-root.dsg-narrow .dsg-hourglass{top:auto;bottom:-26px;right:50%;transform:translateX(50%)}
.dsg-hourglass svg{display:block}
/* 沙子用 MiniMax 橙，和浮窗里那条额度弧同色；轮廓用近白压住它 */
.dsg-hg-frame{fill:none;stroke:rgba(255,255,255,.92);stroke-width:1;stroke-linejoin:round}
/* 沙 = MiniMax 橙；流沙柱用近白，否则它落在同色沙堆上根本看不出来在动 */
.dsg-hg-top,.dsg-hg-bot{fill:#e0432d}
.dsg-hg-fall{fill:rgba(255,255,255,.9);animation:dsg-hg-drop 1.15s linear infinite}
/* 额度用尽 / 冷却中：整体转灰，表示"只剩等待" */
.dsg-root.dsg-hg-cooling .dsg-hg-top,
.dsg-root.dsg-hg-cooling .dsg-hg-bot{fill:rgba(255,255,255,.26)}
.dsg-root.dsg-hg-cooling .dsg-hg-fall{fill:rgba(255,255,255,.62)}
.dsg-root.dsg-hg-cooling .dsg-hg-frame{stroke:rgba(255,255,255,.55)}
@keyframes dsg-hg-drop{
  0%{transform:translateY(-1px) scaleY(.55);opacity:.2}
  18%{opacity:1}
  82%{opacity:1}
  100%{transform:translateY(4px) scaleY(1.15);opacity:0}
}
/* 窗口重置：沙漏整个翻半圈再回正（动画结束自动复位，不持久） */
.dsg-hourglass.dsg-hg-reset svg{animation:dsg-hg-flip .85s cubic-bezier(.4,0,.2,1)}
@keyframes dsg-hg-flip{
  0%{transform:rotate(0deg)}
  60%{transform:rotate(180deg)}
  100%{transform:rotate(180deg)}
}
@media (prefers-reduced-motion: reduce){
  .dsg-hg-fall{animation:none;opacity:.9}
  .dsg-hourglass.dsg-hg-reset svg{animation:none}
}
`

    // ===== 中英双语字典（键集合 zh / en 必须完全一致）=====

    /* ---------- i18n ---------- */
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
        // 法定节假日 / 调休补班：peak 为 false 时说明为什么是标准价
        statusHoliday: '标准（{name}）',
        statusMakeup: '标准（调休上班）',
        holidayStale: '节假日数据未收录 {year} 年，费率仅按星期判断',
        holidaySource: '节假日数据：{years} 年（国务院办公厅通知）',
        countdownHM: '距切换 {h}小时{m}分',
        countdownMS: '距切换 {m}分{s}秒',
        countdownS: '距切换 {s}秒',
        remainHM: '{h}小时{m}分',
        remainMS: '{m}分{s}秒',
        remainS: '{s}秒',
        // MiniMax 订阅额度（5 小时窗口 / 周窗口）
        minimaxKeyLabel: 'MiniMax 订阅 Key',
        minimaxKeyHint: '在 MiniMax 开放平台 → M Plan 获取订阅 Key（sk-cp- 开头）。只保存在本机账本，不会回传到页面。',
        minimaxKeySave: '保存',
        minimaxKeyClearTitle: '清除已保存的 Key',
        minimaxKeyNotSet: '未配置',
        minimaxKeyIsSet: '已配置',
        minimaxKeySaved: 'Key 已保存',
        minimaxKeyCleared: 'Key 已清除',
        minimaxKeySaveFailed: '保存失败：{msg}',
        // 表盘下方：minimax 模式下这两个标签改为额度语义
        quotaLeftLabel: '剩余额度',
        quotaTimeLeftLabel: '剩余时间',
        // 三行在 minimax 模式下换成额度口径
        quotaRowPrimary: '5 小时额度',
        quotaRowReset: '5 小时重置',
        quotaRowSecondary: '周额度',
        // 后台沙漏：悬停提示
        hourglassTitle: 'MiniMax 订阅 · {time} 后重置窗口',
        // 展开态行
        turnCost: '本回合花费',
        sessionCost: '会话花费',
        balance: '余额',
        // 设置区
        thresholdLabel: '余额报警阈值（人民币）',
        excelFolderLabel: 'Excel 默认保存位置',
        pathUnset: '未设置 — 导出时弹窗选择',
        pickFolderTitle: '选择默认保存文件夹',
        select: '选择',
        clearPathTitle: '清除默认保存位置',
        snapLabel: '拖到窗口边缘自动吸附成竖条',
        snapHint: '拖到窗口左/右边缘时会贴边并变成竖条；上/下边缘只贴边、不变形。从边缘拖开即解除停靠，点竖条可展开并回到原位置',
        compactCostLabel: '最小化与竖条显示本回合花费',
        compactCostHint: '勾选：最小化胶囊与贴边竖条都显示「本回合花费」（不足 1 分显示 <0.01）；不勾选：都显示「会话花费」（默认）',
        dockedTip: '已贴边停靠：点击展开并回到原位置；拖离边缘可解除',
        frostLabel: '遮挡对话区时磨砂玻璃',
        frostHint: '开启后，压到对话区的部分变成灰色玻璃：标题栏/底部行半透明，中间背景全透明、仪表盘只保留明度（透明度随明度变化）',
        frostTip: '提示：可在设置里开启「遮挡对话区时磨砂玻璃」',
        frostBlurLabel: '磨砂强度',
        frostBlurHint: '模糊半径：越大越糊（0 = 只保留白雾通透感）',
        frostTransLabel: '透明强度',
        edgeLabel: '边缘过渡',
        edgeHint: '正常区域与玻璃区域之间的过渡宽度（px，0 = 硬边）',
        bandTransLabel: '标题/底部透明',
        bandTransHint: '标题栏与底部「会话花费/余额」的透明度（稍微透明）',
        lumaAlgoLabel: '明度算法',
        lumaAlgoHint: '中间仪表盘/文字用哪种「明度」来定灰度与透明度',
        luma709: 'Rec.709 相对亮度',
        lumaHsl: 'HSL 明度',
        lumaHsv: 'HSV 明度',
        lumaGainLabel: '内容不透明度',
        lumaGainHint: '在所选明度算法之上再乘一个系数：100% = 严格按明度（不透明度 = 明度），调小则整体更透，0% 完全看不见',
        frostTransHint: '越大越透明（白雾越淡，越能看清底下的内容）',
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
        statusHoliday: 'Standard ({name})',
        statusMakeup: 'Standard (make-up workday)',
        holidayStale: 'No holiday data for {year}; rate falls back to weekday only',
        holidaySource: 'Holiday data: {years} (State Council notices)',
        countdownHM: 'in {h}h {m}m',
        countdownMS: 'in {m}m {s}s',
        countdownS: 'in {s}s',
        remainHM: '{h}h {m}m',
        remainMS: '{m}m {s}s',
        remainS: '{s}s',
        // MiniMax subscription quota (5-hour window / weekly window)
        minimaxKeyLabel: 'MiniMax subscription key',
        minimaxKeyHint: 'Get the subscription key from MiniMax Console → M Plan (starts with sk-cp-). Stored only in the local ledger; never sent back to the page.',
        minimaxKeySave: 'Save',
        minimaxKeyClearTitle: 'Clear the saved key',
        minimaxKeyNotSet: 'not set',
        minimaxKeyIsSet: 'configured',
        minimaxKeySaved: 'Key saved',
        minimaxKeyCleared: 'Key cleared',
        minimaxKeySaveFailed: 'Save failed: {msg}',
        // Below the dial: these two labels switch to quota wording in MiniMax mode
        quotaLeftLabel: 'Quota left',
        quotaTimeLeftLabel: 'Time left',
        // The three rows switch to quota wording in MiniMax mode
        quotaRowPrimary: '5-hour quota',
        quotaRowReset: '5-hour reset',
        quotaRowSecondary: 'Weekly quota',
        // Background hourglass tooltip
        hourglassTitle: 'MiniMax plan · window resets in {time}',
        // Expanded rows
        turnCost: 'Turn cost',
        sessionCost: 'Session cost',
        balance: 'Balance',
        // Settings
        thresholdLabel: 'Balance alert threshold (CNY)',
        excelFolderLabel: 'Default Excel folder',
        pathUnset: 'Not set — pick a folder on export',
        pickFolderTitle: 'Choose the default save folder',
        select: 'Select',
        clearPathTitle: 'Clear the default save location',
        snapLabel: 'Snap to the window edge as a vertical strip',
        snapHint: 'Dragging onto the left/right window edge clings there and turns the widget into a vertical strip; the top/bottom edges only cling, without changing shape. Drag away from the edge to release, or click the strip to expand back where it was',
        compactCostLabel: 'Show turn cost in the minimized capsule and strip',
        compactCostHint: 'Checked: the minimized capsule and the docked strip both show the turn cost (under one cent shows <0.01). Unchecked: both show the session cost (default)',
        dockedTip: 'Docked to the window edge: click to expand back where it was, or drag away from the edge to release',
        frostLabel: 'Frosted glass over the chat area',
        frostHint: 'When on, the part over the chat turns into grey glass: title bar / bottom rows go semi-transparent, the middle background goes fully transparent and the dial keeps only its lightness (opacity follows lightness)',
        frostTip: 'Tip: turn on "Frosted glass over the chat area" in settings',
        frostBlurLabel: 'Frost',
        frostBlurHint: 'Blur radius: higher = hazier (0 keeps only the translucent tint)',
        frostTransLabel: 'Transparency',
        edgeLabel: 'Edge fade',
        edgeHint: 'Width of the transition between the normal and the glass area (px, 0 = hard edge)',
        bandTransLabel: 'Bar fade',
        bandTransHint: 'How transparent the title bar and the bottom cost/balance rows are',
        lumaAlgoLabel: 'Lightness',
        lumaAlgoHint: 'Which lightness defines the greyscale and the opacity of the dial/text',
        luma709: 'Rec.709 luma',
        lumaHsl: 'HSL lightness',
        lumaHsv: 'HSV value',
        lumaGainLabel: 'Content opacity',
        lumaGainHint: 'Multiplier on top of the chosen lightness: 100% = strictly by lightness (opacity = lightness); lower makes the content more transparent, 0% hides it',
        frostTransHint: 'Higher = more see-through (less milky tint)',
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

    /* ---------- 语言 / 存储 / 格式化 / 弧线几何 ---------- */
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

    /** 本回合花费：不足 1 分钱（0.01 元）一律显示 <0.01，免得看见一片 ¥0.00。 */
    function fmtTurnCost(v) {
      if (v === undefined || v === null || !Number.isFinite(v)) return '—'
      return v < 0.01 ? '<0.01' : fmtMoney(v)
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

    /**
     * 设置模型徽标：文本=模型缩写，配色按 pro=金 / vision=紫 / flash=蓝。
     * slot = 该徽标所在槽位的类名（最小化条 dsg-mini-badge / 竖条 dsg-narrow-badge）。
     * 必须显式传入：这里整体重写 className，会把槽位类冲掉，槽位样式（限宽、字号）随之失效。
     */
    function setModelBadge(el, modelRaw, slot) {
      const raw = modelRaw ? String(modelRaw) : ''
      const lower = raw.toLowerCase()
      const cls = lower.includes('pro') ? 'dsg-badge-pro'
        : lower.includes('vision') ? 'dsg-badge-vision'
        : raw ? 'dsg-badge-flash' : ''
      el.className = 'dsg-badge' + (slot ? ' ' + slot : '') + (cls ? ' ' + cls : '')
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

    // 表盘角度 p（0=左端 → 90=弧顶 → 180=右端）。半圆只表示 12 小时，两段都是「左端→弧顶→右端」：
    //   夜间段（左端=18:00）：18:00 左端 → 24:00 弧顶 → 次日 06:00 右端；
    //   白天段（左端=06:00）：06:00 左端 → 12:00 弧顶 → 18:00 右端。
    // 两段边界（06:00 与 18:00）都是「右端→左端」的瞬时跳变（见 updateDial）。
    function dialPosOfHour(hf) {
      const t = ((hf % 24) + 24) % 24
      if (t < 6) return 90 + 15 * t
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

    // 当日费率带（外圈）：周末与**法定节假日**全天全绿；工作日白天(6:00–18:00)按 绿(标准)+黄(高峰 9–12 / 14–18)；
    // 夜间(18:00–次日6:00)无高峰段 → 整弧绿色，避免夜里指针扫到“白天的黄段”。
    // 只对黄段(高峰)做圆头内缩，且只缩内部边界（9:00 / 12:00 / 14:00）：黄段在 SVG 里绘制于绿段之上，
    // 边界处的绿段圆头被黄段覆盖，可见边界由黄段精确决定；绿段与黄段在 18:00 的端头保持原样（圆头不缩）。
    // offAllDay：今天是中国法定节假日（即使落在周一至周五）——官方按空闲计费，故与周末同样全绿。
    function dialArcsFor(p, offAllDay) {
      const day = p.hour >= 6 && p.hour < 18
      if (offAllDay || p.weekday === 0 || p.weekday === 6 || !day) return { std: arcD(0, 180, RATE_R), peak: '' }
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


    /* ---------- 对外接口 ---------- */
    exports.LS_PREFIX = LS_PREFIX
    exports.DEFAULT_THRESHOLD = DEFAULT_THRESHOLD
    exports.POLL_MS = POLL_MS
    exports.TICK_MS = TICK_MS
    exports.DEFAULT_W = DEFAULT_W
    exports.MIN_W = MIN_W
    exports.MAX_W = MAX_W
    exports.MINI_W = MINI_W
    exports.ARC_W = ARC_W
    exports.CSS = CSS
    exports.I18N = I18N
    exports.localeTag = localeTag
    exports.detectLocale = detectLocale
    exports.injectCss = injectCss
    exports.loadLocalThreshold = loadLocalThreshold
    exports.saveLocalThreshold = saveLocalThreshold
    exports.loadJSON = loadJSON
    exports.saveJSON = saveJSON
    exports.fmtMoney = fmtMoney
    exports.fmtTurnCost = fmtTurnCost
    exports.fmtCountdown = fmtCountdown
    exports.fmtRemain = fmtRemain
    exports.setModelBadge = setModelBadge
    exports.modelColorOf = modelColorOf
    exports.beijingPartsNow = beijingPartsNow
    exports.dialPosOfHour = dialPosOfHour
    exports.RATE_R = RATE_R
    exports.BAL_R = BAL_R
    exports.BAL_LO = BAL_LO
    exports.BAL_HI = BAL_HI
    exports.RATE_CAP_DEG = RATE_CAP_DEG
    exports.arcXY = arcXY
    exports.arcD = arcD
    exports.arcBand = arcBand
    exports.dialArcsFor = dialArcsFor
    exports.ticksMarkup = ticksMarkup
    /** 挂载时写入当前语言（语言状态在 core 内唯一持有，apply 只写一次）。 */
    exports.setLocale = (loc) => { locale = loc; L = I18N[locale] || I18N.en }
    exports.t = (key, params) => t(key, params)
    return module.exports
  },
})