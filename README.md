# dsh-cost-gauge

DeepSeek Harness（`dsh`）的**花费仪表**：在 Web 界面**左侧靠上**显示一个**可缩放、可展开/缩小**的浮动窗口，实时显示 DeepSeek API 花费与余额，用**极简时钟**（仅一根时针 + 双色外圈）指示当前时段费率是「空闲」还是「繁忙」，余额低于设定阈值时窗口顶部**小红灯闪烁报警**。

## 功能

- 🕐 **12 小时时钟造型**：外圈圆环按 o'clock 位置双色表示费率——**绿色 = 空闲（标准）**、**黄色 = 繁忙（高峰）**（周末全天绿色）；白色时针指示当前时间。
- 🛢️ **内圈里程表（余额油量计）**：弧形量表，满刻度 = 历史最高余额，**红色段 = 余额预警段**，橙→绿渐变弧 = 当前余额位置。
- 🖐️ **可拖拽 / 可缩放**：按住标题栏拖动；拖拽右下角把手放大或缩小窗口（时钟随之缩放），位置与大小自动记忆。
- 🔍 **展开 / 缩小两种状态**：
  - 展开态：时钟 + **话费花费、余额、命中率、当前模型** + 距下次切换倒计时；
  - 缩小态：只显示**话费、余额、剩余百分比**，加**两盏状态灯**——🟡 黄=繁忙、🟢 绿=空闲（当前状态亮起、另一盏暗掉），每盏灯外圈是**「状态所剩进度」饼环**。
- 💰 **会话花费**：按官方峰谷价实时换算当前会话的 token 花费（缓存命中/未命中、输出分桶计价）。
  - 繁忙（高峰）：北京时间周一至周五 09:00–12:00、14:00–18:00
  - 空闲（标准）：其余时间（含周六、周日全天），价格为高峰的一半
- 🔴 **红灯报警**：余额低于阈值（默认 ¥10）时，窗口顶部小红灯闪烁报警；余额充足时熄灭。
- ⚙️ **阈值可设**：点齿轮即可改报警阈值，立即生效并记住（localStorage）。

## 安装

### 一键安装（推荐，无需 git）

PowerShell 复制整行回车（自动补齐 dsh，无需本机 git）：

```powershell
irm https://raw.githubusercontent.com/wjingshan/dsh-cost-gauge/main/install.ps1 | iex
```

> 一键安装**自动装最新稳定版**（GitHub 最新 Release tag，发版后无需改脚本）。想装开发版或锁指定版本，先下载脚本再带参数运行：
>
> ```powershell
> irm https://raw.githubusercontent.com/wjingshan/dsh-cost-gauge/main/install.ps1 -OutFile install-dsh-cost-gauge.ps1
> .\install-dsh-cost-gauge.ps1 -Ref main        # 装 main 开发版
> .\install-dsh-cost-gauge.ps1 -Ref v1.0.0      # 锁指定版本
> ```

仓库尚未推送时可先用本地脚本装（`-Source` 指定本地目录）：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Source .\dsh-cost-gauge
```

### 手动安装（默认锁稳定版 v1.0.0）

```sh
# 从 git 安装（需要本机有 git，锁稳定版 tag）
dsh plugin --profile web add github:wjingshan/dsh-cost-gauge#v1.0.0

# 无 git 时用 tarball 直链（锁稳定版）
dsh plugin --profile web add https://github.com/wjingshan/dsh-cost-gauge/archive/refs/tags/v1.0.0.tar.gz

# 想装最新开发版（main 分支）
dsh plugin --profile web add github:wjingshan/dsh-cost-gauge#main

# 从本地目录安装（链接方式，改 lib/*.js 后刷新页面即生效）
dsh plugin --profile web add link:/path/to/dsh-cost-gauge
```

装完**重启** `dsh web`，刷新页面即可看到左上角浮动窗。

```sh
dsh web
```

## 配置

余额阈值既可在浮动窗里点齿轮改，也可在 profile 的 `cordis.patch.yml` 里覆盖：

```yaml
- update:
    - id: cost-gauge
      config:
        threshold: 10          # 余额报警阈值（人民币）
        baseUrl: 'https://api.deepseek.com'
        apiKeyEnv: 'DEEPSEEK_API_KEY'
        refreshSeconds: 30     # 余额查询缓存秒数
```

> 覆盖时需完整重述该行需要的全部 config 键（patch 按行整体替换 config，不做深合并）。

## 发布新版本

改完代码后，用 `release.ps1` 一条命令完成：提交 → 升版本 → 推送 → 创建 GitHub Release。

```powershell
.\release.ps1 -Message "feat: 新增 xxx"                 # 默认 patch（1.0.0 → 1.0.1）
.\release.ps1 -Type minor -Message "feat: 新增 xxx"     # minor（→ 1.1.0）
.\release.ps1 -Version 1.2.0 -Message "feat: 新增 xxx"  # 显式版本号
.\release.ps1 -Message "..." -DryRun                    # 预演（不真正执行）
```

- Release 说明默认从「上一个 tag 以来的提交历史」自动生成，也可 `-Notes "…"` 自定义。
- 创建 Release 需要 PAT：设置环境变量 `GH_TOKEN`（fine-grained，仓库权限 Contents 读写），或运行时按提示输入。
- 发版后无需改任何脚本——`install.ps1` 会自动安装最新 Release tag。

## 数据与安全

- 余额经官方 `GET /user/balance` 查询，API Key 只在宿主侧解析（credentials 接缝 / 环境变量），**绝不下发浏览器**。
- 花费由宿主读取会话的 `tokenUsage` 投影、按官方峰谷价换算；缓存写入不单独计费（与官方口径一致）。
- 纯 ESM、零运行时依赖：宿主不 import 任何包，浏览器半身是原生 JS（无 React）。

## 目录结构

```
dsh-cost-gauge/
├── package.json          # dsh.bundle（宿主）+ dsh.client（浏览器）声明
├── cordis.patch.yml      # 插件行插入（含默认 config）
├── install.ps1           # 一键安装脚本（irm … | iex）
├── release.ps1           # 一键发布脚本（提交+升版本+推送+创建 Release）
├── docs/
│   └── alipay-qr.jpg     # 支付宝收款码（README 赞助区引用）
├── lib/
│   ├── index.js          # 宿主半身：余额查询 + 花费统计 + 峰谷判定 + /api/cost-gauge/* 路由
│   └── client.js         # 浏览器半身：方形浮动窗（指针表 + 红灯 + 拖动 + 阈值设置）
└── README.md
```

## License

MIT

---

## ☕ 赞助

如果这个插件帮到了你，欢迎请我喝杯咖啡 ☕

<img src="docs/alipay-qr.jpg" alt="支付宝收款码" width="240" />

<div align="center">

**感谢你的支持！** 💙

</div>
