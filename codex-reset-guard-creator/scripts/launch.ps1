param(
    [ValidateSet('mcp','cli','runtime-info')][string]$Mode = 'mcp',
    [ValidateSet('start','status','enable','disable','stop')][string]$Action = 'status'
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
try {
    $pluginRoot = Split-Path -Parent $PSScriptRoot
    . (Join-Path $PSScriptRoot 'runtime.ps1')
    $runtimeRoot = Get-ResetGuardRuntime -PluginRoot $pluginRoot
    $nodePath = Join-Path $runtimeRoot 'node/node.exe'
    # These changes are limited to this launcher and its children, never the user's system settings.
    [Environment]::SetEnvironmentVariable('NODE_OPTIONS', $null, 'Process')
    [Environment]::SetEnvironmentVariable('NODE_PATH', $null, 'Process')
    $env:RESET_GUARD_RUNTIME_ROOT = $runtimeRoot
    if ($Mode -eq 'runtime-info') {
        $nodeVersion = & $nodePath --version
        [Console]::Out.WriteLine((@{ runtimeRoot=$runtimeRoot; nodeVersion=$nodeVersion; notificationExecutable=(Join-Path $pluginRoot 'notification-helper/windows-x64/ResetGuard.Notifications.exe') } | ConvertTo-Json -Compress))
        exit 0
    }
    $entry = Join-Path $pluginRoot $(if ($Mode -eq 'cli') { 'src/cli.mjs' } else { 'src/mcp.mjs' })
    $startInfo = [Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $nodePath
    $startInfo.Arguments = '"' + $entry + '"' + $(if ($Mode -eq 'cli') { ' ' + $Action } else { '' })
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.WorkingDirectory = $pluginRoot
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $child = [Diagnostics.Process]::Start($startInfo)
    # Forward raw bytes: PowerShell's native pipeline can buffer or transcode MCP JSONL.
    $inputPump = [Console]::OpenStandardInput().CopyToAsync($child.StandardInput.BaseStream)
    $outputPump = $child.StandardOutput.BaseStream.CopyToAsync([Console]::OpenStandardOutput())
    $errorPump = $child.StandardError.BaseStream.CopyToAsync([Console]::OpenStandardError())
    $inputClosed = $false
    while (-not $child.WaitForExit(100)) {
        if (-not $inputClosed) { $child.StandardInput.BaseStream.Flush() }
        if (-not $inputClosed -and $inputPump.IsCompleted) { $child.StandardInput.Close(); $inputClosed = $true }
    }
    [void]$outputPump.GetAwaiter().GetResult()
    [void]$errorPump.GetAwaiter().GetResult()
    exit $child.ExitCode
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
