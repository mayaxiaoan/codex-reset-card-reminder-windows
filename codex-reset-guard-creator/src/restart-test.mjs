import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Engine } from './engine.mjs';
import { Store, atomicWrite, initialState } from './store.mjs';
import { durationOf } from './settings.mjs';

// A one-shot diagnostic of the actual plugin startup path, separate from real account state.
export class RestartNotificationTest {
  constructor(directory, presence, notify, now = Date.now) {
    this.directory = join(directory, 'RestartNotificationTest');
    this.planPath = join(this.directory, 'plan.json');
    this.presence = presence; this.notify = notify; this.now = now;
    this.queue = Promise.resolve();
  }
  async status() {
    try { return JSON.parse(await readFile(this.planPath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async arm(notifyBefore = '12小时') {
    const current = await this.presence(true);
    if (current.active !== true || !current.processKey) throw new Error('无法确认当前 Codex 启动身份，暂时不能安排重启测试');
    if (durationOf(notifyBefore) === null) notifyBefore = '12小时';
    const plan = { version: 1, id: randomUUID(), status: 'armed', armedAt: this.now(),
      blockedProcessKey: current.processKey, notifyBefore, remainingSeconds: 1800,
      activationProcessKey: null, activatedAt: null, acceptedAt: null, error: null };
    await mkdir(this.directory, { recursive: true });
    // Re-arming creates a fresh isolated fixture; never copy state from the real account.
    await atomicWrite(join(this.directory, 'state.json'), initialState());
    await atomicWrite(this.planPath, plan);
    return plan;
  }
  tick() {
    const task = this.queue.then(() => this.runTick());
    this.queue = task.catch(() => {});
    return task;
  }
  async runTick() {
    const plan = await this.status();
    if (!plan || !['armed', 'active'].includes(plan.status)) return;
    if (plan.version !== 1 || !plan.id || !plan.blockedProcessKey || durationOf(plan.notifyBefore) === null || plan.remainingSeconds !== 1800) {
      throw new Error('重启通知测试配置无效');
    }
    const current = await this.presence(true);
    if (current.active !== true || !current.processKey || current.processKey === plan.blockedProcessKey) return;
    if (plan.status === 'armed') {
      plan.status = 'active'; plan.activationProcessKey = current.processKey; plan.activatedAt = this.now();
      plan.expiresAt = (this.now() + plan.remainingSeconds * 1000) / 1000;
      await atomicWrite(this.planPath, plan);
    }
    const store = await new Store(this.directory).load();
    const attempts = () => Object.values(store.state.reminderReceipts).some(r => r.attemptedAt !== undefined);
    // An uncertain previous submission must not be duplicated after a worker crash.
    if (attempts()) {
      plan.status = store.state.notificationStatus.lastAcceptedAt ? 'sent' : 'unconfirmed';
      plan.acceptedAt = store.state.notificationStatus.lastAcceptedAt;
      plan.error = store.state.notificationStatus.lastError;
      await atomicWrite(this.planPath, plan); return;
    }
    if (plan.expiresAt * 1000 <= this.now()) {
      plan.status = 'expired'; await atomicWrite(this.planPath, plan); return;
    }
    const accountId = 'simulated-restart-' + plan.id;
    const snapshot = { accountId, rateLimitResetCredits: { availableCount: 1, credits: [
      { id: 'simulated-card-' + plan.id, status: 'available', resetType: 'codexRateLimits', expiresAt: plan.expiresAt },
    ] } };
    // This API cannot contact Codex and refuses every action except reading the fake snapshot.
    const mockApi = { async request(method) {
      if (method !== 'account/rateLimits/read') throw new Error('模拟测试禁止调用任何真实卡片操作');
      return structuredClone(snapshot);
    } };
    const wrappedNotify = payload => this.notify({ ...payload,
      title: '重置卡防过期提醒 · 重启模拟测试',
      body: `模拟卡片剩余30分钟，已进入${plan.notifyBefore}提醒范围。已通过插件启动后台触发，无需先打开插件页面。本次没有使用真实重置卡。`,
    });
    const engine = new Engine(store, mockApi, this.now,
      async () => (await this.presence(true)).active === true, wrappedNotify, this.presence);
    await engine.setSettings({ notifyBefore: plan.notifyBefore, useBefore: '永不使用' });
    await engine.tick();
    if (attempts()) {
      plan.status = store.state.notificationStatus.lastAcceptedAt ? 'sent' : 'failed';
      plan.acceptedAt = store.state.notificationStatus.lastAcceptedAt;
      plan.error = store.state.notificationStatus.lastError;
      await atomicWrite(this.planPath, plan);
    }
  }
}
