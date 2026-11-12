param(
    [Parameter(Mandatory=$true)][string]$NodeDistribution,
    [Parameter(Mandatory=$true)][string]$NodeArchiveSHA256,
    [Parameter(Mandatory=$true)][string]$WorkDirectory
)
$ErrorActionPreference = 'Stop'
$pluginRoot = $PSScriptRoot
$null = & (Join-Path $pluginRoot 'build-notifications.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Notification helper build failed' }
$buildRoot = [IO.Path]::GetFullPath($WorkDirectory)
if (Test-Path -LiteralPath $buildRoot) { throw '请使用一个新的构建工作目录，避免混入旧文件。' }
$payloadRoot = Join-Path $buildRoot 'payload'
$nodeRoot = Join-Path $payloadRoot 'node'
[IO.Directory]::CreateDirectory($nodeRoot) | Out-Null
Copy-Item -LiteralPath (Join-Path $NodeDistribution 'node.exe') -Destination $nodeRoot
Copy-Item -LiteralPath (Join-Path $NodeDistribution 'LICENSE') -Destination $nodeRoot
$nodeVersion = & (Join-Path $nodeRoot 'node.exe') --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v22\.') { throw '需要校验过的 Node.js 22 Windows x64 官方发行包。' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archivePath = Join-Path $buildRoot 'runtime.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($payloadRoot, $archivePath, [IO.Compression.CompressionLevel]::Optimal, $false)
$runtimeRoot = Join-Path $pluginRoot 'runtime/windows-x64'
[IO.Directory]::CreateDirectory($runtimeRoot) | Out-Null
$parts = @()
$inputArchive = [IO.File]::OpenRead($archivePath)
try {
    $partIndex = 1
    $partBytes = 20 * 1024 * 1024
    $buffer = [byte[]]::new(1024 * 1024)
    while ($inputArchive.Position -lt $inputArchive.Length) {
        $partName = 'runtime.zip.{0:D3}' -f $partIndex
        $partPath = Join-Path $runtimeRoot $partName
        $outputPart = [IO.File]::Open($partPath, 'Create', 'Write', 'None')
        try {
            $written = 0
            while ($written -lt $partBytes) {
                $read = $inputArchive.Read($buffer, 0, [Math]::Min($buffer.Length, $partBytes-$written))
                if ($read -eq 0) { break }
                $outputPart.Write($buffer, 0, $read)
                $written += $read
            }
        } finally { $outputPart.Dispose() }
        $parts += [ordered]@{ file=$partName; bytes=(Get-Item -LiteralPath $partPath).Length; sha256=(Get-FileHash -LiteralPath $partPath -Algorithm SHA256).Hash.ToLowerInvariant() }
        $partIndex++
    }
} finally { $inputArchive.Dispose() }
$files = @(Get-ChildItem -LiteralPath $payloadRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
    [ordered]@{ path=$_.FullName.Substring($payloadRoot.Length+1).Replace('\','/'); bytes=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
})
$manifest = [ordered]@{ schemaVersion=1; platform='win-x64'; nodeVersion=$nodeVersion.TrimStart('v'); notificationImplementation='windows-framework-exe'; nodeArchiveSHA256=$NodeArchiveSHA256; archiveSHA256=(Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant(); parts=$parts; files=$files }
[IO.File]::WriteAllText((Join-Path $runtimeRoot 'manifest.json'), ($manifest | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $NodeDistribution 'LICENSE') -Destination (Join-Path $runtimeRoot 'NODE-LICENSE.txt')
[IO.File]::WriteAllText((Join-Path $runtimeRoot 'README.md'), "# Bundled Windows x64 runtime`n`nNode.js $($manifest.nodeVersion); notifications use a small EXE with the Windows-provided .NET Framework and Windows API.`nAll runtime ZIP parts are shipped with the plugin; startup does not download files.`nThe launcher validates SHA-256 and extracts them to a per-user cache.`nNode.js license: NODE-LICENSE.txt. No modern .NET runtime is bundled.`n", [Text.UTF8Encoding]::new($false))
foreach ($oldPart in @(Get-ChildItem -LiteralPath $runtimeRoot -File -Filter 'runtime.zip.*')) {
    if ($oldPart.Name -notin @($parts | ForEach-Object { $_.file })) {
        $resolvedPart = [IO.Path]::GetFullPath($oldPart.FullName)
        if ([IO.Path]::GetDirectoryName($resolvedPart) -ne [IO.Path]::GetFullPath($runtimeRoot) -or $oldPart.Name -notmatch '^runtime\.zip\.[0-9]{3}$') { throw 'Unexpected obsolete runtime part path' }
        Remove-Item -LiteralPath $resolvedPart -Force
    }
}
[pscustomobject]$manifest | Select-Object nodeVersion,notificationImplementation,archiveSHA256,@{Name='partCount';Expression={$_.parts.Count}},@{Name='fileCount';Expression={$_.files.Count}} | ConvertTo-Json
