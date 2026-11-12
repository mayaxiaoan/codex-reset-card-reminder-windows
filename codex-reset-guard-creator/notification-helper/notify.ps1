param([ValidateSet('send','validate','register','status','open')][string]$Mode='send')
$ErrorActionPreference='Stop'
[Console]::InputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$OutputEncoding=[Console]::OutputEncoding
$appId='Codex.ResetGuard.Creator.Notifications'
$pluginLink='codex://plugins/codex-reset-guard-creator@reset-guard-creator-local'
try {
 if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -lt 5) { throw '通知组件需要 Windows 自带的 Windows PowerShell 5.1。' }
 if ($Mode -eq 'open') { Start-Process -FilePath $pluginLink; exit 0 }
 $payload=$null
 if ($Mode -eq 'send' -or $Mode -eq 'validate') {
  $inputText=[Console]::In.ReadToEnd()
  if ([Text.Encoding]::UTF8.GetByteCount($inputText) -gt 16384) { throw '通知内容过长。' }
  $payload=ConvertFrom-Json -InputObject $inputText
  foreach($entry in @(@{Name='title';Max=120},@{Name='body';Max=1000},@{Name='tag';Max=64})) {
   $property=$payload.PSObject.Properties[$entry.Name]
   if ($null -eq $property -or $property.Value -isnot [string] -or [string]::IsNullOrWhiteSpace($property.Value) -or $property.Value.Length -gt $entry.Max) { throw '通知内容无效。' }
  }
  if ($payload.tag -notmatch '^[a-zA-Z0-9_-]{1,64}$') { throw '通知标识无效。' }
  $title=[Security.SecurityElement]::Escape($payload.title)
  $body=[Security.SecurityElement]::Escape($payload.body)
  $xmlText='<toast activationType="protocol" launch="'+$pluginLink+'"><visual><binding template="ToastGeneric"><text>'+$title+'</text><text>'+$body+'</text></binding></visual><actions><action content="打开插件" activationType="protocol" arguments="'+$pluginLink+'" /></actions></toast>'
  $checkedXml=[xml]$xmlText
  if ($Mode -eq 'validate') { [Console]::Out.WriteLine('{"validated":true}'); exit 0 }
 }
 $principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
 if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw '请使用普通权限运行 Codex，以显示 Windows 通知。' }
 if ($Mode -ne 'status') {
  Add-Type -Path (Join-Path $PSScriptRoot 'Shortcut.cs')
  $shortcut=Join-Path ([Environment]::GetFolderPath('Programs')) '重置卡防过期提醒通知.lnk'
  $powershell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $arguments='-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -STA -ExecutionPolicy Bypass -File "'+$PSCommandPath+'" -Mode open'
  [ResetGuardShortcut]::Register($shortcut,$powershell,$arguments,(Join-Path $PSScriptRoot 'notification-icon.ico'),$appId)
  $registration='HKCU:\Software\Classes\AppUserModelId\'+$appId
  New-Item -Path $registration -Force | Out-Null
  New-ItemProperty -LiteralPath $registration -Name DisplayName -Value '重置卡防过期提醒' -PropertyType String -Force | Out-Null
  New-ItemProperty -LiteralPath $registration -Name IconUri -Value (Join-Path $PSScriptRoot 'notification-icon.png') -PropertyType String -Force | Out-Null
  if ($Mode -eq 'register') { [Console]::Out.WriteLine((@{registered=$true;appId=$appId;implementation='windows-powershell-system-api'} | ConvertTo-Json -Compress)); exit 0 }
 }
 [Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime] | Out-Null
 $notifier=[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)
 $setting='Unavailable'
 try { $setting=$notifier.Setting.ToString() } catch {
  $failure=$_.Exception
  while($failure.InnerException){$failure=$failure.InnerException}
  if ($failure.HResult -ne -2147023728) { throw }
 }
 if ($Mode -eq 'status') {
  $tags=@([Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($appId) | ForEach-Object { $_.Tag })
  [Console]::Out.WriteLine((@{setting=$setting;appId=$appId;ownNotificationTags=$tags;implementation='windows-powershell-system-api'} | ConvertTo-Json -Compress)); exit 0
 }
 if ($setting -ne 'Unavailable' -and $setting -ne 'Enabled') { throw ('Windows 通知未启用：'+$setting) }
 [Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom.XmlDocument,ContentType=WindowsRuntime] | Out-Null
 [Windows.UI.Notifications.ToastNotification,Windows.UI.Notifications,ContentType=WindowsRuntime] | Out-Null
 $document=[Windows.Data.Xml.Dom.XmlDocument]::new()
 $document.LoadXml($xmlText)
 $toast=[Windows.UI.Notifications.ToastNotification]::new($document)
 $toast.Tag=$payload.tag
 $toast.Group='reset-creator'
 $toast.SuppressPopup=$false
 $notifier.Show($toast)
 [Console]::Out.WriteLine((@{accepted=$true;setting=$setting;appId=$appId} | ConvertTo-Json -Compress))
} catch {
 [Console]::Error.WriteLine($_.Exception.Message)
 exit 1
}
