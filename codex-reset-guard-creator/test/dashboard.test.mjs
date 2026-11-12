import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = (await readFile(new URL('../ui/dashboard.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '');
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const state = () => ({ supported:true, notifyBefore:'12小时', useBefore:'永不使用', cards:[], detailsAvailable:true, notifications:[], unreadCount:0 });
async function fixture({ fail = false, mac = false, pause = false } = {}) {
  const elements = new Map(), calls = [], timers = [];
  const element = () => ({ hidden:false, disabled:true, value:'', textContent:'', append(){}, replaceChildren(){} });
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id,element()); return elements.get(id); }, createElement:element };
  let release;
  class App {
    async connect() {}
    async callServerTool({name}) {
      calls.push(name);
      if (name === 'reset_guard_test_notification') {
        if (pause) await new Promise(resolve => { release=resolve; });
        if (fail) return { isError:true, content:[{type:'text',text:'Windows 通知未启用'}] };
      }
      return { structuredContent:state() };
    }
  }
  await new AsyncFunction('App','VERSION','document','navigator','setInterval',source)(App,'test',document,{platform:mac?'MacIntel':'Win32'},callback=>timers.push(callback));
  return { elements,calls,timers,release:()=>release() };
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
