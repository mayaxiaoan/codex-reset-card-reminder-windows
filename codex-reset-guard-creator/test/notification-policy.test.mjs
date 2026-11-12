import test,{before}from'node:test';
import assert from'node:assert/strict';
import{mkdtemp,writeFile}from'node:fs/promises';
import{execFile}from'node:child_process';
import{promisify}from'node:util';
import{join}from'node:path';
import{tmpdir}from'node:os';
import{fileURLToPath}from'node:url';
const run=promisify(execFile),windows=process.platform==='win32';let executable;
if(windows)before(async()=>{
 const root=await mkdtemp(join(tmpdir(),'reset-notification-policy-'));executable=join(root,'policy-test.exe');
 const source=join(root,'PolicyTest.cs');
 await writeFile(source,`using System;using System.Runtime.InteropServices;
class MissingWinRt : Exception { public MissingWinRt(){HResult=unchecked((int)0x80070490);} }
class TestPolicy {
 static void Check(bool ok){if(!ok)throw new Exception("policy assertion failed");}
 static int Main(string[] args){try{
 int calls=0,repairs=0,waits=0;Action repair=()=>repairs++;Action<int> wait=ms=>{Check(ms==250);waits++;};
 if(args[0]=="ready"){Check(NotificationPolicy.Create<string>(()=>{calls++;return "Enabled";},repair,wait)=="Enabled");Check(calls==1&&repairs==0&&waits==0);}
 else if(args[0]=="missing-then-ready"){Check(NotificationPolicy.Create<string>(()=>{calls++;if(calls<3)throw new COMException("missing",unchecked((int)0x80070490));return "Enabled";},repair,wait)=="Enabled");Check(calls==3&&repairs==1&&waits==2);}
 else if(args[0]=="permanent-missing"){try{NotificationPolicy.Create<string>(()=>{calls++;throw new COMException("missing",unchecked((int)0x80070490));},repair,wait);throw new Exception("accepted missing identity");}catch(COMException ex){Check(unchecked((uint)ex.ErrorCode)==0x80070490);Check(calls==12&&repairs==1&&waits==11);Check(NotificationPolicy.Error("read-setting",ex).Contains("0x80070490"));Check(NotificationPolicy.Error("read-setting",ex).Contains("read-setting"));}}
 else if(args[0]=="disabled"){foreach(string s in new[]{"DisabledForUser","DisabledForApplication","DisabledByGroupPolicy","DisabledByManifest"}){try{NotificationPolicy.Setting(()=>{calls++;return s;});throw new Exception("ignored notification setting");}catch(InvalidOperationException ex){Check(ex.Message.Contains(s));}}Check(calls==4&&repairs==0&&waits==0);}
 else if(args[0]=="other-error"){try{NotificationPolicy.Create<string>(()=>{calls++;throw new COMException("denied",unchecked((int)0x80070005));},repair,wait);throw new Exception("ignored access failure");}catch(COMException ex){Check(unchecked((uint)ex.ErrorCode)==0x80070005);Check(calls==1&&repairs==0&&waits==0);}}
 else if(args[0]=="fresh-setting"){foreach(Exception error in new Exception[]{new COMException("missing",unchecked((int)0x80070490)),new MissingWinRt()}){Exception captured=null;Check(NotificationPolicy.Setting(()=>{throw error;},e=>captured=e)=="Unavailable");Check(Object.ReferenceEquals(captured,error));}}
 else throw new Exception("unknown test");
 Console.WriteLine("ok");return 0;
 }catch(Exception ex){Console.Error.WriteLine(ex.Message);return 1;}}
}`);
 const compiler=join(process.env.SystemRoot||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
 await run(compiler,['/nologo','/target:exe','/platform:x64','/out:'+executable,source,fileURLToPath(new URL('../notification-helper/NotificationPolicy.cs',import.meta.url))],{windowsHide:true});
});
for(const[name,scenario]of [
 ['ready notification endpoint opens without repair or delay','ready'],
 ['new notification registration waits for 0x80070490 to clear before allowing submission','missing-then-ready'],
 ['persistent missing registration stays a failure with original HRESULT and phase','permanent-missing'],
 ['disabled notifications are respected without retrying or changing settings','disabled'],
 ['unrelated COM failures fail immediately without registration retries','other-error'],
 ['fresh app settings query accepts only missing-record HRESULT, including WinRT-mapped System.Exception','fresh-setting'],
])test(name,{skip:!windows},async()=>{const result=await run(executable,[scenario],{windowsHide:true});assert.equal(result.stdout.trim(),'ok');});
