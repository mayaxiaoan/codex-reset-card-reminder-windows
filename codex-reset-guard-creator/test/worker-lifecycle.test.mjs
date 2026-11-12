import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkerLifecycle, withWorkerTransitionLock } from '../src/worker-lifecycle.mjs';

function missing() { return Object.assign(new Error('no worker'), { code: 'ENOENT' }); }
function fixture(overrides = {}) {
  let running = '1.6.1', time = 0, stops = 0, starts = 0;
  const f = { get running() { return running; }, set running(value) { running = value; },
    get stops() { return stops; }, get starts() { return starts; } };
  f.options = { version: '1.6.3',
    request: async method => {
      if (method === 'status') { if (!running) throw missing(); return { workerVersion: running }; }
      assert.equal(method, 'shutdownForUpgrade'); stops++; running = null;
      return { stopped: true, settingsPreserved: true };
    },
    start: async () => { starts++; running = '1.6.3'; }, withLock: operation => operation(),
    now: () => time, wait: async ms => { time += ms; }, ...overrides };
  return f;
}

test('upgrade adopts old worker automatically, preserves settings and receipts, and serializes concurrent connections', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reset-worker-upgrade-'));
  const state = join(root, 'state.json');
  await writeFile(state, JSON.stringify({ notifyBefore: '6小时', useBefore: '永不使用', reminderSession: { id: 'same-codex-session' }, reminderReceipts: { existing: { attemptedAt: 123 } } }));
  const before = await readFile(state);
  const pipe = process.platform === 'win32' ? '\\\\.\\pipe\\reset-upgrade-test-' + randomUUID() : join(root, 'upgrade.sock');
  const f = fixture({ withLock: operation => withWorkerTransitionLock(pipe, operation) });
  const clients = Array.from({ length: 8 }, () => createWorkerLifecycle(f.options));
  await Promise.all(clients.flatMap(ensure => [ensure(), ensure()]));
  assert.equal(f.stops, 1); assert.equal(f.starts, 1); assert.equal(f.running, '1.6.3');
  assert.deepEqual(await readFile(state), before);
});

test('same or newer compatible worker is reused, never downgraded by an older connection', async () => {
  for (const version of ['1.6.3', '1.6.4', '1.7.0']) {
    const f = fixture(); f.running = version;
    await createWorkerLifecycle(f.options)();
    assert.equal(f.stops, 0); assert.equal(f.starts, 0);
  }
});

test('upgrade refusal leaves worker and settings alone rather than using destructive shutdown', async () => {
  const calls = [];
  const f = fixture({ request: async method => {
    calls.push(method);
    if (method === 'status') return { workerVersion: '1.6.1' };
    return { stopped: true, settingsPreserved: false };
  } });
  await assert.rejects(createWorkerLifecycle(f.options)(), /保留设置/);
  assert.equal(f.starts, 0); assert.ok(!calls.includes('shutdown'));
});

test('old worker must actually disappear before starting a replacement', async () => {
  const f = fixture({ stopTimeout: 200, request: async method => method === 'status'
    ? { workerVersion: '1.6.1' } : { stopped: true, settingsPreserved: true } });
  await assert.rejects(createWorkerLifecycle(f.options)(), /尚未退出/);
  assert.equal(f.starts, 0);
});

test('startup is not reported successful when a racing old process occupies the pipe', async () => {
  const f = fixture({ startTimeout: 200, start: async () => { f.running = '1.6.1'; } });
  f.running = null;
  await assert.rejects(createWorkerLifecycle(f.options)(), /启动失败/);
});

test('failed transition releases OS lock and in-process single-flight so a later attempt can recover', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reset-lock-recovery-'));
  const pipe = process.platform === 'win32' ? '\\\\.\\pipe\\reset-recovery-test-' + randomUUID() : join(root, 'lock.sock');
  const f = fixture({ withLock: operation => withWorkerTransitionLock(pipe, operation) });
  f.running = null; let failed = false;
  const start = f.options.start;
  f.options.start = async () => { if (!failed) { failed = true; throw new Error('start interrupted'); } await start(); };
  const ensure = createWorkerLifecycle(f.options);
  await assert.rejects(ensure(), /start interrupted/);
  await ensure(); assert.equal(f.running, '1.6.3');
});

test('unknown or incompatible newer versions and authentication errors are not silently replaced', async () => {
  for (const version of [undefined, '2.0.0']) {
    const f = fixture(); f.running = version;
    f.options.request = async () => ({ workerVersion: version });
    await assert.rejects(createWorkerLifecycle(f.options)(), /版本/);
    assert.equal(f.starts, 0); assert.equal(f.stops, 0);
  }
  const f = fixture({ request: async () => { throw new Error('本机插件认证失败'); } });
  await assert.rejects(createWorkerLifecycle(f.options)(), /认证失败/);
  assert.equal(f.starts, 0);
});
