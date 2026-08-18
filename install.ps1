#Requires -Version 5.1
<#
  dsh-cost-gauge 一键安装脚本
  ------------------------------------------------
  推荐用法（复制整行到 PowerShell 回车，直接安装到 web profile）：

    irm https://raw.githubusercontent.com/wjingshan/dsh-cost-gauge/main/install.ps1 | iex

  指定 profile 或分支：

    irm https://raw.githubusercontent.com/wjingshan/dsh-cost-gauge/main/install.ps1 | iex
    # 之后按提示，或手动：
    # irm .../install.ps1 | iex -Profile web -Ref main

  说明：
    - 无需本机安装 git（使用 GitHub tarball 直链，pnpm 直接拉取）。
    - 需要 Node.js >= 20 与 DeepSeek Harness（带 dsh 命令；没有则自动用 npx）。
#>
[CmdletBinding()]
param(
  [string]$Profile = 'web',
  [string]$Ref = 'main',
  [string]$Owner = 'wjingshan',
  [string]$Repo = 'dsh-cost-gauge'
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

# 2) 安装（GitHub tarball 直链，无需本机 git）
Write-Step "安装 $Repo 到 profile '$Profile'（ref=$Ref）"
$tarball = "https://github.com/$Owner/$Repo/archive/refs/heads/$Ref.tar.gz"
Write-Host "    来源：$tarball"
Invoke-Dsh @('plugin', '--profile', $Profile, 'add', $tarball)
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
