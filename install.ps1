#Requires -Version 5.1
<#
  dsh-cost-gauge 一键安装脚本
  ------------------------------------------------
  推荐用法（复制整行到 PowerShell 回车，直接安装到 web profile）：

    irm https://raw.githubusercontent.com/wjingshan/dsh-cost-gauge/main/install.ps1 | iex

  默认安装 **main 分支**（`github:wjingshan/dsh-cost-gauge#main`）。这样插件市场之后
  才能正常提示并执行「更新」——市场判断 git 安装能不能更新，看的是 **commit 有没有变**，
  只有分支写法会跟着走；固定 tag 会让它把同一个 tag 重装一遍，永远报「版本没有变化」。

  想指定版本 / 来源时，先下载脚本再带参数运行：

    irm https://raw.githubusercontent.com/wjingshan/dsh-cost-gauge/main/install.ps1 -OutFile install-dsh-cost-gauge.ps1
    .\install-dsh-cost-gauge.ps1                            # 跟 main（市场可自动更新）
    .\install-dsh-cost-gauge.ps1 -Ref v1.5.4                # 锁 tag（市场不会自动更新）
    .\install-dsh-cost-gauge.ps1 -Source .\dsh-cost-gauge              # 本地目录（链接方式）
    .\install-dsh-cost-gauge.ps1 -Source https://github.com/wjingshan/dsh-cost-gauge/archive/refs/tags/v1.5.4.tar.gz

  说明：
    - 默认的 `github:` 写法由 pnpm 用 `git ls-remote` 解析分支，**需要本机有 git**；
      检测不到 git 时会自动回退到「最新 Release 的 tarball 直链」（那种装法市场不会提示更新）。
    - 需要 Node.js >= 20 与 DeepSeek Harness（带 dsh 命令；没有则自动用 npx）。
#>
[CmdletBinding()]
param(
  [string]$Profile = 'web',
  [string]$Ref = '',            # 留空 = main（市场可自动更新）；可填分支（main）或 tag（v1.5.4，市场不会自动更新）
  [string]$Owner = 'wjingshan',
  [string]$Repo = 'dsh-cost-gauge',
  [string]$Source = ''   # 可选：本地目录或任意安装源；留空则按 -Ref 用 github: 写法
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok([string]$m)   { Write-Host "    [ok] $m" -ForegroundColor Green }
function Write-Warn([string]$m) { Write-Host "    [!]  $m" -ForegroundColor Yellow }
function Fail([string]$m)       { Write-Host "`n[x] $m" -ForegroundColor Red; exit 1 }

# 1) 定位 dsh 命令
Write-Step '检查 dsh 命令'
$dshCmd = Get-Command dsh -CommandType Application,ExternalScript -ErrorAction SilentlyContinue
if ($dshCmd) {
  Write-Ok "找到 dsh：$($dshCmd.Source)"
} else {
  Write-Warn '未找到全局 dsh 命令，将改用 npx --yes @deepseek-ai/dsh'
}

function Invoke-Dsh([string[]]$Args) {
  if ($dshCmd) {
    & dsh @Args
    if ($LASTEXITCODE -ne 0) { Fail "dsh $($Args -join ' ') 失败（exit $LASTEXITCODE）" }
  } else {
    & npx --yes @deepseek-ai/dsh @Args
    if ($LASTEXITCODE -ne 0) { Fail "npx @deepseek-ai/dsh $($Args -join ' ') 失败（exit $LASTEXITCODE）" }
  }
}

# 2) 解析安装来源
#    默认跟 main：只有「分支」写法（github:owner/repo#main）插件市场才能正常更新；
#    固定 tag 的 git 安装会让市场把同一个 tag 重装一遍，永远报「版本没有变化」。
Write-Step "解析安装来源（$Repo → profile '$Profile'）…"
if ($Source) {
  Write-Ok "使用指定来源：$Source"
} else {
  if (-not $Ref) { $Ref = 'main' }
  $hasGit = [bool](Get-Command git -CommandType Application -ErrorAction SilentlyContinue)
  if ($hasGit) {
    $Source = "github:$Owner/$Repo#$Ref"
    Write-Ok "安装来源：$Source"
    if ($Ref -match '^v?\d') {
      Write-Warn "锁定 tag（$Ref）：插件市场无法自动更新这种安装——更新时它会把同一个 tag 重装一遍。想能自动更新请用 -Ref main。"
    }
  } else {
    Write-Warn '未找到 git：github: 写法需要 git 解析分支，改用最新 Release 的 tarball 直链。'
    if ($Ref -notmatch '^v?\d') {
      $Ref = ''
      try {
        $latest = Invoke-RestMethod -Uri "https://api.github.com/repos/$Owner/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'dsh-cost-gauge-installer' } -TimeoutSec 15
        if ($latest -and $latest.tag_name) { $Ref = [string]$latest.tag_name }
      } catch {
        Write-Warn '获取最新 Release 失败'
      }
      if (-not $Ref) {
        Write-Warn '回退到默认 v1.5.4'
        $Ref = 'v1.5.4'
      }
    }
    $Source = "https://github.com/$Owner/$Repo/archive/refs/tags/$Ref.tar.gz"
    Write-Ok "安装来源：$Source"
    Write-Warn 'tarball 装法：插件市场不会提示更新；需要更新时重新运行本脚本，或装 git 后用 -Ref main 重装。'
  }
}

Write-Step "安装 $Repo 到 profile '$Profile'（ref=$Ref）…"
Invoke-Dsh @('plugin', '--profile', $Profile, 'add', $Source)
Write-Ok "已安装并登记为 profile 插件层"

# 3) 重启提示
Write-Step '完成'
Write-Host ''
Write-Host '  下一步：重启 dsh web 使其生效：' -ForegroundColor White
Write-Host ''
Write-Host '      dsh web' -ForegroundColor Green
Write-Host ''
Write-Host '  重启并刷新页面后，界面左上角会出现「DeepSeek 花费」方形浮动窗。' -ForegroundColor DarkGray
Write-Host '  余额阈值可在浮动窗点齿轮修改；峰谷费率指针会在标准/翻倍间自动摆动。' -ForegroundColor DarkGray
