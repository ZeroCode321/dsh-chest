# gates.ps1 — 跑一遍与本改动相关的仓库门检，输出每项的退出码。
#
# 用法：pwsh -File gates.ps1 -Checkout C:\path\to\deepseek-harness
param(
  [Parameter(Mandatory = $true)][string]$Checkout
)
$ErrorActionPreference = 'Continue'

function Section([string]$title, [string[]]$command) {
  Write-Output "=== $title ==="
  Push-Location $Checkout
  $result = & $command[0] $command[1..($command.Length - 1)] 2>&1 | Out-String
  $code = $LASTEXITCODE
  Pop-Location
  Write-Output (($result.Trim() -split "`r?`n" | Select-Object -Last 12) -join "`n")
  Write-Output "EXIT $code"
}

Section 'vitest: chest packages + affected downstream' @(
  'npx', 'vitest', 'run',
  'packages/host/plugin-shelf', 'packages/client/ui-plugin-shelf',
  'packages/client/ui-sidebar', 'packages/api/remotes')
Section 'verify-export-jsdoc' @('npx', 'tsx', 'scripts/verify-export-jsdoc.ts')
Section 'verify-package-invariants' @('npx', 'tsx', 'scripts/verify-package-invariants.ts')
Section 'verify-built-package-invariants' @('node', 'scripts/verify-built-package-invariants.mjs')
Section 'verify-cordis-config' @('npx', 'tsx', 'scripts/verify-cordis-config.ts')
Section 'verify-package-readme-model-experience' @('npx', 'tsx', 'scripts/verify-package-readme-model-experience.ts')
Section 'verify-package-readme-limitations' @('npx', 'tsx', 'scripts/verify-package-readme-limitations.ts')
Section 'verify-config-source-ownership' @('npx', 'tsx', 'scripts/verify-config-source-ownership.ts')
Section 'knip (unused code and dependencies)' @('npx', 'knip', '--treat-config-hints-as-errors')
Section 'oxlint: chest packages' @('npx', 'tsx', 'scripts/run-oxlint.ts', 'packages/host/plugin-shelf', 'packages/client/ui-plugin-shelf')

Write-Output @'

注意：verify-client-domain-graph 在部分 checkout 上会报既存违规
（本项目未触碰的 runtime/contract、ui-conversation/skeleton、ui-input-trigger、ui-workspace），
详见 docs/verification.md。该门检未列入上式，避免把既存问题误算到本改动头上。
'@
