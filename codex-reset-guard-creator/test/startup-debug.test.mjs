import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StartupDebug} from '../src/startup-debug.mjs';

async function fixture(){
  const directory=await mkdtemp(join(tmpdir(),'reset-startup-debug-'));
  const accountPath=join(directory,'state.json');
  await writeFile(accountPath,JSON.stringify({notifyBefore:'6小时',useBefore:'永不使用',attempts:{existing:{done:true}},reminderReceipts:{old:{attemptedAt:123}}}));
  const accountBefore=await readFile(accountPath);
  let presence={active:true,processKey:'client-A'},failure=false,clock=100000,observations=0;
  const sends=[];
  const observe=async()=>{observations++;return presence;};
  const notify=async payload=>{sends.push(payload);if(failure)throw new Error('Windows 通知已关闭');return{accepted:true};};
  const create=()=>new StartupDebug(directory,observe,notify,()=>clock);
  return{directory,accountPath,accountBefore,sends,create,manager:create(),observe,notify,
    get observations(){return observations;},presence:p=>{presence=p;},fail:()=>{failure=true;},now:n=>{clock=n;}};
}

test('startup debug defaults off, does not inspect the client or create test settings merely by reading',async()=>{
  const f=await fixture();assert.deepEqual(await f.manager.status(),{enabled:false,lastAttempt:null});
  await f.manager.tick();assert.equal(f.observations,0);assert.equal(f.sends.length,0);
  await assert.rejects(readFile(join(f.directory,'Debug/startup-notification.json')),{code:'ENOENT'});
});
test('enabling persists but never sends in the current client; fresh worker and repeated reads also do not send',async()=>{
  const f=await fixture();await f.manager.setEnabled(true);
  await f.manager.tick();await f.manager.status();await f.create().tick();
  assert.equal(f.sends.length,0);assert.equal((await f.create().status()).enabled,true);
  assert.deepEqual(await readFile(f.accountPath),f.accountBefore);
});
test('each genuine client launch sends once even with concurrent ticks, worker restarts, and returning to an older observed process',async()=>{
  const f=await fixture();await f.manager.setEnabled(true);
  f.presence({active:true,processKey:'client-B'});
  await Promise.all([f.manager.tick(),f.manager.tick(),f.manager.tick()]);
  assert.equal(f.sends.length,1);assert.match(f.sends[0].title,/Codex 启动测试/);
  assert.equal((await f.manager.status()).lastAttempt.status,'accepted');
  await f.create().tick();assert.equal(f.sends.length,1);
  f.presence({active:true,processKey:'client-C'});await f.create().tick();assert.equal(f.sends.length,2);
  f.presence({active:true,processKey:'client-B'});await f.create().tick();assert.equal(f.sends.length,2);
  assert.deepEqual(await readFile(f.accountPath),f.accountBefore);
});
test('closed or uncertain presence never claims a launch; a later confirmed launch still sends',async()=>{
  const f=await fixture();await f.manager.setEnabled(true);
  for(const p of [{active:false},{active:null},{active:true,processKey:null}]){f.presence(p);await f.manager.tick();}
  assert.equal(f.sends.length,0);f.presence({active:true,processKey:'client-B'});await f.manager.tick();assert.equal(f.sends.length,1);
});
test('disabling survives restart and re-enabling waits for a later client launch',async()=>{
  const f=await fixture();await f.manager.setEnabled(true);await f.manager.setEnabled(false);
  f.presence({active:true,processKey:'client-B'});const m=f.create();await m.tick();assert.equal(f.sends.length,0);
  await m.setEnabled(true);await m.tick();assert.equal(f.sends.length,0);
  f.presence({active:true,processKey:'client-C'});await m.tick();assert.equal(f.sends.length,1);
});
test('failed notification is not retried this launch, including after a worker restart; next launch can test again',async()=>{
  const f=await fixture();await f.manager.setEnabled(true);f.fail();f.presence({active:true,processKey:'client-B'});
  await f.manager.tick();await f.manager.tick();await f.create().tick();assert.equal(f.sends.length,1);
  assert.match((await f.manager.status()).lastAttempt.error,/Windows 通知已关闭/);
  f.presence({active:true,processKey:'client-C'});await f.create().tick();assert.equal(f.sends.length,2);
});
test('a crash after submitting to Windows leaves the durable claim and cannot send again',async()=>{
  const f=await fixture();await f.manager.setEnabled(true);f.presence({active:true,processKey:'client-B'});
  const stuck=new StartupDebug(f.directory,f.observe,async payload=>{f.sends.push(payload);return new Promise(()=>{});});
  void stuck.tick();
  for(let i=0;i<50&&!f.sends.length;i++)await new Promise(resolve=>setTimeout(resolve,2));
  assert.equal(f.sends.length,1);await f.create().tick();assert.equal(f.sends.length,1);
  assert.equal((await f.create().status()).lastAttempt.status,'attempting');
});
test('disable requested during presence detection prevents submission and requires no account connection',async()=>{
  const f=await fixture();await f.manager.setEnabled(true);f.presence({active:true,processKey:'client-B'});
  let release,started;
  const observed=new Promise(resolve=>{started=resolve;});
  const m=new StartupDebug(f.directory,async()=>{started();return new Promise(resolve=>{release=resolve;});},f.notify);
  const tick=m.tick();await observed;const disabled=m.setEnabled(false);release({active:true,processKey:'client-B'});
  await Promise.all([tick,disabled]);assert.equal(f.sends.length,0);assert.equal((await m.status()).enabled,false);
});
test('invalid or uncertain enable fails closed; corrupt settings cannot trigger a notification',async()=>{
  const f=await fixture();await assert.rejects(f.manager.setEnabled('true'),/布尔值/);
  f.presence({active:null,processKey:null});await assert.rejects(f.manager.setEnabled(true),/无法确认/);
  assert.equal((await f.manager.status()).enabled,false);
  await mkdir(join(f.directory,'Debug'),{recursive:true});
  await writeFile(join(f.directory,'Debug/startup-notification.json'),JSON.stringify({version:1,enabled:'true',handledProcessKeys:[],lastAttempt:null}));
  await assert.rejects(f.create().tick(),/损坏/);assert.equal(f.sends.length,0);
});
test('worker shutdown blocks the test without clearing the persistent switch or previous receipts',async()=>{
  const f=await fixture();await f.manager.setEnabled(true);f.presence({active:true,processKey:'client-B'});
  f.manager.stop();await f.manager.tick();assert.equal(f.sends.length,0);
  const restarted=f.create();await restarted.tick();assert.equal(f.sends.length,1);
});
test('a later disable request cannot be overwritten by an earlier in-flight enable',async()=>{
 const f=await fixture();let release,entered,calls=0;
 const started=new Promise(resolve=>{entered=resolve;});
 const m=new StartupDebug(f.directory,async()=>{
  calls++;if(calls===1){entered();return new Promise(resolve=>{release=resolve;});}
  return{active:true,processKey:'client-B'};
 },f.notify);
 const enable=m.setEnabled(true);await started;
 const tick=m.tick(),disable=m.setEnabled(false);release({active:true,processKey:'client-A'});
 await Promise.all([enable,tick,disable]);assert.equal(calls,1);assert.equal(f.sends.length,0);assert.equal((await m.status()).enabled,false);
});
