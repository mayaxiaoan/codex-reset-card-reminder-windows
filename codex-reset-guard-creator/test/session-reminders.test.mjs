import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine, HOUR } from '../src/engine.mjs';
import { Store } from '../src/store.mjs';

const NOW = Date.parse('2026-12-01T06:00:00Z');
async function fixture(remaining = 13 * HOUR) {
  const directory = await mkdtemp(join(tmpdir(), 'reset-session-'));
  const store = await new Store(directory).load();
  let now = NOW, offline = false, outcome = 'reset';
  let presence = { active: true, processKey: 'codex-A', startedAt: NOW - 10000 };
  const snapshot = { accountId: 'test', rateLimitResetCredits: { availableCount: 1,
    credits: [{ id: 'card', status: 'available', resetType: 'codexRateLimits', expiresAt: (NOW + remaining) / 1000 }] } };
  const sends = [], uses = [];
  const api = { async request(method, params) {
    if (offline) throw new Error('offline');
    if (method === 'account/rateLimits/read') return structuredClone(snapshot);
    uses.push(params); return { outcome };
  } };
  const notify = async payload => { sends.push(payload); return { accepted: true }; };
  const canRun = async () => presence.active === true;
  const observe = async () => presence;
  const engine = new Engine(store, api, () => now, canRun, notify, observe);
  return { directory, store, snapshot, api, engine, sends, uses, canRun, notify, observe,
    now(value) { now = value; }, presence(value) { presence = value; }, offline(value) { offline = value; }, outcome(value) { outcome = value; },
    async restartWorker() { return new Engine(await new Store(directory).load(), api, () => now, canRun, notify, observe); } };
}

test('open outside threshold, cross it while continuously open, notify once', async () => {
  const f = await fixture(); await f.engine.tick(); assert.equal(f.sends.length, 0);
  f.now(NOW + HOUR); await f.engine.tick(); assert.equal(f.sends.length, 0);
  f.now(NOW + HOUR + 1); await f.engine.tick(); assert.equal(f.sends.length, 1);
  for (let i = 2; i <= 6; i++) { f.now(NOW + i * HOUR); await f.engine.tick(); }
  assert.equal(f.sends.length, 1);
});
test('open already inside threshold: one notification, including after acknowledgement and refresh', async () => {
  const f = await fixture(5 * HOUR); await f.engine.tick(); assert.equal(f.sends.length, 1);
  await f.engine.acknowledge(); await f.engine.refresh(); await f.engine.tick();
  assert.equal(f.sends.length, 1); assert.equal(f.engine.status().unreadCount, 0);
});
test('close and reopen: unused card reminds once again, acknowledged notice does not suppress a new run', async () => {
  const f = await fixture(5 * HOUR); await f.engine.tick(); await f.engine.acknowledge();
  f.presence({ active: false, processKey: null }); await f.engine.tick();
  f.presence({ active: true, processKey: 'codex-B', startedAt: NOW + 1000 });
  await f.engine.tick(); await f.engine.tick();
  assert.equal(f.sends.length, 2); assert.equal(f.engine.status().unreadCount, 1);
});
test('quick full restart missed by polling still creates a new run from process identity', async () => {
  const f = await fixture(5 * HOUR); await f.engine.tick();
  const firstSession = f.store.state.reminderSession.id;
  f.presence({ active: true, processKey: 'codex-B', startedAt: NOW + 1000 });
  await f.engine.tick(); await f.engine.tick();
  assert.notEqual(f.store.state.reminderSession.id, firstSession); assert.equal(f.sends.length, 2);
});
test('reopen main window in same process after observed closure also creates a new run', async () => {
  const f = await fixture(5 * HOUR); await f.engine.tick();
  f.presence({ active: false, processKey: null }); await f.engine.tick();
  f.presence({ active: true, processKey: 'codex-A', startedAt: NOW - 10000 });
  await f.engine.tick(); await f.engine.tick(); assert.equal(f.sends.length, 2);
});
test('worker restart while Codex is still open does not remind again', async () => {
  const f = await fixture(5 * HOUR); await f.engine.tick();
  const restarted = await f.restartWorker(); await restarted.tick(); await restarted.tick();
  assert.equal(f.sends.length, 1);
});
test('worker restart after Codex restart reminds even if the worker never observed closure', async () => {
  const f = await fixture(5 * HOUR); await f.engine.tick();
  f.presence({ active: true, processKey: 'codex-B', startedAt: NOW + 1000 });
  const restarted = await f.restartWorker(); await restarted.tick(); await restarted.tick();
  assert.equal(f.sends.length, 2);
});
test('presence uncertainty / transient detection failure does not invent a reopening', async () => {
  const f = await fixture(5 * HOUR); await f.engine.tick();
  const firstSession = f.store.state.reminderSession.id;
  f.presence({ active: null, processKey: null }); await f.engine.tick();
  assert.equal(f.store.state.reminderSession.active, true);
  f.presence({ active: true, processKey: 'codex-A', startedAt: NOW - 10000 });
  await f.engine.tick(); assert.equal(f.sends.length, 1); assert.equal(f.store.state.reminderSession.id, firstSession);
});
test('24-hour notification, then 6 hours selected while 10 hours remain: waits and notifies at 6 hours', async () => {
  const f = await fixture(10 * HOUR);
  await f.engine.setSettings({ notifyBefore: '24小时' }); await f.engine.tick(); assert.equal(f.sends.length, 1);
  await f.engine.setSettings({ notifyBefore: '6小时' }); await f.engine.tick(); assert.equal(f.sends.length, 1);
  assert.equal(f.engine.status().unreadCount, 0); // old threshold notice is history
  f.now(NOW + 4 * HOUR); await f.engine.tick(); assert.equal(f.sends.length, 1);
  f.now(NOW + 4 * HOUR + 1); await f.engine.tick(); await f.engine.tick();
  assert.equal(f.sends.length, 2); assert.match(f.sends[1].body, /6小时/);
});
test('new threshold already satisfied reminds once; selecting same value or returning to a notified value does not repeat', async () => {
  const f = await fixture(5 * HOUR);
  await f.engine.setSettings({ notifyBefore: '24小时' }); await f.engine.tick();
  await f.engine.setSettings({ notifyBefore: '6小时' }); await f.engine.tick(); assert.equal(f.sends.length, 2);
  await f.engine.setSettings({ notifyBefore: '6小时' }); await f.engine.tick();
  await f.engine.setSettings({ notifyBefore: '24小时' }); await f.engine.tick();
  await f.engine.setSettings({ notifyBefore: '永不' }); await f.engine.tick();
  await f.engine.setSettings({ notifyBefore: '6小时' }); await f.engine.tick(); assert.equal(f.sends.length, 2);
});
test('never prevents future entry reminders until a real notification duration is selected', async () => {
  const f = await fixture(5 * HOUR); await f.engine.setSettings({ notifyBefore: '永不' });
  await f.engine.tick(); f.presence({ active: true, processKey: 'codex-B', startedAt: NOW });
  await f.engine.tick(); assert.equal(f.sends.length, 0);
  await f.engine.setSettings({ notifyBefore: '3小时' }); await f.engine.tick(); assert.equal(f.sends.length, 0);
  f.now(NOW + 2 * HOUR + 1); await f.engine.tick(); assert.equal(f.sends.length, 1);
});
test('automatic success suppresses reminders in later runs and for other thresholds, even with stale API inventory', async () => {
  const f = await fixture(5 * HOUR);
  await f.engine.setSettings({ notifyBefore: '24小时', useBefore: '6小时' });
  await f.engine.tick(); assert.equal(f.uses.length, 1); assert.equal(f.sends.length, 0);
  f.presence({ active: true, processKey: 'codex-B', startedAt: NOW + 1 });
  await f.engine.setSettings({ notifyBefore: '12小时' }); await f.engine.tick();
  assert.equal(f.sends.length, 0); assert.equal(f.uses.length, 1);
});
test('manual use and expiry stop later startup reminders', async () => {
  for (const mode of ['redeemed', 'expired']) {
    const f = await fixture(5 * HOUR); await f.engine.tick();
    if (mode === 'redeemed') f.snapshot.rateLimitResetCredits.credits[0].status = 'redeemed';
    else f.now(NOW + 5 * HOUR);
    f.presence({ active: true, processKey: 'codex-B', startedAt: NOW + 1 });
    await f.engine.tick(); assert.equal(f.sends.length, 1); assert.equal(f.engine.status().unreadCount, 0);
  }
});
test('network failure while changing settings does not permanently pause the old valid reminder', async () => {
  const f = await fixture(5 * HOUR); f.offline(true);
  await assert.rejects(f.engine.setSettings({ notifyBefore: '3小时' }), /offline/);
  f.offline(false); await f.engine.tick(); assert.equal(f.sends.length, 1);
  assert.equal(f.engine.settings().notifyBefore, '12小时');
});
for (const oldReceiptTime of [NOW - 20000, NOW - 5000]) test(`v2 upgrade respects actual Codex startup (${oldReceiptTime < NOW - 10000 ? 'older run' : 'current run'})`, async () => {
  const f = await fixture(5 * HOUR);
  const card = f.snapshot.rateLimitResetCredits.credits[0];
  await writeFile(join(f.directory, 'state.json'), JSON.stringify({ version: 2, enabled: false, reminderEnabled: true,
    notifyBefore: '12小时', useBefore: '永不使用', accountId: 'test', attempts: {}, events: [],
    notifications: [{ id: 'old', creditId: card.id, accountId: 'test', expiresAt: card.expiresAt,
      read: false, toastSentAt: oldReceiptTime }], reminderReceipts: { [`test:card:${card.expiresAt}`]: { attemptedAt: oldReceiptTime } } }));
  const upgraded = await f.restartWorker(); await upgraded.tick(); await upgraded.tick();
  assert.equal(f.sends.length, oldReceiptTime < NOW - 10000 ? 1 : 0);
});
