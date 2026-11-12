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
using Microsoft.Win32;
using Windows.Data.Xml.Dom;
using Windows.UI.Notifications;
[assembly:System.Reflection.AssemblyVersion("1.6.1.0")]
[assembly:System.Reflection.AssemblyFileVersion("1.6.1.0")]
[assembly:System.Reflection.AssemblyTitle("重置卡防过期提醒通知")]
[assembly:System.Reflection.AssemblyProduct("重置卡防过期提醒")]

// Uses the Windows-provided .NET Framework and WinRT projections.
// No PowerShell child process, downloader, or modern .NET runtime is used.
internal static class Program {
 private const string AppId="Codex.ResetGuard.Creator.Notifications";
 private const string PluginLink="codex://plugins/codex-reset-guard-creator@reset-guard-creator-local";
 private static readonly JavaScriptSerializer Json=new JavaScriptSerializer {MaxJsonLength=16384,RecursionLimit=8};
 public class Payload {public string Title {get;set;} public string Body {get;set;} public string Tag {get;set;}}
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)]private static extern int SetCurrentProcessExplicitAppUserModelID(string id);
 [STAThread]private static int Main(string[] args){
  Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
  try {
   if(args.Contains("--open")){Process.Start(new ProcessStartInfo(PluginLink){UseShellExecute=true});return 0;}
   if(args.Contains("--implementation")){Console.WriteLine("{\"implementation\":\"windows-framework-exe\"}");return 0;}
   Payload payload=null;
   if(!args.Contains("--status")&&!args.Contains("--register")){
    string input=Console.In.ReadToEnd();
    if(Encoding.UTF8.GetByteCount(input)>16384)throw new InvalidOperationException("通知内容过长。");
    payload=Json.Deserialize<Payload>(input);Validate(payload);
   }
   if(args.Contains("--validate")){Console.WriteLine("{\"validated\":true}");return 0;}
   if(new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))throw new InvalidOperationException("请使用普通权限运行 Codex，以显示 Windows 通知。");
   if(!args.Contains("--status"))RegisterIdentity();
   if(args.Contains("--register")){Console.WriteLine(Json.Serialize(new{registered=true,appId=AppId,implementation="windows-framework-exe"}));return 0;}
   var notifier=ToastNotificationManager.CreateToastNotifier(AppId);
   string setting="Unavailable";
   try{setting=notifier.Setting.ToString();}catch(COMException ex){if(unchecked((uint)ex.HResult)!=0x80070490)throw;}
   if(args.Contains("--status")){Console.WriteLine(Json.Serialize(new{setting=setting,appId=AppId,implementation="windows-framework-exe",ownNotificationTags=ToastNotificationManager.History.GetHistory(AppId).Select(n=>n.Tag).ToArray()}));return 0;}
   if(setting!="Unavailable"&&setting!="Enabled")throw new InvalidOperationException("Windows 通知未启用："+setting);
   var xml=new XElement("toast",new XAttribute("activationType","protocol"),new XAttribute("launch",PluginLink),
    new XElement("visual",new XElement("binding",new XAttribute("template","ToastGeneric"),new XElement("text",payload.Title),new XElement("text",payload.Body))),
    new XElement("actions",new XElement("action",new XAttribute("content","打开插件"),new XAttribute("activationType","protocol"),new XAttribute("arguments",PluginLink))));
   var document=new Windows.Data.Xml.Dom.XmlDocument();document.LoadXml(xml.ToString());
   var toast=new ToastNotification(document){Tag=payload.Tag,Group="reset-creator",SuppressPopup=false};
   notifier.Show(toast);Console.WriteLine(Json.Serialize(new{accepted=true,setting=setting,appId=AppId}));return 0;
  }catch(Exception ex){Console.Error.WriteLine(String.IsNullOrWhiteSpace(ex.Message)?"Windows 通知调用失败。":ex.Message);return 1;}
 }
 private static void Validate(Payload p){
  if(p==null||String.IsNullOrWhiteSpace(p.Title)||String.IsNullOrWhiteSpace(p.Body)||String.IsNullOrWhiteSpace(p.Tag)||p.Title.Length>120||p.Body.Length>1000||!Regex.IsMatch(p.Tag,"^[a-zA-Z0-9_-]{1,64}$"))throw new InvalidOperationException("通知内容无效。");
  XmlConvert.VerifyXmlChars(p.Title);XmlConvert.VerifyXmlChars(p.Body);
 }
 private static void RegisterIdentity(){
  Marshal.ThrowExceptionForHR(SetCurrentProcessExplicitAppUserModelID(AppId));
  string executable=Process.GetCurrentProcess().MainModule.FileName;
  string shortcut=System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs),"重置卡防过期提醒通知.lnk");
  var link=new ShellLink();
  try{
   var shell=(IShellLinkW)link;shell.SetPath(executable);shell.SetArguments("--open");shell.SetDescription("打开 Codex 重置卡防过期提醒");shell.SetIconLocation(executable,0);
   var key=new PropertyKey{FormatId=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),Id=5};
   var value=new PropVariant{Type=31,Pointer=Marshal.StringToCoTaskMemUni(AppId)};
   try{((IPropertyStore)link).SetValue(ref key,ref value);((IPropertyStore)link).Commit();((IPersistFile)link).Save(shortcut,true);}
   finally{Marshal.FreeCoTaskMem(value.Pointer);}
  }finally{Marshal.ReleaseComObject(link);}
  using(var registration=Registry.CurrentUser.CreateSubKey(@"Software\Classes\AppUserModelId\"+AppId)){
   registration.SetValue("DisplayName","重置卡防过期提醒");registration.SetValue("IconUri",System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"notification-icon.png"));
  }
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
