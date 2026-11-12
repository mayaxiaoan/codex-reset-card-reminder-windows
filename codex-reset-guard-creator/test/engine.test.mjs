import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, HOUR, dueCards } from '../src/engine.mjs';
import { Store } from '../src/store.mjs';
const NOW = 1800000000000;
const card = (id = 'card-1', expiry = NOW + HOUR - 1000) => ({ id, resetType: 'codexRateLimits', status: 'available', expiresAt: expiry / 1000 });
const snapshot = (cards = [card()], accountId = 'test-account') => ({ accountId,
  rateLimitResetCredits: { availableCount: cards.length, credits: cards } });
async function fixture(t, cards = [card()]) {
  const directory = await mkdtemp(join(tmpdir(), 'reset-guard-test-'));
  const store = await new Store(directory).load();
  let now = NOW, current = snapshot(cards), outcome = 'reset';
  const calls = [];
  const api = { async request(method, params) {
    if (method === 'account/rateLimits/read') return structuredClone(current);
    assert.equal(method, 'account/rateLimitResetCredit/consume');
    calls.push(params);
    if (outcome instanceof Error) throw outcome;
    return { outcome };
  } };
  const engine = new Engine(store, api, () => now);
  return { directory, store, api, engine, calls,
    setTime(value) { now = value; }, setSnapshot(value) { current = value; }, setOutcome(value) { outcome = value; } };
}
test('disabled by default; reading and refreshing never consume', async t => {
  const f = await fixture(t); await f.engine.refresh(); await f.engine.tick();
  assert.equal(f.store.state.enabled, false); assert.equal(f.calls.length, 0);
});
test('requires strictly less than one hour; equality does not consume', async t => {
  const f = await fixture(t, [card('card-1', NOW + HOUR + 1000)]);
  await f.engine.setEnabled(true); await f.engine.tick(); assert.equal(f.calls.length, 0);
  assert.equal(f.engine.delay(), 1001);
  f.setTime(NOW + 1000); await f.engine.tick(); assert.equal(f.calls.length, 0);
  f.setTime(NOW + 1001); await f.engine.tick(); assert.equal(f.calls.length, 1);
});
test('expired, missing expiry, unsupported type and unavailable are skipped', () => {
  const rows = [card('expired', NOW), { ...card('null'), expiresAt: null },
    { ...card('string'), expiresAt: String(NOW / 1000) },
    { ...card('type'), resetType: 'unknown' }, { ...card('used'), status: 'redeemed' }, card('valid')];
  assert.deepEqual(dueCards(snapshot(rows), NOW).map(c => c.id), ['valid']);
});
test('earliest expiry is consumed using an explicit creditId and UUID', async t => {
  const f = await fixture(t, [card('later'), card('first', NOW + 1000)]);
  await f.engine.setEnabled(true); await f.engine.tick();
  assert.equal(f.calls[0].creditId, 'first');
  assert.match(f.calls[0].idempotencyKey, /^[0-9a-f-]{36}$/);
  assert.equal(f.store.state.attempts.first.done, true);
});
test('success and alreadyRedeemed are persisted and never consumed twice', async t => {
  for (const outcome of ['reset', 'alreadyRedeemed']) {
    const f = await fixture(t); f.setOutcome(outcome);
    await f.engine.setEnabled(true); await f.engine.tick();
    f.setTime(NOW + 120000); await f.engine.tick();
    assert.equal(f.calls.length, 1); assert.equal(f.store.state.attempts['card-1'].done, true);
  }
});
test('timeout reuses durable idempotency key across restart', async t => {
  const f = await fixture(t); await f.engine.setEnabled(true);
  f.setOutcome(new Error('timeout')); await f.engine.tick();
  assert.equal(f.calls.length, 1);
  const stored = JSON.parse(await readFile(join(f.directory, 'state.json'), 'utf8'));
  assert.equal(stored.attempts['card-1'].key, f.calls[0].idempotencyKey);
  const restarted = new Engine(await new Store(f.directory).load(), f.api, () => NOW + 61000);
  f.setOutcome('alreadyRedeemed'); await restarted.tick();
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1].idempotencyKey, f.calls[0].idempotencyKey);
  assert.equal(restarted.store.state.attempts['card-1'].done, true);
});
test('nothingToReset retries after cooldown as a new logical attempt', async t => {
  const f = await fixture(t); f.setOutcome('nothingToReset'); await f.engine.setEnabled(true);
  await f.engine.tick(); await f.engine.tick(); assert.equal(f.calls.length, 1);
  f.setTime(NOW + 61000); await f.engine.tick(); assert.equal(f.calls.length, 2);
  assert.notEqual(f.calls[0].idempotencyKey, f.calls[1].idempotencyKey);
  assert.equal(f.store.state.attempts['card-1'].done, false);
});
test('noCredit does not mark redemption successful', async t => {
  const f = await fixture(t); f.setOutcome('noCredit'); await f.engine.setEnabled(true); await f.engine.tick();
  assert.equal(f.store.state.attempts['card-1'].done, false);
});
test('account switch pauses protection and never consumes on new account', async t => {
  const f = await fixture(t); await f.engine.setEnabled(true);
  f.setSnapshot(snapshot([card()], 'different-account')); await f.engine.tick();
  assert.equal(f.store.state.enabled, false); assert.equal(f.calls.length, 0);
});
test('enabling requires both account identity and card detail array', async t => {
  const f = await fixture(t); f.setSnapshot(snapshot([], null));
  await assert.rejects(f.engine.setEnabled(true), /账号/);
  f.setSnapshot({ accountId: 'test-account', rateLimitResetCredits: { availableCount: 2, credits: null } });
  await assert.rejects(f.engine.setEnabled(true), /明细/);
  assert.equal(f.store.state.enabled, false);
});
test('failure to persist request prevents consumption', async t => {
  const f = await fixture(t); await f.engine.setEnabled(true);
  f.store.update = async () => { throw new Error('disk full'); };
  await assert.rejects(f.engine.tick(), /disk full/); assert.equal(f.calls.length, 0);
});
test('disable requested during a pending read prevents later consumption', async t => {
  const f = await fixture(t); await f.engine.setEnabled(true);
  let resume;
  let markReading;
  const reading = new Promise(resolve => { markReading = resolve; });
  f.api.request = async method => {
    assert.equal(method, 'account/rateLimits/read');
    return await new Promise(resolve => { resume = resolve; markReading(); });
  };
  const tick = f.engine.tick(); await reading;
  const disable = f.engine.setEnabled(false); resume(snapshot());
  await tick; await disable;
  assert.equal(f.store.state.enabled, false); assert.equal(f.calls.length, 0);
});
test('concurrent ticks are serialized so one card is consumed once', async t => {
  const f = await fixture(t); await f.engine.setEnabled(true);
  await Promise.all([f.engine.tick(), f.engine.tick(), f.engine.tick()]);
  assert.equal(f.calls.length, 1);
});
test('resume inside expiry window catches up; resume after expiry does not consume', async t => {
  const f = await fixture(t); await f.engine.setEnabled(true);
  f.setTime(NOW + HOUR - 2000); await f.engine.tick(); assert.equal(f.calls.length, 1);
  const g = await fixture(t); await g.engine.setEnabled(true);
  g.setTime(NOW + HOUR); await g.engine.tick(); assert.equal(g.calls.length, 0);
});
test('closed Codex pauses; reopening catches up without losing the enabled state', async t => {
  const f = await fixture(t); await f.engine.setEnabled(true);
  f.engine.canRun = async () => false;
  await f.engine.tick(); assert.equal(f.calls.length, 0);
  assert.equal(f.engine.status().runtimeActive, false); assert.equal(f.store.state.enabled, true);
  f.engine.canRun = async () => true;
  await f.engine.tick(); assert.equal(f.calls.length, 1);
});
test('closing Codex during a read prevents a subsequent redemption', async t => {
  const f = await fixture(t); await f.engine.setEnabled(true);
  let checks = 0; f.engine.canRun = async () => ++checks === 1;
  await f.engine.tick(); assert.equal(f.calls.length, 0);
});
test('reminders are independent, deduplicated and can be acknowledged', async t => {
  const now = Date.parse('2026-12-01T09:00:00+08:00');
  const f = await fixture(t, [card('today', now + HOUR), card('tomorrow', now + 86400000)]);
  f.setTime(now); await f.engine.setReminders(true);
  await f.engine.tick(); await f.engine.tick();
  assert.equal(f.calls.length, 0); assert.equal(f.engine.status().unreadCount, 1);
  assert.equal(f.engine.status().notifications[0].creditId, 'today');
  await f.engine.acknowledge(); await f.engine.tick();
  assert.equal(f.engine.status().unreadCount, 0); assert.equal(f.store.state.notifications.length, 1);
});
test('remaining-time reminders cross calendar days correctly', async t => {
  const now = Date.parse('2026-11-30T17:00:00Z'); // Dec 1, 01:00 in Shanghai.
  const f = await fixture(t, [card('shanghai-today', Date.parse('2026-12-01T03:00:00Z'))]);
  f.setTime(now); await f.engine.setReminders(true); await f.engine.tick();
  assert.equal(f.engine.status().unreadCount, 1);
});
test('account change pauses reminder-only mode too', async t => {
  const f = await fixture(t); await f.engine.setReminders(true);
  f.setSnapshot(snapshot([card()], 'new-account')); await f.engine.tick();
  assert.equal(f.store.state.reminderEnabled, false); assert.equal(f.calls.length, 0);
});
test('redemption resolves the current reminder instead of leaving a stale red dot', async t => {
  const now = Date.parse('2026-12-01T09:00:00+08:00');
  const f = await fixture(t, [card('today', now + HOUR - 1000)]); f.setTime(now);
  await f.engine.setReminders(true); await f.engine.setEnabled(true); await f.engine.tick();
  assert.equal(f.calls.length, 1); assert.equal(f.engine.status().unreadCount, 0);
});
