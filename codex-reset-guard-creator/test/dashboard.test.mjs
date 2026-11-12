import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../ui/dashboard.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const state = () => ({ supported:true, notifyBefore:'12小时', useBefore:'永不使用', cards:[], detailsAvailable:true, notifications:[], unreadCount:0 });
async function fixture({ fail = false, mac = false, pause = false, debugBackend={enabled:false,lastAttempt:null}, debugFail=false,debugPause=false } = {}) {
  const elements = new Map(), calls = [], timers = [], requests=[];
  const clock={now:10000};class TestDate extends Date{static now(){return clock.now;}}
  const element = () => ({ hidden:false, disabled:true, value:'', textContent:'', append(){}, replaceChildren(){} });
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id,element()); return elements.get(id); }, createElement:element };
  let release,releaseDebug;
  class App {
    async connect() {}
    async callServerTool({name,arguments:args}) {
      calls.push(name);
      requests.push({name,args});
      if(name==='reset_guard_debug_read')return{structuredContent:structuredClone(debugBackend)};
      if(name==='reset_guard_debug_update'){
        if(debugPause)await new Promise(resolve=>{releaseDebug=resolve;});
        if(debugFail)return{isError:true,content:[{type:'text',text:'无法确认当前 Codex 启动身份'}]};
        debugBackend.enabled=args.enabled;return{structuredContent:structuredClone(debugBackend)};
      }
      if (name === 'reset_guard_test_notification') {
        if (pause) await new Promise(resolve => { release=resolve; });
        if (fail) return { isError:true, content:[{type:'text',text:'Windows 通知未启用'}] };
      }
      return { structuredContent:state() };
    }
  }
  await new AsyncFunction('App','VERSION','document','navigator','setInterval','Date',source)(App,'test',document,{platform:mac?'MacIntel':'Win32'},callback=>timers.push(callback),TestDate);
  return { elements,calls,timers,requests,clock,debugBackend,release:()=>release(),releaseDebug:()=>releaseDebug() };
}
test('test notification sends only on click and repeated clicks are ignored while sending', async () => {
  const f=await fixture({pause:true}), button=f.elements.get('test-notification');
  assert.deepEqual(f.calls,['reset_guard_status']);
  await f.timers[0]();
  assert.ok(!f.calls.includes('reset_guard_test_notification'));
  const pending=button.onclick();
  assert.equal(button.disabled,true); assert.equal(button.textContent,'发送中…');
  button.onclick();
  assert.equal(f.calls.filter(x=>x==='reset_guard_test_notification').length,1);
  f.release(); await pending;
  assert.equal(button.disabled,false); assert.equal(button.textContent,'通知测试');
  assert.equal(f.elements.get('notification-test-result').hidden,false);
  assert.match(f.elements.get('notification-test-result').textContent,/已提交 Windows/);
  assert.equal(f.elements.get('remind').value,'12小时');
  assert.equal(f.elements.get('protect').value,'永不使用');
});
test('test notification displays a failed send and remains available for retry', async () => {
  const f=await fixture({fail:true}), button=f.elements.get('test-notification');
  await button.onclick();
  assert.match(f.elements.get('error').textContent,/Windows 通知未启用/);
  assert.equal(f.elements.get('notification-test-result').hidden,true);
  assert.equal(button.disabled,false); assert.equal(button.textContent,'通知测试');
});
test('test notification is disabled on unsupported Mac and page startup sends nothing', async () => {
  const f=await fixture({mac:true});
  assert.equal(f.elements.get('test-notification').disabled,true);
  assert.deepEqual(f.calls,[]);
});
async function seven(f){for(let i=0;i<7;i++)await f.elements.get('debug-trigger').onclick();}
test('debug panel requires seven consecutive title clicks; slow separate clicks do not accumulate',async()=>{
 const f=await fixture();assert.equal(f.elements.get('debug-panel').hidden,true);
 for(let i=0;i<6;i++)await f.elements.get('debug-trigger').onclick();
 assert.equal(f.elements.get('debug-panel').hidden,true);
 f.clock.now+=1001;await f.elements.get('debug-trigger').onclick();assert.equal(f.elements.get('debug-panel').hidden,true);
 for(let i=0;i<6;i++)await f.elements.get('debug-trigger').onclick();
 assert.equal(f.elements.get('debug-panel').hidden,false);assert.equal(f.calls.filter(x=>x==='reset_guard_debug_read').length,1);
 assert.ok(!f.calls.includes('reset_guard_debug_update'));assert.ok(!f.calls.includes('reset_guard_test_notification'));
});
test('hiding or reopening the debug panel and opening a new page never disables an enabled startup test',async()=>{
 const backend={enabled:true,lastAttempt:{status:'accepted',attemptedAt:1000}};
 const f=await fixture({debugBackend:backend});await seven(f);
 assert.equal(f.elements.get('debug-startup-notification').checked,true);await seven(f);
 assert.equal(f.elements.get('debug-panel').hidden,true);assert.equal(backend.enabled,true);
 await seven(f);assert.equal(f.elements.get('debug-startup-notification').checked,true);
 const reopened=await fixture({debugBackend:backend});assert.equal(reopened.elements.get('debug-panel').hidden,true);
 await seven(reopened);assert.equal(reopened.elements.get('debug-startup-notification').checked,true);
 assert.ok(!f.calls.includes('reset_guard_debug_update'));assert.ok(!reopened.calls.includes('reset_guard_debug_update'));
});
test('debug switch saves only its own setting, can be disabled, and restores value when saving fails',async()=>{
 const f=await fixture();await seven(f);const input=f.elements.get('debug-startup-notification');
 input.checked=true;await input.onchange();assert.equal(f.debugBackend.enabled,true);
 input.checked=false;await input.onchange();assert.equal(f.debugBackend.enabled,false);
 assert.deepEqual(f.requests.filter(x=>x.name==='reset_guard_debug_update').map(x=>x.args),[{enabled:true},{enabled:false}]);
 assert.ok(!f.calls.includes('settings.update'));assert.ok(!f.calls.includes('reset_guard_test_notification'));
 const bad=await fixture({debugFail:true});await seven(bad);const badInput=bad.elements.get('debug-startup-notification');
 badInput.checked=true;await badInput.onchange();assert.equal(badInput.checked,false);assert.match(bad.elements.get('debug-status').textContent,/无法确认/);
});
test('hiding the panel while its switch is saving does not cancel the change or reopen the panel',async()=>{
 const f=await fixture({debugPause:true});await seven(f);const input=f.elements.get('debug-startup-notification');
 input.checked=true;const save=input.onchange();await seven(f);assert.equal(f.elements.get('debug-panel').hidden,true);
 f.releaseDebug();await save;assert.equal(f.debugBackend.enabled,true);assert.equal(f.elements.get('debug-panel').hidden,true);
});
test('debug tools cannot be triggered by title clicks on unsupported Mac',async()=>{
 const f=await fixture({mac:true});await seven(f);assert.equal(f.elements.get('debug-trigger').disabled,true);assert.deepEqual(f.calls,[]);
});
