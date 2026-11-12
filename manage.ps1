param(
  [ValidateSet('start', 'status', 'enable', 'disable', 'stop', 'install-plugin')]
  [string]$Action = 'status'
)
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw '当前版本仅支持 Windows，暂不支持 macOS 或其他系统。' }
$codexPath = (Get-Command codex.exe -ErrorAction Stop).Source
$env:RESET_GUARD_CODEX = $codexPath
$launcher = Join-Path $PSScriptRoot 'codex-reset-guard-creator/scripts/launch.ps1'
if ($Action -eq 'install-plugin') {
  & $launcher -Mode runtime-info | Out-Null
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & $codexPath plugin marketplace add $PSScriptRoot
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & $codexPath plugin add codex-reset-guard-creator@reset-guard-creator-local
  exit $LASTEXITCODE
}
& $launcher -Mode cli -Action $Action
exit $LASTEXITCODE
