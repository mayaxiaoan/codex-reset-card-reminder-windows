import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

test('SDK discovers settings and UI, rejects invalid inputs before business dispatch', { timeout: 20000 }, async t => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/mcp.mjs', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => child.kill());
  const messages = new Map();
  let nextId = 0;
  const lines = createInterface({ input: child.stdout });
  t.after(() => lines.close());
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  lines.on('line', line => {
    const response = JSON.parse(line);
    const pending = messages.get(response.id);
    if (pending) { clearTimeout(pending.timer); messages.delete(response.id); pending.resolve(response); }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => reject(new Error('No MCP response: ' + errors)), 8000);
    messages.set(id, { resolve, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  // No initialized notification: discovery/schema tests must not start an account worker.
  const initial = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'creator-contract-test', version: '1.0.0' } });
  assert.equal(initial.result.serverInfo.name, 'codex-reset-guard-creator');
  assert.equal(initial.result.serverInfo.title, '重置卡防过期提醒');
  assert.equal(initial.result.serverInfo.version, '1.6.2');
  assert.deepEqual(initial.result.capabilities.extensions['openai/settings'], { readTool: 'settings.read', updateTool: 'settings.update' });
  const { result: { tools } } = await request('tools/list', {});
  assert.equal(tools.length, 8);
  const byName = Object.fromEntries(tools.map(tool => [tool.name, tool]));
  assert.deepEqual(byName.reset_guard_open._meta['openai/ui'].entrypoints, [{ type: 'global' }]);
  assert.deepEqual(byName.reset_guard_open_in_chat._meta['openai/ui'].entrypoints, [{ type: 'thread' }]);
  assert.deepEqual(byName['settings.read'].outputSchema.properties.values.properties.notifyBefore.enum, ['24小时', '12小时', '6小时', '3小时', '1小时', '永不']);
  assert.deepEqual(byName['settings.read'].outputSchema.properties.values.properties.useBefore.enum, ['24小时', '12小时', '6小时', '3小时', '1小时', '永不使用']);
  assert.equal(byName['settings.update'].inputSchema.properties.set.additionalProperties, false);
  assert.equal(byName.reset_guard_set_enabled, undefined);
  assert.deepEqual(byName.reset_guard_test_notification._meta.ui.visibility, ['app']);
  assert.equal(byName.reset_guard_schedule_notification_test, undefined);
  for (const [name, args] of [
    ['reset_guard_set_enabled', { enabled: 'yes' }], ['settings.update', { set: { arbitrary: true } }],
    ['settings.update', { set: {} }], ['settings.update', { set: { autoProtect: 'true' } }],
    ['settings.update', { set: { useBefore: '0小时' } }], ['settings.update', { set: { notifyBefore: true } }],
    ['reset_guard_test_notification', { count: 2 }],
    ['reset_guard_schedule_notification_test', { delaySeconds: 0 }],
    ['reset_guard_schedule_notification_test', { delaySeconds: 60.2 }],
    ['reset_guard_schedule_notification_test', { delaySeconds: 3601 }],
  ]) {
    const response = await request('tools/call', { name, arguments: args });
    assert.ok(response.error || response.result?.isError, name + ': invalid arguments accepted');
  }
  const list = await request('resources/list', {});
  assert.equal(list.result.resources[0].uri, 'ui://reset-guard-creator/dashboard-1.6.2.html');
  const resource = await request('resources/read', { uri: list.result.resources[0].uri });
  assert.equal(resource.result.contents[0].mimeType, 'text/html;profile=mcp-app');
  assert.match(resource.result.contents[0].text, /重置卡防过期提醒/);
  assert.match(resource.result.contents[0].text, /当剩余不足以下时长时通知我/);
  assert.match(resource.result.contents[0].text, /当剩余不足以下时长时自动帮我使用/);
  assert.match(resource.result.contents[0].text, /<select id="remind"/);
  assert.match(resource.result.contents[0].text, /id="refresh"[^>]*>刷新<\/button><button id="test-notification"[^>]*>通知测试<\/button>/);
  assert.doesNotMatch(resource.result.contents[0].text, /Windows 系统通知|最近活动|id="test-now"|id="test-later"|id="events"/);
  assert.match(resource.result.contents[0].text, /id="platform-warning"/);
  assert.ok(!resource.result.contents[0].text.includes('/*SCRIPT*/'));
});
