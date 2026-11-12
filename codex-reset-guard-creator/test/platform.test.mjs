import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { platformSupport, requireWindows, routePlatformRequest } from '../src/platform.mjs';

test('Windows remains supported and receives real results without changing settings', async () => {
  assert.equal(platformSupport('win32').supported, true);
  assert.doesNotThrow(() => requireWindows('win32'));
  const result = await routePlatformRequest('status', {}, async () => ({ workerVersion: 'test', notifyBefore: '6小时' }), 'win32');
  assert.equal(result.supported, true); assert.equal(result.notifyBefore, '6小时');
});
test('Mac can read a clear unsupported state and settings, but never executes callbacks or writes', async () => {
  const noExecution = () => { throw new Error('Must not execute'); };
  const state = await routePlatformRequest('refresh', {}, noExecution, 'darwin');
  assert.equal(state.supported, false); assert.match(state.supportMessage, /仅支持 Windows.*macOS/);
  assert.deepEqual(state.cards, []);
  assert.deepEqual(await routePlatformRequest('readSettings', {}, noExecution, 'darwin'), { notifyBefore: '12小时', useBefore: '永不使用' });
  await assert.rejects(routePlatformRequest('updateSettings', { set: { useBefore: '1小时' } }, noExecution, 'darwin'), /仅支持 Windows/);
  assert.throws(() => requireWindows('darwin'), /macOS/);
});
test('other unsupported systems also fail closed', async () => {
  assert.equal(platformSupport('linux').supported, false);
  await assert.rejects(routePlatformRequest('testNotification', {}, () => assert.fail(), 'linux'), /仅支持 Windows/);
});
test('simulated Mac MCP initialization and page access never create a worker', { timeout: 15000 }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'reset-mac-guard-'));
  const entry = new URL('../src/mcp.mjs', import.meta.url).href;
  const code = `Object.defineProperty(process, 'platform', { value: 'darwin' }); await import(${JSON.stringify(entry)});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    windowsHide: true, stdio: ['pipe','pipe','pipe'], env: { ...process.env, RESET_GUARD_CREATOR_HOME: home },
  });
  t.after(() => child.kill());
  const lines = createInterface({ input: child.stdout }); t.after(() => lines.close());
  const pending = new Map(); let sequence = 0, errors = '';
  child.stderr.on('data', data => { errors += data; });
  lines.on('line', line => {
    const message = JSON.parse(line), item = pending.get(message.id);
    if (item) { clearTimeout(item.timer); pending.delete(message.id); item.resolve(message); }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error(errors || 'MCP timeout')), 5000);
    pending.set(id, { resolve, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const initialized = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'mac-test', version: '1.0.0' } });
  assert.equal(initialized.result.serverInfo.version, '1.7.1');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const result = await request('tools/call', { name: 'reset_guard_open', arguments: {} });
  assert.ok(!result.result.isError); assert.equal(result.result.structuredContent.supported, false);
  assert.match(result.result.structuredContent.supportMessage, /macOS/);
  const native = await request('tools/call', { name: 'settings.read', arguments: {} });
  assert.match(native.result.structuredContent.layout[0].title, /仅支持 Windows/);
  const update = await request('tools/call', { name: 'settings.update', arguments: { set: { useBefore: '1小时' } } });
  assert.equal(update.result.isError, true);
  const notification = await request('tools/call', { name: 'reset_guard_test_notification', arguments: {} });
  assert.equal(notification.result.isError, true);
  for(const [name,args]of [['reset_guard_debug_read',{}],['reset_guard_debug_update',{enabled:true}]]){
    const debug=await request('tools/call',{name,arguments:args});assert.equal(debug.result.isError,true);
  }
  await assert.rejects(access(join(home, 'service.json')), { code: 'ENOENT' });
  await assert.rejects(access(join(home, 'state.json')), { code: 'ENOENT' });
});
