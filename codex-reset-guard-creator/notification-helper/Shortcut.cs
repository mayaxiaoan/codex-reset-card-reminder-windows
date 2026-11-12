using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

// Uses the .NET Framework already provided with Windows PowerShell 5.1.
// No modern .NET runtime or third-party assembly is loaded or distributed.
public static class ResetGuardShortcut {
 [DllImport("shell32.dll",CharSet=CharSet.Unicode)] private static extern int SetCurrentProcessExplicitAppUserModelID(string id);
 public static void Register(string shortcut,string executable,string arguments,string icon,string appId) {
  Marshal.ThrowExceptionForHR(SetCurrentProcessExplicitAppUserModelID(appId));
  var link=new ShellLink();
  try {
   var shell=(IShellLinkW)link;
   shell.SetPath(executable); shell.SetArguments(arguments);
   shell.SetDescription("Open Codex reset-card reminder"); shell.SetIconLocation(icon,0);
   var key=new PropertyKey {FormatId=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),Id=5};
   var value=new PropVariant {Type=31,Pointer=Marshal.StringToCoTaskMemUni(appId)};
   try {((IPropertyStore)link).SetValue(ref key,ref value);((IPropertyStore)link).Commit();((IPersistFile)link).Save(shortcut,true);}
   finally {Marshal.FreeCoTaskMem(value.Pointer);}
  } finally {Marshal.ReleaseComObject(link);}
 }
 [ComImport,Guid("00021401-0000-0000-C000-000000000046")] private class ShellLink { }
 [ComImport,Guid("000214F9-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 private interface IShellLinkW {
  void GetPath([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder path,int length,IntPtr data,uint flags);
  void GetIDList(out IntPtr list);void SetIDList(IntPtr list);
  void GetDescription([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder text,int length);
  void SetDescription([MarshalAs(UnmanagedType.LPWStr)]string text);
  void GetWorkingDirectory([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder text,int length);
  void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)]string text);
  void GetArguments([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder text,int length);
  void SetArguments([MarshalAs(UnmanagedType.LPWStr)]string text);
  void GetHotkey(out short hotkey);void SetHotkey(short hotkey);void GetShowCmd(out int command);void SetShowCmd(int command);
  void GetIconLocation([Out,MarshalAs(UnmanagedType.LPWStr)]StringBuilder path,int length,out int index);
  void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)]string path,int index);
  void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)]string path,uint reserved);void Resolve(IntPtr window,uint flags);
  void SetPath([MarshalAs(UnmanagedType.LPWStr)]string path);
 }
 [StructLayout(LayoutKind.Sequential)]private struct PropertyKey {public Guid FormatId;public uint Id;}
 [StructLayout(LayoutKind.Explicit,Size=24)]private struct PropVariant {[FieldOffset(0)]public ushort Type;[FieldOffset(8)]public IntPtr Pointer;}
 [ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
 private interface IPropertyStore {
  void GetCount(out uint count);void GetAt(uint index,out PropertyKey key);void GetValue(ref PropertyKey key,out PropVariant value);
  void SetValue(ref PropertyKey key,ref PropVariant value);void Commit();
 }
}
