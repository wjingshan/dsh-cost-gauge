#Requires -Version 5.1
<#
  dsh-cost-gauge 一键发布脚本
  ------------------------------------------------
  功能：提交改动 → 升级版本号 → 推送 → 创建 GitHub Release

  用法（在仓库任意位置运行均可）：
    .\release.ps1 -Message "feat: 新增 xxx"                 # 默认 patch（1.0.0 → 1.0.1）
    .\release.ps1 -Type minor -Message "feat: 新增 xxx"     # minor（→ 1.1.0）
    .\release.ps1 -Version 1.2.0 -Message "feat: 新增 xxx"  # 显式版本号
    .\release.ps1 -Message "..." -Notes "发布说明…"         # 自定义 Release 说明
    .\release.ps1 -Message "..." -DryRun                    # 预演，不真正执行

  认证：创建 GitHub Release 需要 PAT。
    - 优先读环境变量 GH_TOKEN（fine-grained PAT，仓库权限 Contents 读写）
    - 未设置则运行时提示输入（输入不可见）
#>
[CmdletBinding()]
param(
  [ValidateSet('patch', 'minor', 'major')]
  [string]$Type = 'patch',
  [string]$Version = '',
  [string]$Message = '',
  [string]$Notes = '',
  [switch]$DryRun,
  [string]$Owner = 'wjingshan',
  [string]$Repo = 'dsh-cost-gauge'
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Write-Step([string]$m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok([string]$m)   { Write-Host "    [ok] $m" -ForegroundColor Green }
function Write-Warn([string]$m) { Write-Host "    [!]  $m" -ForegroundColor Yellow }
function Fail([string]$m)       { Write-Host "`n[x] $m" -ForegroundColor Red; exit 1 }

# 0) 前置检查
Write-Step '前置检查'
if ((git rev-parse --is-inside-work-tree) -ne 'true') { Fail '当前目录不是 git 仓库' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { Fail '未找到 npm 命令' }

# 1) 提交工作区改动
Write-Step '提交改动'
$dirty = @(git status --porcelain).Count
if ($dirty -gt 0) {
  if (-not $Message) { Fail '工作区有未提交改动，请用 -Message 提供提交说明（如 -Message "feat: 新增 xxx"）' }
  if ($DryRun) {
    Write-Warn "[dry-run] git add -A; git commit -m `"$Message`""
  } else {
    git add -A
    git commit -m $Message | Out-Host
    if ($LASTEXITCODE -ne 0) { Fail 'git commit 失败' }
    Write-Ok "已提交：$Message"
  }
} else {
  Write-Ok '工作区干净，无需提交'
}

# 2) 记录上一个 tag（用于生成 Release 说明）
$prevTag = git describe --tags --abbrev=0 2>$null
if (-not $prevTag) { $prevTag = '' }

# 3) 升级版本（npm version 会自动提交并打 tag）
Write-Step '升级版本'
if ($DryRun) {
  if ($Version) { Write-Warn "[dry-run] npm version $Version" } else { Write-Warn "[dry-run] npm version $Type" }
} else {
  if ($Version) {
    npm version $Version | Out-Host
  } else {
    npm version $Type | Out-Host
  }
  if ($LASTEXITCODE -ne 0) { Fail 'npm version 失败' }
  Write-Ok '版本已升级并打 tag'
}
$newVersion = (Get-Content package.json -Raw -Encoding UTF8 | ConvertFrom-Json).version
$newTag = "v$newVersion"
Write-Ok "新版本：$newVersion（tag $newTag）"

# 4) 推送
Write-Step '推送 main 与 tag'
if ($DryRun) {
  Write-Warn '[dry-run] git push; git push --tags'
} else {
  git push
  if ($LASTEXITCODE -ne 0) { Fail 'git push 失败' }
  git push --tags
  if ($LASTEXITCODE -ne 0) { Fail 'git push --tags 失败' }
  Write-Ok '已推送 main 与 tag'
}

# 5) 生成 Release 说明
Write-Step 'Release 说明'
if (-not $Notes) {
  $commits = if ($prevTag) { git log --oneline "$prevTag..$newTag" 2>$null } else { git log --oneline }
  if (-not $commits) { $commits = "发布 $newTag" }
  $Notes = "## $newTag`n`n$($commits -join "`n")"
}
Write-Ok "说明：`n$Notes"

# 6) 创建 GitHub Release
Write-Step '创建 GitHub Release'
if ($DryRun) {
  Write-Warn "[dry-run] POST /repos/$Owner/$Repo/releases { tag_name: $newTag }"
  Write-Ok '预演完成（未做任何修改）'
  exit 0
}

$token = $env:GH_TOKEN
if (-not $token) {
  $sec = Read-Host '输入 GitHub PAT（fine-grained，需 Contents 读写）' -AsSecureString
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try { $token = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
if (-not $token) { Fail '未提供 PAT（请设置环境变量 GH_TOKEN）' }

$payload = @{ tag_name = $newTag; name = $newTag; body = $Notes; draft = $false; prerelease = $false } | ConvertTo-Json
$tmp = Join-Path $env:TEMP 'dsh-cost-gauge-release.json'
[System.IO.File]::WriteAllText($tmp, $payload, (New-Object System.Text.UTF8Encoding($false)))
$respRaw = curl.exe -s -X POST -H "Authorization: Bearer $token" -H "Accept: application/vnd.github+json" -H "Content-Type: application/json" --data-binary "@$tmp" "https://api.github.com/repos/$Owner/$Repo/releases"
Remove-Item $tmp -ErrorAction SilentlyContinue
$resp = $respRaw | ConvertFrom-Json
if (-not $resp.html_url) { Fail "创建 Release 失败：$($resp.message)" }
Write-Ok "Release 已创建：$($resp.html_url)"

# 7) 完成
Write-Step '完成'
Write-Host ''
Write-Host "  版本 $newTag 已发布" -ForegroundColor Green
Write-Host "  $($resp.html_url)" -ForegroundColor DarkGray
