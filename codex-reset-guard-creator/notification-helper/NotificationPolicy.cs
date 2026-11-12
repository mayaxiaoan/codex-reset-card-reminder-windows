using System;
using System.Runtime.InteropServices;

internal static class NotificationPolicy {
 internal const string Version="1.7.1";
 internal static T Create<T>(Func<T> create,Action refreshShortcut,Action<int> wait){
  for(int attempt=0;;attempt++){
   try{return create();}
   catch(Exception ex){
    if(unchecked((uint)ex.HResult)!=0x80070490||attempt>=11)throw;
    if(attempt==0)refreshShortcut();
    wait(250);
   }
  }
 }
 internal static string Setting(Func<string> read,Action<Exception> unavailable=null){
  string setting;
  try{setting=read();}
  catch(Exception ex){
   // WinRT can map this HRESULT to System.Exception, not COMException. A new app
   // may have no per-app settings record yet; this is not a failed submission.
   if(unchecked((uint)ex.HResult)!=0x80070490)throw;
   if(unavailable!=null)unavailable(ex);
   return "Unavailable";
  }
  if(setting!="Enabled")throw new InvalidOperationException("Windows 通知未启用："+setting+"。请检查此应用的系统通知设置。");
  return setting;
 }
 internal static string Error(string stage,Exception error){
  string code="0x"+unchecked((uint)error.HResult).ToString("X8");
  string detail=unchecked((uint)error.HResult)==0x80070490
   ? "Windows 通知接口未找到所需项目。"+error.Message
   : String.IsNullOrWhiteSpace(error.Message)?"Windows 通知调用失败。":error.Message;
  return String.Format("{0} [步骤：{1}；HRESULT：{2}；通知组件：{3}]",detail,stage,code,Version);
 }
}
