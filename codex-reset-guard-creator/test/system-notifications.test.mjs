import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {notificationArguments,systemPowerShell} from '../src/windows-notifications.mjs';
const script=fileURLToPath(new URL('../notification-helper/notify.ps1',import.meta.url));
function validate(payload){return new Promise((resolve,reject)=>{
 const child=spawn(systemPowerShell(),notificationArguments(script,'validate'),{windowsHide:true,env:{...process.env,DOTNET_ROOT:'C:\\not-installed',DOTNET_ROOT_X64:'C:\\not-installed'},stdio:['pipe','pipe','pipe']});
 let out='',err='';const timer=setTimeout(()=>{child.kill();reject(Error('Notification validation timed out'));},15000);
 child.on('error',reject);child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
 child.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});child.stdin.end(typeof payload==='string'?payload:JSON.stringify(payload));
});}
test('system notification validates Unicode, quotes and XML without registering or sending',{skip:process.platform!=='win32'},async()=>{
 const result=await validate({title:'中文 " & <标题>',body:'内容\n$(not-code); <b>不是代码</b> 😀',tag:'safe_tag-1'});
 assert.equal(result.code,0,result.err);assert.deepEqual(JSON.parse(result.out),{validated:true});
});
test('invalid notification input fails before Windows registration or display',{skip:process.platform!=='win32'},async()=>{
 for(const payload of ['{bad json}',{title:[],body:'body',tag:'tag'},{title:'t',body:'b',tag:'bad&tag'},{title:'t'.repeat(121),body:'b',tag:'tag'},{title:'t',body:'bad\u0001xml',tag:'tag'}]){
  const result=await validate(payload);assert.notEqual(result.code,0);assert.equal(result.out,'');assert.ok(result.err.trim());
 }
});
test('PowerShell is addressed by OS path and notification values remain stdin data',()=>{
 assert.match(systemPowerShell(),/System32[\\/]WindowsPowerShell/);
 assert.deepEqual(notificationArguments('C:\\插件 空格\\notify.ps1','validate').slice(-4),['-File','C:\\插件 空格\\notify.ps1','-Mode','validate']);
});
test('notification payload has no modern .NET assemblies and keeps the existing identity',async()=>{
 const source=await readFile(script,'utf8');assert.match(source,/Codex\.ResetGuard\.Creator\.Notifications/);
 assert.match(source,/codex-reset-guard-creator@reset-guard-creator-local/);
 const manifest=JSON.parse(await readFile(new URL('../runtime/windows-x64/manifest.json',import.meta.url)));
 assert.equal(manifest.notificationImplementation,'windows-powershell-system-api');
 assert.ok(manifest.files.every(f=>f.path.startsWith('node/')));
 assert.equal(manifest.dotnetVersion,undefined);
});
