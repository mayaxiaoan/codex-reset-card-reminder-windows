using System;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Xml;
using System.Xml.Linq;
using System.Threading;
using Microsoft.Win32;
using Windows.Data.Xml.Dom;
using Windows.UI.Notifications;
[assembly:System.Reflection.AssemblyVersion("1.7.1.0")]
[assembly:System.Reflection.AssemblyFileVersion("1.7.1.0")]
[assembly:System.Reflection.AssemblyTitle("重置卡防过期提醒通知")]
[assembly:System.Reflection.AssemblyProduct("重置卡防过期提醒")]

// Uses the Windows-provided .NET Framework and WinRT projections.
// No PowerShell child process, downloader, or modern .NET runtime is used.
internal static class Program {
 private const string AppId="Codex.ResetGuard.Creator.Notifications";
 private const string PluginLink="codex://plugins/codex-reset-guard-creator@centurygame-plugins";
 private const string ShortcutName="重置卡防过期提醒通知.lnk";
 // Protocol-only notifications use a stub CLSID; no COM server is installed or launched.
 private static readonly Guid StubActivator=new Guid("DEA55A36-E5EF-49C6-9779-82C959DDC257");
 private static readonly PropertyKey AppIdKey=new PropertyKey{FormatId=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),Id=5};
 private static readonly PropertyKey ActivatorKey=new PropertyKey{FormatId=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),Id=26};
 private static string Stage="启动通知组件";
 private static readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=16384,RecursionLimit=8};
 public class Payload {public string Title {get;set;} public string Body {get;set;} public string Tag {get;set;}}
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)]private static extern int SetCurrentProcessExplicitAppUserModelID(string id);
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)]private static extern void SHChangeNotify(uint eventId,uint flags,[MarshalAs(UnmanagedType.LPWStr)]string path,IntPtr unused);
 [DllImport("ole32.dll")]private static extern int PropVariantClear(ref PropVariant value);
 [STAThread]private static int Main(string[] args){
  Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
  try {
   if(args.Contains("--open")){Process.Start(new ProcessStartInfo(PluginLink){UseShellExecute=true});return 0;}
   if(args.Contains("--implementation")){Console.WriteLine(Json.Serialize(new{implementation="windows-framework-exe",helperVersion=NotificationPolicy.Version}));return 0;}
   Payload payload=null;
   if(!args.Contains("--status")&&!args.Contains("--register")&&!args.Contains("--check")){
    Stage="校验通知参数";
    string input=Console.In.ReadToEnd();
    if(Encoding.UTF8.GetByteCount(input)>16384)throw new InvalidOperationException("通知内容过长。");
    payload=Json.Deserialize<Payload>(input);Validate(payload);
   }
   if(args.Contains("--validate")){Console.WriteLine("{\"validated\":true}");return 0;}
   if(new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))throw new InvalidOperationException("请使用普通权限运行 Codex，以显示 Windows 通知。");
   string shortcut=System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),ShortcutName);
   if(!args.Contains("--status"))RegisterIdentity(shortcut);
   if(args.Contains("--register")){Console.WriteLine(Json.Serialize(new{registered=true,appId=AppId,implementation="windows-framework-exe",helperVersion=NotificationPolicy.Version,shortcutVerified=ShortcutCurrent(shortcut,Process.GetCurrentProcess().MainModule.FileName)}));return 0;}
   ToastNotifier notifier=null;
   Stage="创建通知通道";
   if(args.Contains("--status")){
    string observed="Unavailable",error=null;string[] tags=new string[0];
    try{notifier=ToastNotificationManager.CreateToastNotifier(AppId);Stage="读取通知设置";observed=NotificationPolicy.Setting(delegate{return notifier.Setting.ToString();});Stage="读取通知历史";try{tags=ToastNotificationManager.History.GetHistory(AppId).Select(n=>n.Tag).ToArray();}catch(Exception historyError){if(unchecked((uint)historyError.HResult)!=0x80070490)throw;}}catch(Exception ex){error=NotificationPolicy.Error(Stage,ex);}
    Console.WriteLine(Json.Serialize(new{setting=observed,settingKnown=observed!="Unavailable",appId=AppId,implementation="windows-framework-exe",helperVersion=NotificationPolicy.Version,shortcutVerified=ShortcutCurrent(shortcut,Process.GetCurrentProcess().MainModule.FileName),ownNotificationTags=tags,error=error}));return 0;
   }
   notifier=NotificationPolicy.Create(delegate{return ToastNotificationManager.CreateToastNotifier(AppId);},delegate{NotifyShortcut(shortcut,false);},Thread.Sleep);
   Stage="读取通知设置";Exception settingQueryError=null;
   string setting=NotificationPolicy.Setting(delegate{return notifier.Setting.ToString();},delegate(Exception error){settingQueryError=error;});
   if(args.Contains("--check")){Console.WriteLine(Json.Serialize(new{channelCreated=true,setting=setting,settingKnown=setting!="Unavailable",settingQueryErrorType=settingQueryError==null?null:settingQueryError.GetType().FullName,appId=AppId,implementation="windows-framework-exe",helperVersion=NotificationPolicy.Version,shortcutVerified=ShortcutCurrent(shortcut,Process.GetCurrentProcess().MainModule.FileName)}));return 0;}
   Stage="准备通知内容";
   var xml=new XElement("toast",new XAttribute("activationType","protocol"),new XAttribute("launch",PluginLink),
    new XElement("visual",new XElement("binding",new XAttribute("template","ToastGeneric"),new XElement("text",payload.Title),new XElement("text",payload.Body))),
    new XElement("actions",new XElement("action",new XAttribute("content","打开插件"),new XAttribute("activationType","protocol"),new XAttribute("arguments",PluginLink))));
   var document=new Windows.Data.Xml.Dom.XmlDocument();document.LoadXml(xml.ToString());
   var toast=new ToastNotification(document){Tag=payload.Tag,Group="reset-creator",SuppressPopup=false};
   Stage="发送 Windows 通知";
   notifier.Show(toast);Console.WriteLine(Json.Serialize(new{accepted=true,setting=setting,appId=AppId,helperVersion=NotificationPolicy.Version}));return 0;
  }catch(Exception ex){Console.Error.WriteLine(NotificationPolicy.Error(Stage,ex));return 1;}
 }
 private static void Validate(Payload p){
  if(p==null||String.IsNullOrWhiteSpace(p.Title)||String.IsNullOrWhiteSpace(p.Body)||String.IsNullOrWhiteSpace(p.Tag)||p.Title.Length>120||p.Body.Length>1000||!Regex.IsMatch(p.Tag,"^[a-zA-Z0-9_-]{1,64}$"))throw new InvalidOperationException("通知内容无效。");
  XmlConvert.VerifyXmlChars(p.Title);XmlConvert.VerifyXmlChars(p.Body);
 }
 private static void RegisterIdentity(string shortcut){
  Stage="设置当前用户通知标识";
  Marshal.ThrowExceptionForHR(SetCurrentProcessExplicitAppUserModelID(AppId));
  string executable=Process.GetCurrentProcess().MainModule.FileName;
  Stage="注册开始菜单通知入口";
  if(String.IsNullOrWhiteSpace(Environment.GetFolderPath(Environment.SpecialFolder.Programs)))throw new InvalidOperationException("无法定位当前用户的开始菜单目录。");
  bool existed=System.IO.File.Exists(shortcut),changed=!ShortcutCurrent(shortcut,executable);
  if(changed){
  System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(shortcut));
  var link=new ShellLink();
  try{
   var shell=(IShellLinkW)link;shell.SetPath(executable);shell.SetArguments("--open");shell.SetDescription("打开 Codex 重置卡防过期提醒");shell.SetIconLocation(executable,0);
   shell.SetWorkingDirectory(AppDomain.CurrentDomain.BaseDirectory);
   var value=new PropVariant{Type=31,Pointer=Marshal.StringToCoTaskMemUni(AppId)};
   var key=AppIdKey;
   try{((IPropertyStore)link).SetValue(ref key,ref value);}
   finally{Marshal.FreeCoTaskMem(value.Pointer);}
   var activator=new PropVariant{Type=72,Pointer=Marshal.AllocCoTaskMem(16)};
   try{Marshal.StructureToPtr(StubActivator,activator.Pointer,false);key=ActivatorKey;((IPropertyStore)link).SetValue(ref key,ref activator);((IPropertyStore)link).Commit();((IPersistFile)link).Save(shortcut,true);}
   finally{Marshal.FreeCoTaskMem(activator.Pointer);}
  }finally{Marshal.ReleaseComObject(link);}
  }
  Stage="注册当前用户通知名称";
  using(var registration=Registry.CurrentUser.CreateSubKey(@"Software\Classes\AppUserModelId\"+AppId)){
   registration.SetValue("DisplayName","重置卡防过期提醒");registration.SetValue("IconUri",System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"notification-icon.png"));
  }
  Stage="刷新通知入口";
  if(changed)NotifyShortcut(shortcut,!existed);
  if(!ShortcutCurrent(shortcut,executable))throw new InvalidOperationException("开始菜单通知入口校验失败。");
 }
 private static void NotifyShortcut(string shortcut,bool created){SHChangeNotify(created?0x00000002u:0x00002000u,0x00001005u,shortcut,IntPtr.Zero);}
 private static bool ShortcutCurrent(string shortcut,string executable){
  if(!System.IO.File.Exists(shortcut))return false;
  var link=new ShellLink();
  try{
   ((IPersistFile)link).Load(shortcut,0);var shell=(IShellLinkW)link;
   var path=new StringBuilder(32768);shell.GetPath(path,path.Capacity,IntPtr.Zero,0);
   var arguments=new StringBuilder(1024);shell.GetArguments(arguments,arguments.Capacity);
   if(!String.Equals(path.ToString(),executable,StringComparison.OrdinalIgnoreCase)||arguments.ToString()!="--open")return false;
   var key=AppIdKey;PropVariant value;((IPropertyStore)link).GetValue(ref key,out value);
   try{if(value.Type!=31||Marshal.PtrToStringUni(value.Pointer)!=AppId)return false;}finally{PropVariantClear(ref value);}
   key=ActivatorKey;((IPropertyStore)link).GetValue(ref key,out value);
   try{return value.Type==72&&value.Pointer!=IntPtr.Zero&&(Guid)Marshal.PtrToStructure(value.Pointer,typeof(Guid))==StubActivator;}finally{PropVariantClear(ref value);}
  }catch{return false;}finally{Marshal.ReleaseComObject(link);}
 }
 [ComImport,Guid("00021401-0000-0000-C000-000000000046")]private class ShellLink{}
 [ComImport,Guid("000214F9-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface IShellLinkW{
  void GetPath([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder path,int length,IntPtr data,uint flags);void GetIDList(out IntPtr list);void SetIDList(IntPtr list);
  void GetDescription([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder text,int length);void SetDescription([MarshalAs(UnmanagedType.LPWStr)]string text);
  void GetWorkingDirectory([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder text,int length);void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)]string text);
  void GetArguments([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder text,int length);void SetArguments([MarshalAs(UnmanagedType.LPWStr)]string text);
  void GetHotkey(out short value);void SetHotkey(short value);void GetShowCmd(out int value);void SetShowCmd(int value);
  void GetIconLocation([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder path,int length,out int index);void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)]string path,int index);
  void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)]string path,uint reserved);void Resolve(IntPtr window,uint flags);void SetPath([MarshalAs(UnmanagedType.LPWStr)]string path);
 }
 [StructLayout(LayoutKind.Sequential)]private struct PropertyKey{public Guid FormatId;public uint Id;}
 [StructLayout(LayoutKind.Explicit,Size=24)]private struct PropVariant{[FieldOffset(0)]public ushort Type;[FieldOffset(8)]public IntPtr Pointer;}
 [ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]private interface IPropertyStore{
  void GetCount(out uint count);void GetAt(uint index,out PropertyKey key);void GetValue(ref PropertyKey key,out PropVariant value);void SetValue(ref PropertyKey key,ref PropVariant value);void Commit();
 }
}
