# dsh-cost-gauge — 项目规则

## UI 一律复用现有元素，不新增面板（用户明确要求，2026-10-23）

**以后不管是接入 MiniMax 还是接入其他模型，不管是计费、计时还是计用量，都用现有的 UI 界面。除非用户明确说明，否则不要增加新的 UI 元素和面板。**

具体到本插件现有的可复用位置：

| 现有元素 | 可承载的信息 |
| --- | --- |
| 表盘外圈半弧（`arc-std` / `arc-peak`） | 时间进度、额度消耗、任何"比例"型指标 |
| 表盘下方两项（`dsg-label-rate` / `dsg-label-switch`） | 两个关键数值 + 各自的标签 |
| `dsg-rows` 三行（本回合花费 / 会话花费 / 余额） | 金额或计数值 |
| 最小化胶囊：圆环 `dsg-mini-prog` + 中心灯 + 金额 + 徽标 | 紧凑态的比例、状态、数值 |
| 竖条 `dsg-narrow-*` | 同上，竖版 |
| 设置面板 `dsg-settings` | 配置项（输入框 / 按钮 / 复选框） |

做法上：切换模型时**改变现有元素所表达的含义和颜色**，而不是在旁边加一块新区域。

反例（已发生并被要求移除）：曾为 MiniMax 额度单独加过一个 `.dsg-minimax` 卡片（带标题行、进度条、提示行），被判定为"加面板当补丁"，已删除。额度改由表盘弧 + 表盘下方两项 + 最小化圆环表达。

## 数据与 UI 之间必须经过归一化层（2026-10-24）

**UI 不认识模型，不认识任何平台字段名。** 浏览器半身只轮询 `GET /api/cost-gauge/gauge`，只渲染 `lib/gauge-view.js` 产出的这一种形状：

```
{ mode, meta, dial, ring, caption, rows, compact, balanceRing, tone, alarm }
```

- `mode`：`metered`（按量计费）/ `subscription`（订阅制）
- `dial.kind`：只有两种几何 —— `schedule`（按小时分段的费率表）/ `window`（单窗口按比例填充，服务端给 `fromDeg`/`toDeg`/`color`）
- 值一律是**结构化 spec**（`money` / `turnMoney` / `percent` / `unlimited` / `duration` / `rateStatus` / `text`），由 `specText()` 在浏览器侧渲染 —— i18n 与数字格式化留在前端，服务端只给语义
- `duration` 给的是时间打点（`at` + `untilMs`）而不是成品字符串，所以 `tick()` 能每秒重算倒计时且不必再发请求
- `balanceRing` 是既有 UI（表盘 R=47 的余额内环），**任何模型下都画**，没有余额数据才不画

### 接入新模型怎么做

1. 在 `lib/gauge-view.js` 加一个 adapter，产出上面那套形状（`buildMeteredView` / `buildSubscriptionView` 是模板）
2. 在 `detectMode()` 里加模型识别
3. **UI 一行不用改** —— 只要它能归到 `dial.kind` 的两种几何之一

只有当新模型的数据既不是"时段表"也不是"单窗口比例"时，才需要动 UI，那说明几何本身是新的。

反例（已发生）：改造前 UI 直接读 `mmxData.windows.five.usedPercent`，`isMiniMaxModel()` 散在 render/tick/updateDial 共 6 处，MiniMax 字段名在渲染代码里出现 41 次，且「5 小时剩余」在两个地方各算一遍。接第三个模型要复制全部这些分支。

## 相关实现约定

- `lib/client.js` 是浏览器半身，`lib/client.core.js` 是其按需 chunk（常量 / CSS / i18n / 工具）。同包的 `client.<name>.js` 宿**不会**自动注册，必须 `require.async()` 取。
- i18n 的 `zh` / `en` 键集合必须完全一致；改文案时两边同改。视图里的 `labelKey` 用中性名（`quotaRowPrimary`），不要带模型名。
- 账本 `~/.dsh/cost-gauge/ledger.json` 会被宿主每 15 秒整份覆写；凭据等不该被覆盖的数据放独立文件（当前：`minimax.json`）。
- 改完跑 `node test/*.mjs`（7 个文件、157 个断言），并在真实宿主里验一遍再提交。**改完 `client.core.js` 要清浏览器缓存再验**，否则读到的是旧 chunk，新 i18n 键会原样显示成 key 名。
- 改作用域前先全量搜引用点：曾把 `const bal` 挪进分支，导致公共路径上的 `updateBalance(bal …)` 抛 ReferenceError，`render()` 中断、余额环和每秒 tick 一起失效。
