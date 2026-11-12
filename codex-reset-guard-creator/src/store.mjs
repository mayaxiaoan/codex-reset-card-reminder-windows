import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NOTIFY_OPTIONS, USE_OPTIONS } from './settings.mjs';

export const initialState = () => ({
  version: 3, notifyBefore: '12小时', useBefore: '永不使用', enabled: false, reminderEnabled: true, reminderTimezone: 'Asia/Shanghai',
  accountId: null, attempts: {}, events: [], notifications: [], reminderReceipts: {},
  reminderSession: null, legacyReminderReceipts: {},
  notificationTests: [], notificationStatus: { lastAcceptedAt: null, lastError: null },
});
export async function atomicWrite(path, value) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(temporary, path);
}
export class Store {
  constructor(directory) { this.directory = directory; this.path = join(directory, 'state.json'); }
  async load() {
    await mkdir(this.directory, { recursive: true });
    try {
      this.state = JSON.parse(await readFile(this.path, 'utf8'));
      const s = this.state;
      if (![1, 2, 3].includes(s.version) || typeof s.enabled !== 'boolean' || !s.attempts ||
          typeof s.attempts !== 'object' || Array.isArray(s.attempts) || !Array.isArray(s.events) ||
          (s.accountId !== null && typeof s.accountId !== 'string') || (s.enabled && !s.accountId)) {
        throw new Error('状态文件格式错误；已停止启动，请检查 state.json');
      }
      this.state = { ...initialState(), ...s };
      if (s.version === 1) {
        this.state.version = 2;
        this.state.notifyBefore = '12小时';
        this.state.useBefore = '永不使用';
        this.state.enabled = false;
        this.state.reminderEnabled = true;
        for (const n of this.state.notifications) if (n.read || n.toastSentAt || n.toastAttempts) {
          this.state.reminderReceipts[`${n.accountId}:${n.creditId}:${n.expiresAt}`] = { attemptedAt: n.toastSentAt || n.time, migrated: true };
        }
      }
      if (s.version < 3) {
        this.state.version = 3;
        this.state.legacyReminderReceipts = this.state.reminderReceipts;
        this.state.reminderReceipts = {};
        this.state.reminderSession = null;
      }
      if (!NOTIFY_OPTIONS.includes(this.state.notifyBefore) || !USE_OPTIONS.includes(this.state.useBefore) ||
          this.state.enabled !== (this.state.useBefore !== '永不使用') ||
          this.state.reminderEnabled !== (this.state.notifyBefore !== '永不') ||
          !this.state.reminderReceipts || typeof this.state.reminderReceipts !== 'object' || Array.isArray(this.state.reminderReceipts)) {
        throw new Error('时长设置损坏；已停止启动');
      }
      if (typeof this.state.reminderEnabled !== 'boolean' || !Array.isArray(this.state.notifications) || !Array.isArray(this.state.notificationTests)) {
        throw new Error('提醒设置损坏；已停止启动');
      }
      const session = this.state.reminderSession;
      if ((session !== null && (typeof session.id !== 'string' || !session.id || typeof session.active !== 'boolean' ||
          (session.processKey !== null && typeof session.processKey !== 'string'))) ||
          !this.state.legacyReminderReceipts || typeof this.state.legacyReminderReceipts !== 'object' || Array.isArray(this.state.legacyReminderReceipts)) {
        throw new Error('客户端会话状态损坏；已停止启动');
      }
      if (s.version < 3) await atomicWrite(this.path, this.state);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = initialState();
      await atomicWrite(this.path, this.state);
    }
    return this;
  }
  async update(change) {
    const next = structuredClone(this.state);
    change(next);
    next.events = next.events.slice(-100);
    next.notifications = next.notifications.slice(-200);
    next.notificationTests = next.notificationTests.slice(-20);
    await atomicWrite(this.path, next);
    this.state = next;
  }
}
export function event(state, message, kind = 'info', now = Date.now()) {
  state.events.push({ time: now, kind, message });
}
