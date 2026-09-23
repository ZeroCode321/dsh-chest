# apply-patches.ps1 — 把 chest 补丁系列应用到一个 DeepSeek Harness 源码 checkout，
# 安装工作区依赖并构建 host/client 两个面。
#
# 用法：
#   pwsh -File apply-patches.ps1 -Checkout C:\path\to\deepseek-harness
#   pwsh -File apply-patches.ps1 -Checkout ... -SkipInstall   # 依赖已装好时跳过 pnpm install
#   pwsh -File apply-patches.ps1 -Checkout ... -DryRun        # 只看会不会干净应用，不改动
param(
  [Parameter(Mandatory = $true)][string]$Checkout,
  [switch]$SkipInstall,
  [switch]$DryRun
)
$ErrorActionPreference = 'Continue'   # git writes progress to stderr; exit codes are the verdict

$patchDir = Join-Path (Split-Path -Parent $PSScriptRoot) 'patches'
if (-not (Test-Path -LiteralPath $Checkout)) { throw "checkout not found: $Checkout" }
if (-not (Test-Path -LiteralPath (Join-Path $Checkout 'packages\bundle\web-app\cordis.patch.yml'))) {
  throw "$Checkout does not look like a deepseek-harness checkout (no packages/bundle/web-app)"
}
$patches = Get-ChildItem -LiteralPath $patchDir -Filter *.patch | Sort-Object Name
if ($patches.Count -eq 0) { throw "no patches found in $patchDir" }

Write-Output "== 检查能否干净应用 =="
foreach ($patch in $patches) {
  & git -C $Checkout apply --check --3way $patch.FullName 2>&1 | ForEach-Object { Write-Output "  $_" }
  if ($LASTEXITCODE -ne 0) { throw "patch does not apply cleanly: $($patch.Name)" }
  Write-Output "  ok  $($patch.Name)"
}
if ($DryRun) { Write-Output 'dry run: nothing was applied'; exit 0 }

Write-Output '== 应用补丁 =='
foreach ($patch in $patches) {
  & git -C $Checkout am --3way $patch.FullName 2>&1 | ForEach-Object { Write-Output "  $_" }
  if ($LASTEXITCODE -ne 0) {
    Write-Output "  git am stopped on $($patch.Name). 解决冲突后运行: git -C $Checkout am --continue"
    exit 1
  }
}

if (-not $SkipInstall) {
  Write-Output '== pnpm install（新工作区包需要链接） =='
  Push-Location $Checkout
  & pnpm install
  if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'pnpm install failed' }
  Pop-Location
}

Write-Output '== 构建 =='
Push-Location $Checkout
& npm run build:lib:host
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'host build failed' }
& npm run build:lib:client
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'client build failed' }
Pop-Location

Write-Output @'

完成。还剩两件事：
  1) 重启 dsh web（Loader 在启动时组合 bundle 层，浏览器花名册也只在启动时扫一次）
  2) 想装示例插件的话，把 plugins/dsh-whale-diving 复制到任意位置，
     然后在侧边栏 chest 的 plugin 分区用「+ → 添加目录」登记，再点安装
'@
