import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, HOUR } from '../src/engine.mjs';
import { Store } from '../src/store.mjs';
import { TIME_OPTIONS, durationOf } from '../src/settings.mjs';
const NOW = Date.parse('2026-12-01T23:00:00+08:00');
const card = (id, remaining) => ({ id, status: 'available', resetType: 'codexRateLimits', expiresAt: (NOW + remaining) / 1000 });
async function fixture(cards = [card('one', HOUR)]) {
  const directory = await mkdtemp(join(tmpdir(), 'reset-threshold-'));
  const store = await new Store(directory).load();
  const snapshot = { accountId: 'test', rateLimitResetCredits: { availableCount: cards.length, credits: cards } };
  let now = NOW, active = true, outcome = 'reset', offline = false;
  const sends = [], uses = [];
  const api = { async request(method, params) {
    if (offline) throw new Error('offline');
    if (method === 'account/rateLimits/read') return structuredClone(snapshot);
    uses.push(params); return { outcome };
  } };
  const notify = async payload => { sends.push(payload); return { accepted: true }; };
  const engine = new Engine(store, api, () => now, async () => active, notify);
  return { directory, store, snapshot, api, notify, engine, sends, uses,
    now(value) { now = value; }, active(value) { active = value; }, outcome(value) { outcome = value; }, offline(value) { offline = value; } };
}

test('defaults are 12-hour notification and never use; first current account binds safely', async () => {
  const f = await fixture([card('inside', 11 * HOUR), card('outside', 13 * HOUR)]);
  assert.deepEqual(f.engine.settings(), { notifyBefore: '12小时', useBefore: '永不使用' });
  await f.engine.tick(); await f.engine.tick();
  assert.equal(f.store.state.accountId, 'test');
  assert.equal(f.sends.length, 1); assert.equal(f.uses.length, 0);
});
for (const option of TIME_OPTIONS) test(`${option}: strict boundary, remaining time and earliest scheduled wakeup`, async () => {
  const duration = durationOf(option);
  const f = await fixture([card('one', duration)]);
  await f.engine.setSettings({ notifyBefore: option, useBefore: '永不使用' });
  await f.engine.tick(); assert.equal(f.sends.length, 0);
  assert.equal(f.engine.delay(), 1000);
  f.now(NOW + 1); await f.engine.tick(); assert.equal(f.sends.length, 1);
  const g = await fixture([card('one', duration)]);
  await g.engine.setSettings({ notifyBefore: '永不', useBefore: option });
  await g.engine.tick(); assert.equal(g.uses.length, 0);
  g.now(NOW + 1); await g.engine.tick(); assert.equal(g.uses.length, 1);
  assert.equal(g.sends.length, 0);
});
test('never selections disable both actions, also while offline', async () => {
  const f = await fixture();
  await f.engine.setSettings({ useBefore: '24小时' });
  f.offline(true);
  await f.engine.setSettings({ notifyBefore: '永不', useBefore: '永不使用' });
  assert.deepEqual(f.engine.settings(), { notifyBefore: '永不', useBefore: '永不使用' });
  f.offline(false); await f.engine.tick(); assert.equal(f.sends.length, 0); assert.equal(f.uses.length, 0);
});
test('resume catches up on all due successful cards before any notification', async () => {
  const f = await fixture([card('later', 2 * HOUR), card('first', HOUR)]);
  await f.engine.setSettings({ notifyBefore: '6小时', useBefore: '3小时' });
  f.active(false); await f.engine.tick(); assert.equal(f.uses.length, 0);
  f.active(true); await f.engine.tick();
  assert.deepEqual(f.uses.map(u => u.creditId), ['first', 'later']);
  assert.equal(f.sends.length, 0); assert.equal(f.engine.status().unreadCount, 0);
  await f.engine.tick(); assert.equal(f.uses.length, 2); assert.equal(f.sends.length, 0);
});
test('unsuccessful use retries; reopening and a new threshold can remind, worker restart alone cannot', async () => {
  const f = await fixture([card('one', 2 * HOUR)]); f.outcome('nothingToReset');
  await f.engine.setSettings({ notifyBefore: '3小时', useBefore: '3小时' });
  await f.engine.tick(); assert.equal(f.sends.length, 1); assert.equal(f.uses.length, 1);
  f.active(false); await f.engine.tick(); f.active(true); f.now(NOW + 61000); await f.engine.tick();
  assert.equal(f.sends.length, 2); assert.equal(f.uses.length, 2);
  const restarted = new Engine(await new Store(f.directory).load(), f.api, () => NOW + HOUR, async () => true, f.notify);
  await restarted.setSettings({ notifyBefore: '24小时' }); await restarted.tick();
  assert.equal(f.sends.length, 3);
  f.outcome('reset'); await restarted.tick(); // cooldown still applies
  const resumed = new Engine(await new Store(f.directory).load(), f.api, () => NOW + HOUR + 61000, async () => true, f.notify);
  await resumed.tick(); assert.equal(resumed.status().unreadCount, 0); assert.equal(f.sends.length, 3);
});
test('ambiguous notification and crash after submission never re-submit; failure leaves page notice', async () => {
  const f = await fixture();
  f.engine.notify = async payload => { f.sends.push(payload); throw new Error('lost reply'); };
  await f.engine.tick(); await f.engine.tick(); assert.equal(f.sends.length, 1);
  const restarted = new Engine(await new Store(f.directory).load(), f.api, () => NOW + 1000, async () => true, f.notify);
  await restarted.tick(); assert.equal(f.sends.length, 1); assert.equal(restarted.status().unreadCount, 1);
});
test('legacy settings migrate with requested 12-hour default and keep existing successful reminder receipts', async () => {
  const f = await fixture();
  await writeFile(join(f.directory, 'state.json'), JSON.stringify({ version: 1, enabled: false, reminderEnabled: false,
    accountId: null, attempts: {}, events: [], notifications: [{ id: 'legacy-day-id', accountId: 'test', creditId: 'one',
      expiresAt: (NOW + HOUR) / 1000, time: NOW - 1000, toastSentAt: NOW - 1000, read: false }] }));
  const migrated = await new Store(f.directory).load();
  const engine = new Engine(migrated, f.api, () => NOW, async () => true, f.notify);
  assert.equal(migrated.state.version, 3); assert.equal(engine.settings().notifyBefore, '12小时');
  assert.equal(engine.settings().useBefore, '永不使用');
  await engine.tick(); assert.equal(f.sends.length, 0); assert.equal(f.uses.length, 0);
});
test('invalid duration or legacy boolean settings cannot enable any action', async () => {
  const f = await fixture();
  for (const set of [{ useBefore: '0小时' }, { useBefore: '48小时' }, { useBefore: true }, { autoProtect: true }, {}]) {
    assert.throws(() => f.engine.setSettings(set), /请选择/);
  }
  assert.equal(f.store.state.enabled, false);
});
test('legacy enabled protection also migrates to the explicitly requested never-use default', async () => {
  const f = await fixture();
  await writeFile(join(f.directory, 'state.json'), JSON.stringify({ version: 1, enabled: true, reminderEnabled: true,
    accountId: 'test', attempts: { previous: { accountId: 'test', done: true } }, events: [], notifications: [] }));
  const migrated = await new Store(f.directory).load();
  assert.equal(migrated.state.useBefore, '永不使用'); assert.equal(migrated.state.enabled, false);
  assert.equal(migrated.state.attempts.previous.done, true);
});
test('receipt survives trimmed notice history and cannot recreate a dismissed alert', async () => {
  const f = await fixture(); await f.engine.tick();
  assert.equal(f.engine.status().cards[0].notificationAttempted, true);
  await f.engine.acknowledge();
  await f.store.update(s => { s.notifications = []; });
  const restarted = new Engine(await new Store(f.directory).load(), f.api, () => NOW + 1000, async () => true, f.notify);
  await restarted.tick(); assert.equal(f.sends.length, 1); assert.equal(restarted.status().unreadCount, 0);
});
test('expired, redeemed and missing expiry cards never notify or consume', async () => {
  const f = await fixture([card('expired', 0), { ...card('used', HOUR), status: 'redeemed' },
    { ...card('unknown', HOUR), expiresAt: null }]);
  await f.engine.setSettings({ notifyBefore: '24小时', useBefore: '24小时' });
  await f.engine.tick(); assert.equal(f.sends.length, 0); assert.equal(f.uses.length, 0);
});
