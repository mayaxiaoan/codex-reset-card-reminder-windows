import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RestartNotificationTest } from '../src/restart-test.mjs';
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'restart-test-'));
  let now = 1800000000000, failure = false;
  let presence = { active: true, processKey: 'codex-A', startedAt: now - 10000 };
  const sends = [];
  const observe = async () => presence;
  const notify = async payload => { sends.push(payload); if (failure) throw new Error('disabled'); return { accepted: true }; };
  return { directory, sends, observe, notify, now: () => now,
    setPresence(p) { presence = p; }, setTime(t) { now = t; }, fail() { failure = true; },
    manager: new RestartNotificationTest(directory, observe, notify, () => now) };
}
test('arming and restarting worker in the same Codex process never sends', async () => {
  const f = await fixture(); await f.manager.arm('12小时');
  await f.manager.tick();
  const restarted = new RestartNotificationTest(f.directory, f.observe, f.notify, f.now);
  await restarted.tick(); assert.equal(f.sends.length, 0); assert.equal((await restarted.status()).status, 'armed');
});
test('closed, uncertain or same process is ignored; next actual process runs the fake card through Engine once', async () => {
  const f = await fixture(); await f.manager.arm('1小时');
  for (const presence of [{ active: false }, { active: null }, { active: true, processKey: 'codex-A' }]) {
    f.setPresence(presence); await f.manager.tick(); assert.equal(f.sends.length, 0);
  }
  f.setPresence({ active: true, processKey: 'codex-B', startedAt: f.now() });
  await Promise.all([f.manager.tick(), f.manager.tick(), f.manager.tick()]);
  assert.equal(f.sends.length, 1); assert.match(f.sends[0].title, /重启模拟测试/);
  assert.match(f.sends[0].body, /剩余30分钟/);
  assert.equal((await f.manager.status()).status, 'sent');
  const state = JSON.parse(await readFile(join(f.directory, 'RestartNotificationTest/state.json'), 'utf8'));
  assert.equal(state.useBefore, '永不使用'); assert.deepEqual(state.attempts, {});
  assert.match(state.accountId, /^simulated-restart-/);
});
test('one-shot success stays finished through another Codex and worker restart', async () => {
  const f = await fixture(); await f.manager.arm();
  f.setPresence({ active: true, processKey: 'codex-B', startedAt: f.now() }); await f.manager.tick();
  f.setPresence({ active: true, processKey: 'codex-C', startedAt: f.now() });
  await new RestartNotificationTest(f.directory, f.observe, f.notify, f.now).tick(); assert.equal(f.sends.length, 1);
});
test('notification failure is recorded without repeating banners or consuming', async () => {
  const f = await fixture(); await f.manager.arm(); f.fail();
  f.setPresence({ active: true, processKey: 'codex-B', startedAt: f.now() });
  await f.manager.tick(); await f.manager.tick();
  assert.equal(f.sends.length, 1); assert.equal((await f.manager.status()).status, 'failed');
});
test('long wait before restarting still uses a fresh 30-minute simulated expiry', async () => {
  const f = await fixture(); const plan = await f.manager.arm(); f.setTime(f.now() + 86400000);
  f.setPresence({ active: true, processKey: 'codex-B', startedAt: f.now() }); await f.manager.tick();
  assert.equal(f.sends.length, 1);
  assert.equal((await f.manager.status()).expiresAt * 1000, f.now() + 1800000);
});
