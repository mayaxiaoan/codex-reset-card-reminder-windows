param([string]$OutputDirectory=(Join-Path $PSScriptRoot 'notification-helper/windows-x64'))
$ErrorActionPreference='Stop'
$framework=Join-Path $env:SystemRoot 'Microsoft.NET/Framework64/v4.0.30319'
$metadata=Join-Path $env:SystemRoot 'System32/WinMetadata'
$facade=Get-ChildItem -LiteralPath (Join-Path $env:SystemRoot 'Microsoft.NET/assembly/GAC_MSIL/System.Runtime') -Recurse -Filter System.Runtime.dll | Select-Object -First 1
if(-not $facade -or -not(Test-Path -LiteralPath (Join-Path $framework 'csc.exe'))){throw 'Build requires the Windows-provided .NET Framework compiler and WinRT metadata.'}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$output=Join-Path ([IO.Path]::GetFullPath($OutputDirectory)) 'ResetGuard.Notifications.exe'
$args=@('/nologo','/target:exe','/platform:x64','/optimize+','/debug-','/utf8output',('/out:'+$output),('/win32icon:'+(Join-Path $PSScriptRoot 'notification-helper/notification-icon.ico')),
 ('/r:'+(Join-Path $metadata 'Windows.UI.winmd')),('/r:'+(Join-Path $metadata 'Windows.Data.winmd')),('/r:'+(Join-Path $metadata 'Windows.Foundation.winmd')),
 ('/r:'+(Join-Path $framework 'System.Runtime.WindowsRuntime.dll')),('/r:'+$facade.FullName),('/r:'+(Join-Path $framework 'System.Web.Extensions.dll')),
 (Join-Path $PSScriptRoot 'notification-helper/Program.cs'),(Join-Path $PSScriptRoot 'notification-helper/NotificationPolicy.cs'))
& (Join-Path $framework 'csc.exe') @args
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'notification-helper/notification-icon.png') -Destination $OutputDirectory -Force
[IO.File]::WriteAllText(($output+'.config'),'<configuration><startup><supportedRuntime version="v4.0" /></startup></configuration>',[Text.UTF8Encoding]::new($false))
Write-Output $output
