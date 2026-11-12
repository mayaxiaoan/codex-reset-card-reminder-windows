Set-StrictMode -Version 2

function Get-ResetGuardHash {
    param([string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose(); $stream.Dispose() }
}

function Get-ResetGuardRuntime {
    param([Parameter(Mandatory=$true)][string]$PluginRoot)
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or -not [Environment]::Is64BitOperatingSystem) {
        throw '当前版本仅支持 Windows x64，暂不支持 macOS 或其他系统。'
    }
    $bundleRoot = Join-Path $PluginRoot 'runtime/windows-x64'
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $bundleRoot 'manifest.json') -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.schemaVersion -ne 1 -or $manifest.archiveSHA256 -notmatch '^[a-f0-9]{64}$') { throw '运行环境清单无效，请重新安装插件。' }
    foreach ($item in $manifest.files) {
        if ($item.path -notmatch '^(node|notifications)/[a-zA-Z0-9_./-]+$' -or $item.path -match '(^|/)\.\.(/|$)' -or $item.sha256 -notmatch '^[a-f0-9]{64}$') { throw '运行环境文件清单无效。' }
    }
    $cacheBase = if ($env:RESET_GUARD_RUNTIME_CACHE) { $env:RESET_GUARD_RUNTIME_CACHE } else { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'CodexResetGuard/runtimes' }
    $cacheBase = [IO.Path]::GetFullPath($cacheBase)
    [IO.Directory]::CreateDirectory($cacheBase) | Out-Null
    $runtimeRoot = Join-Path $cacheBase $manifest.archiveSHA256
    $lockPath = Join-Path $cacheBase ($manifest.archiveSHA256 + '.lock')
    $lockHandle = $null
    $deadline = [DateTime]::UtcNow.AddSeconds(60)
    while (-not $lockHandle) {
        try { $lockHandle = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None') }
        catch [IO.IOException] { if ([DateTime]::UtcNow -ge $deadline) { throw '等待插件运行环境准备超时，请重试。' }; Start-Sleep -Milliseconds 100 }
    }
    $temporaryRoot = $null
    try {
        $cacheValid = Test-Path -LiteralPath (Join-Path $runtimeRoot '.ready')
        if ($cacheValid) {
            foreach ($item in $manifest.files) {
                $filePath = Join-Path $runtimeRoot $item.path
                if (-not (Test-Path -LiteralPath $filePath) -or (Get-ResetGuardHash -Path $filePath) -ne $item.sha256) { $cacheValid = $false; break }
            }
        }
        if (-not $cacheValid) {
            $temporaryRoot = Join-Path $cacheBase ('.' + $manifest.archiveSHA256 + '.' + [Guid]::NewGuid().ToString('N'))
            [IO.Directory]::CreateDirectory($temporaryRoot) | Out-Null
            $zipPath = Join-Path $temporaryRoot 'runtime.zip'
            $zip = [IO.File]::Open($zipPath, 'CreateNew', 'Write', 'None')
            try {
                foreach ($part in $manifest.parts) {
                    if ($part.file -notmatch '^runtime\.zip\.[0-9]{3}$') { throw '运行环境分卷名称无效。' }
                    $partPath = Join-Path $bundleRoot $part.file
                    if ((Get-ResetGuardHash -Path $partPath) -ne $part.sha256) { throw '运行环境分卷校验失败，请重新安装插件。' }
                    $inputPart = [IO.File]::OpenRead($partPath)
                    try { $inputPart.CopyTo($zip) } finally { $inputPart.Dispose() }
                }
            } finally { $zip.Dispose() }
            if ((Get-ResetGuardHash -Path $zipPath) -ne $manifest.archiveSHA256) { throw '运行环境归档校验失败。' }
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $extractRoot = Join-Path $temporaryRoot 'files'
            [IO.Directory]::CreateDirectory($extractRoot) | Out-Null
            $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
            try {
                foreach ($entry in $archive.Entries) {
                    $entryPath = [IO.Path]::GetFullPath((Join-Path $extractRoot $entry.FullName))
                    if (-not $entryPath.StartsWith($extractRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '运行环境归档包含非法路径。' }
                }
            } finally { $archive.Dispose() }
            [IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractRoot)
            foreach ($item in $manifest.files) {
                $filePath = [IO.Path]::GetFullPath((Join-Path $extractRoot $item.path))
                if (-not $filePath.StartsWith($extractRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
                    (Get-ResetGuardHash -Path $filePath) -ne $item.sha256) { throw '运行环境文件校验失败。' }
            }
            [IO.File]::WriteAllText((Join-Path $extractRoot '.ready'), $manifest.archiveSHA256)
            if (Test-Path -LiteralPath $runtimeRoot) {
                $resolvedTarget = [IO.Path]::GetFullPath($runtimeRoot)
                if (-not $resolvedTarget.StartsWith($cacheBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
                    [IO.Path]::GetFileName($resolvedTarget) -ne $manifest.archiveSHA256) { throw '运行环境缓存路径检查失败。' }
                Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
            }
            [IO.Directory]::Move($extractRoot, $runtimeRoot)
        }
        return $runtimeRoot
    } finally {
        if ($temporaryRoot -and (Test-Path -LiteralPath $temporaryRoot)) {
            $resolvedTemporary = [IO.Path]::GetFullPath($temporaryRoot)
            if ($resolvedTemporary.StartsWith($cacheBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
                [IO.Path]::GetFileName($resolvedTemporary).StartsWith('.' + $manifest.archiveSHA256 + '.')) { Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force }
        }
        $lockHandle.Dispose()
    }
}
