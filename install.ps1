#Requires -Version 5.1
<#
  dsh-cost-gauge 一键安装脚本
  ------------------------------------------------
  推荐用法（复制整行到 PowerShell 回车，直接安装到 web profile）：

    irm https://raw.githubusercontent.com/wjingshan/dsh-cost-gauge/main/install.ps1 | iex

  默认自动安装最新稳定版（GitHub 最新 Release tag）。

  想指定版本 / 分支 / 本地目录时，先下载脚本再带参数运行：

    irm https://raw.githubusercontent.com/wjingshan/dsh-cost-gauge/main/install.ps1 -OutFile install-dsh-cost-gauge.ps1
    .\install-dsh-cost-gauge.ps1                            # 自动用最新稳定版
    .\install-dsh-cost-gauge.ps1 -Ref main                  # 装 main 开发版
    .\install-dsh-cost-gauge.ps1 -Ref v1.0.0                # 锁指定版本
    .\install-dsh-cost-gauge.ps1 -Source .\dsh-cost-gauge   # 本地目录

  说明：
    - 无需本机安装 git（使用 GitHub tarball 直链，pnpm 直接拉取）。
    - 需要 Node.js >= 20 与 DeepSeek Harness（带 dsh 命令；没有则自动用 npx）。
#>
[CmdletBinding()]
param(
  [string]$Profile = 'web',
  [string]$Ref = '',            # 留空 = 自动用 GitHub 最新 Release tag；可填 tag（v1.0.0）或分支（main）
  [string]$Owner = 'wjingshan',
  [string]$Repo = 'dsh-cost-gauge',
  [string]$Source = ''   # 可选：本地目录或任意安装源；留空则用 GitHub tarball
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

# 2) 解析安装来源（默认自动取最新 Release tag；也可 -Ref / -Source 指定）
Write-Step "解析安装来源（$Repo → profile '$Profile'）…"
if ($Source) {
  Write-Ok "使用指定来源：$Source"
} else {
  if (-not $Ref) {
    Write-Host '    未指定版本，自动获取最新 Release…'
    try {
      $latest = Invoke-RestMethod -Uri "https://api.github.com/repos/$Owner/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'dsh-cost-gauge-installer' } -TimeoutSec 15
      if ($latest -and $latest.tag_name) { $Ref = [string]$latest.tag_name }
    } catch {
      Write-Warn '获取最新 Release 失败'
    }
    if (-not $Ref) {
      Write-Warn '回退到默认 v1.4.0'
      $Ref = 'v1.0.1'
    }
    Write-Ok "最新 Release：$Ref"
  }
  # 以数字/v+数字开头的 ref 视为 tag（refs/tags/），其余视为分支（refs/heads/）
  $refPath = if ($Ref -match '^v?\d') { "refs/tags/$Ref" } else { "refs/heads/$Ref" }
  $Source = "https://github.com/$Owner/$Repo/archive/$refPath.tar.gz"
  Write-Ok "安装来源：$Source"
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
