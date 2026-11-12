import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, HOUR } from '../src/engine.mjs';
import { Store } from '../src/store.mjs';
import { notificationTag } from '../src/windows-notifications.mjs';
const NOW = Date.parse('2026-12-01T09:00:00+08:00');
async function fixture() {
  const store = await new Store(await mkdtemp(join(tmpdir(), 'reset-guard-notifications-'))).load();
  let now = NOW, active = true, failure = false, offline = false;
  const sends = [], redemptions = [];
  const api = { async request(method, params) {
    if (offline) throw new Error('offline');
    if (method === 'account/rateLimits/read') return { accountId: 'test', rateLimitResetCredits: {
      availableCount: 1, credits: [{ id: 'card', status: 'available', resetType: 'codexRateLimits', expiresAt: (NOW + HOUR - 1000) / 1000 }] } };
    redemptions.push(params); return { outcome: 'reset' };
  } };
  const notify = async payload => { sends.push(payload); if (failure) throw new Error('notifications disabled'); return { accepted: true }; };
  const engine = new Engine(store, api, () => now, async () => active, notify);
  await engine.setSettings({ notifyBefore: '永不' });
  return { store, engine, sends, redemptions, setNow(v) { now = v; }, setActive(v) { active = v; }, setFailure(v) { failure = v; }, setOffline(v) { offline = v; } };
}
test('expiry toast is sent only once across repeated checks and restart', async () => {
  const f = await fixture(); await f.engine.setReminders(true); await f.engine.tick(); await f.engine.tick();
  assert.equal(f.sends.length, 1); assert.equal(f.engine.status().unreadCount, 1);
  const restarted = new Engine(await new Store(f.store.directory).load(), f.engine.api, () => NOW + 30000, async () => true, f.engine.notify);
  await restarted.tick(); assert.equal(f.sends.length, 1);
});
test('notification failure preserves red dot and does not prevent protection', async () => {
  const f = await fixture(); await f.engine.setReminders(true); await f.engine.setEnabled(true);
  f.engine.api = { request: async (method, params) => { if (method === 'account/rateLimits/read') return { accountId: 'test', rateLimitResetCredits: { credits: [{ id: 'card', status: 'available', resetType: 'codexRateLimits', expiresAt: (NOW + HOUR - 1000) / 1000 }] } }; f.redemptions.push(params); return { outcome: 'nothingToReset' }; } };
  f.setFailure(true); await f.engine.tick();
  assert.equal(f.sends.length, 1); assert.equal(f.redemptions.length, 1);
  assert.match(f.engine.status().notificationStatus.lastError, /disabled/);
});
test('delayed test fires with both switches off and no plugin page or account connection', async () => {
  const f = await fixture(); const item = await f.engine.scheduleNotificationTest(60);
  assert.equal(item.dueAt, NOW + 60000); await f.engine.tick(); assert.equal(f.sends.length, 0);
  f.setNow(NOW + 60000); f.setOffline(true);
  await assert.rejects(f.engine.tick(), /offline/);
  assert.equal(f.sends.length, 1); assert.equal(f.store.state.notificationTests[0].status, 'sent');
  assert.equal(f.store.state.enabled, false); assert.equal(f.store.state.reminderEnabled, false); assert.equal(f.redemptions.length, 0);
});
test('closed Codex defers the scheduled test until reopen', async () => {
  const f = await fixture(); await f.engine.scheduleNotificationTest(60); f.setNow(NOW + 61000); f.setActive(false);
  await f.engine.tick(); assert.equal(f.sends.length, 0);
  f.setActive(true); await f.engine.tick(); assert.equal(f.sends.length, 1);
});
test('scheduled tests survive restart and a delivered test is not duplicated', async () => {
  const f = await fixture(); await f.engine.scheduleNotificationTest(60);
  const restarted = new Engine(await new Store(f.store.directory).load(), f.engine.api, () => NOW + 61000, async () => true, f.engine.notify);
  await restarted.tick(); await restarted.tick(); assert.equal(f.sends.length, 1);
});
test('notification retry is bounded and records a failed test honestly', async () => {
  const f = await fixture(); f.setFailure(true); await f.engine.scheduleNotificationTest(5);
  for (const offset of [5000, 65000, 125000, 185000]) { f.setNow(NOW + offset); await f.engine.tick(); }
  assert.equal(f.sends.length, 3); assert.equal(f.store.state.notificationTests[0].status, 'failed');
});
test('notification tags are stable and safe, delay arguments are bounded', async () => {
  assert.equal(notificationTag('same'), notificationTag('same'));
  assert.notEqual(notificationTag('same'), notificationTag('other'));
  assert.match(notificationTag('path:中文&<>'), /^[0-9a-f]{32}$/);
  const f = await fixture(); assert.throws(() => f.engine.scheduleNotificationTest(0), /延迟/);
});

test('manual notification works offline without consuming cards or changing settings and expiry receipts', async () => {
  const f = await fixture();
  const before = structuredClone({ settings: f.engine.settings(), receipts: f.store.state.reminderReceipts, attempts: f.store.state.attempts });
  f.setOffline(true);
  await f.engine.testNotificationNow();
  assert.equal(f.sends.length, 1);
  assert.match(f.sends[0].title, /测试通知/);
  assert.equal(f.redemptions.length, 0);
  assert.deepEqual({ settings: f.engine.settings(), receipts: f.store.state.reminderReceipts, attempts: f.store.state.attempts }, before);
  await f.engine.testNotificationNow();
  assert.equal(f.sends.length, 2);
  assert.notEqual(f.sends[0].id, f.sends[1].id);
});
test('manual notification reports failures and refuses to send while Codex is closed', async () => {
  const f = await fixture();
  f.setActive(false);
  await assert.rejects(f.engine.testNotificationNow(), /Codex 主窗口/);
  assert.equal(f.sends.length, 0);
  f.setActive(true); f.setFailure(true);
  await assert.rejects(f.engine.testNotificationNow(), /notifications disabled/);
  assert.equal(f.sends.length, 1);
  assert.match(f.engine.status().notificationStatus.lastError, /notifications disabled/);
  assert.equal(f.redemptions.length, 0);
});
