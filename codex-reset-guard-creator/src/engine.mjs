import { randomUUID } from 'node:crypto';
import { event } from './store.mjs';
import { VERSION } from './version.mjs';
import { HOUR, durationOf, validateSettings } from './settings.mjs';

export { HOUR } from './settings.mjs';
const receiptId = (accountId, card) => `${accountId}:${card.creditId ?? card.id}:${card.expiresAt}`;
const within = (card, now, duration) => duration !== null && card.status === 'available' &&
  card.resetType === 'codexRateLimits' && typeof card.id === 'string' && card.id.length > 0 &&
  Number.isFinite(card.expiresAt) && card.expiresAt * 1000 > now && card.expiresAt * 1000 - now < duration;
export function cardsOf(snapshot) {
  const rows = snapshot?.rateLimitResetCredits?.credits;
  return Array.isArray(rows) ? rows : [];
}
export function dueCards(snapshot, now, duration = HOUR) {
  return cardsOf(snapshot).filter(c => within(c, now, duration))
    .sort((a, b) => a.expiresAt - b.expiresAt || a.id.localeCompare(b.id));
}
export class Engine {
  constructor(store, api, now = Date.now, canRun = async () => true, notify = null, presence = null) {
    this.store = store; this.api = api; this.now = now;
    this.snapshot = null; this.lastCheck = null; this.error = null;
    this.pauseRequested = false; this.stopping = false; this.queue = Promise.resolve();
    this.canRun = canRun; this.runtimeActive = null;
    this.notify = notify;
    this.noticePauseRequested = false;
    this.presence = presence;
  }
  noticeId(accountId, card) {
    return `${this.store.state.reminderSession?.id || 'pending'}|${this.store.state.notifyBefore}|${receiptId(accountId, card)}`;
  }
  async canExecute() {
    const active = await this.canRun(true);
    const observed = await this.observeRuntime();
    return active && observed;
  }
  async observeRuntime() {
    const observed = this.presence ? await this.presence() : { active: await this.canRun(), processKey: null };
    if (typeof observed.active !== 'boolean') {
      this.runtimeActive = null;
      this.error = observed.reason || '暂时无法确认 Codex 是否打开，自动操作已暂停。';
      return false;
    }
    const previousActive = this.runtimeActive;
    this.runtimeActive = observed.active;
    const session = this.store.state.reminderSession;
    if (!observed.active) {
      if (session?.active) await this.store.update(s => {
        s.reminderSession.active = false;
        event(s, 'Codex 主窗口已关闭，提醒和自动使用已暂停。', 'info', this.now());
      });
      return false;
    }
    const newSession = !session || !session.active ||
      (session.processKey && observed.processKey && session.processKey !== observed.processKey);
    if (newSession || (!session?.processKey && observed.processKey)) {
      await this.store.update(s => {
        if (newSession) {
          s.reminderSession = { id: randomUUID(), active: true, processKey: observed.processKey || null };
          s.reminderReceipts = {};
          event(s, 'Codex 已打开，将检查当前提醒时长；本次打开中同一卡片、同一时长只提醒一次。', 'info', this.now());
        } else s.reminderSession.processKey = observed.processKey;
        // Upgrade old lifetime receipts only if they were attempted during this actual Codex run.
        // Receipts from earlier runs must not suppress the requested reopening reminder.
        for (const [key, receipt] of Object.entries(s.legacyReminderReceipts)) {
          const at = receipt.attemptedAt ?? receipt.acknowledgedAt;
          if (Number.isFinite(observed.startedAt) && (!Number.isFinite(at) || at < observed.startedAt)) continue;
          const scoped = `${s.reminderSession.id}|${s.notifyBefore}|${key}`;
          s.reminderReceipts[scoped] = receipt;
          for (const n of s.notifications) if (receiptId(n.accountId, n) === key) {
            n.id = scoped; n.sessionId = s.reminderSession.id; n.threshold = s.notifyBefore;
          }
        }
        s.legacyReminderReceipts = {};
      });
    } else if (previousActive === false) {
      // Normally handled through the persisted inactive marker; retained as a status fallback.
      await this.store.update(s => event(s, 'Codex 主窗口已打开，恢复检查。', 'info', this.now()));
    }
    return true;
  }
  serial(operation) {
    const task = this.queue.then(operation);
    this.queue = task.catch(() => {});
    return task;
  }
  async read() {
    try {
      const snapshot = await this.api.request('account/rateLimits/read');
      this.snapshot = snapshot; this.lastCheck = this.now(); this.error = null;
      // The requested 12-hour default binds reminder-only mode to the first signed-in account.
      if (!this.store.state.accountId && !this.store.state.enabled && snapshot.accountId &&
          Array.isArray(snapshot.rateLimitResetCredits?.credits)) {
        await this.store.update(s => { s.accountId = snapshot.accountId; });
      }
      if ((this.store.state.enabled || this.store.state.reminderEnabled) &&
          (!snapshot.accountId || snapshot.accountId !== this.store.state.accountId)) {
        this.pauseRequested = true;
        await this.store.update(s => {
          s.enabled = false; s.reminderEnabled = false; s.useBefore = '永不使用'; s.notifyBefore = '永不';
          event(s, '账号或工作区已变化，提醒与防过期已暂停。请核对账号后重新开启。', 'warning', this.now());
        });
      }
      return snapshot;
    } catch (error) { this.error = error.message; throw error; }
  }
  refresh() { return this.serial(() => this.read()); }
  settings() {
    return { notifyBefore: this.store.state.notifyBefore, useBefore: this.store.state.useBefore };
  }
  setSettings(set) {
    validateSettings(set);
    if (set.useBefore !== undefined) this.pauseRequested = true;
    if (set.notifyBefore !== undefined) this.noticePauseRequested = true;
    return this.serial(async () => {
      try {
      // Disables are committed before any network read, including while offline.
      if (set.useBefore === '永不使用' || set.notifyBefore === '永不') {
        await this.store.update(s => {
          if (set.useBefore === '永不使用') { s.useBefore = set.useBefore; s.enabled = false; }
          if (set.notifyBefore === '永不') { s.notifyBefore = set.notifyBefore; s.reminderEnabled = false; }
        });
      }
      const enabling = (set.useBefore !== undefined && set.useBefore !== '永不使用') ||
        (set.notifyBefore !== undefined && set.notifyBefore !== '永不');
      const snapshot = enabling ? await this.read() : null;
      if (enabling && (!snapshot.accountId || !Array.isArray(snapshot.rateLimitResetCredits?.credits))) {
        throw new Error('无法确定账号或卡片明细，不能启用自动提醒或使用');
      }
      await this.store.update(s => {
        Object.assign(s, set);
        s.enabled = s.useBefore !== '永不使用'; s.reminderEnabled = s.notifyBefore !== '永不';
        if (snapshot) s.accountId = snapshot.accountId;
        event(s, `设置已更新：不足${s.notifyBefore === '永不' ? '—（不通知）' : s.notifyBefore + '通知'}；自动使用：${s.useBefore}。`, 'info', this.now());
      });
      return this.settings();
      } finally {
        this.pauseRequested = !this.store.state.enabled;
        this.noticePauseRequested = !this.store.state.reminderEnabled;
      }
    });
  }
  setReminders(enabled) {
    return this.setSettings({ notifyBefore: enabled ? (this.store.state.notifyBefore === '永不' ? '12小时' : this.store.state.notifyBefore) : '永不' });
  }
  acknowledge() {
    return this.serial(() => this.store.update(s => {
      for (const item of s.notifications) if (item.accountId === this.snapshot?.accountId &&
          item.id === this.noticeId(item.accountId, item)) {
        item.read = true;
        s.reminderReceipts[item.id] ||= { acknowledgedAt: this.now() };
      }
    }));
  }
  scheduleNotificationTest(delaySeconds = 60) {
    if (!Number.isInteger(delaySeconds) || delaySeconds < 5 || delaySeconds > 3600) throw new Error('测试延迟应为 5 到 3600 秒');
    return this.serial(async () => {
      const item = { id: randomUUID(), dueAt: this.now() + delaySeconds * 1000, status: 'pending', attempts: 0 };
      await this.store.update(s => {
        s.notificationTests.push(item);
        event(s, `已安排 Windows 后台测试通知，将在约 ${delaySeconds} 秒后触发；不改变时长设置。`, 'info', this.now());
      });
      return item;
    });
  }
  testNotificationNow() {
    return this.serial(async () => {
      if (!(await this.canExecute())) throw new Error('请保持 Codex 主窗口打开后再测试');
      await this.sendNotice({ id: 'manual-' + randomUUID(), title: '重置卡防过期提醒 · 测试通知',
        body: 'Windows 系统通知测试。这条通知不会使用重置卡，也不会改变时长设置。' });
      return this.status();
    });
  }
  async sendNotice(payload) {
    if (!this.notify) throw new Error('当前环境没有 Windows 通知组件');
    try {
      const result = await this.notify(payload);
      if (result?.accepted !== true) throw new Error('Windows 未确认接受通知');
      await this.store.update(s => {
        s.notificationStatus = { lastAcceptedAt: this.now(), lastError: null };
      });
      return result;
    } catch (error) {
      await this.store.update(s => {
        s.notificationStatus.lastError = error.message;
        event(s, `Windows 通知发送失败：${error.message}。插件页内提醒仍然保留。`, 'warning', this.now());
      });
      throw error;
    }
  }
  async deliverScheduledTests() {
    if (!this.notify) return;
    for (const test of this.store.state.notificationTests.filter(t => t.status === 'pending' &&
      t.dueAt <= this.now() && (t.nextRetryAt || 0) <= this.now() && t.attempts < 3)) {
      await this.store.update(s => {
        const current = s.notificationTests.find(t => t.id === test.id);
        current.attempts++; current.nextRetryAt = this.now() + 60000;
      });
      try {
        await this.sendNotice({ id: test.id, title: '重置卡防过期提醒 · 后台定时测试',
          body: '一分钟后台提醒测试已触发。即使插件页面未打开，也可以发送 Windows 通知。本次没有使用任何重置卡。' });
        await this.store.update(s => {
          const current = s.notificationTests.find(t => t.id === test.id);
          current.status = 'sent'; current.sentAt = this.now();
          event(s, '后台定时测试通知已提交 Windows；横幅显示仍取决于系统通知设置。', 'success', this.now());
        });
      } catch {
        await this.store.update(s => {
          const current = s.notificationTests.find(t => t.id === test.id);
          if (current.attempts >= 3) current.status = 'failed';
        });
      }
    }
  }
  async deliverExpiryNotices(snapshot) {
    if (!this.notify || !this.store.state.reminderEnabled || this.noticePauseRequested || !snapshot.accountId) return;
    const active = new Set(dueCards(snapshot, this.now(), durationOf(this.store.state.notifyBefore)).map(c => receiptId(snapshot.accountId, c)));
    for (const n of this.store.state.notifications.filter(n => n.accountId === snapshot.accountId &&
      !n.read && !n.toastSentAt && n.id === this.noticeId(snapshot.accountId, n) &&
      active.has(receiptId(snapshot.accountId, n)) && n.expiresAt * 1000 > this.now() &&
      !this.store.state.attempts[n.creditId]?.done && !this.store.state.reminderReceipts[n.id])) {
      if (this.noticePauseRequested || this.stopping || !(await this.canExecute())) return;
      if (this.noticePauseRequested || this.stopping) return;
      if (n.id !== this.noticeId(snapshot.accountId, n)) continue;
      // Persist the claim before Windows submission. Even a crash or lost reply cannot re-submit it.
      await this.store.update(s => {
        s.reminderReceipts[n.id] = { attemptedAt: this.now() };
        const current = s.notifications.find(item => item.id === n.id);
        current.toastAttemptedAt = this.now();
      });
      if (this.noticePauseRequested || this.stopping) return;
      try {
        const expiry = new Date(n.expiresAt * 1000).toLocaleString('zh-CN', { timeZone: this.store.state.reminderTimezone, hour12: false });
        await this.sendNotice({ id: n.id, title: '重置卡即将到期', body: `你的完全重置卡剩余不足${this.store.state.notifyBefore}，将于 ${expiry} 到期。请及时使用。本次打开中不再重复此时长的提醒。` });
        await this.store.update(s => { s.notifications.find(item => item.id === n.id).toastSentAt = this.now(); });
      } catch { /* Keep the page notice, without re-submitting and risking duplicate banners. */ }
    }
  }
  async checkReminders(snapshot) {
    if (!this.store.state.reminderEnabled || this.noticePauseRequested || !snapshot.accountId) return;
    const now = this.now();
    const candidates = dueCards(snapshot, now, durationOf(this.store.state.notifyBefore))
      .filter(c => !this.store.state.attempts[c.id]?.done);
    const pending = candidates.filter(c => !this.store.state.reminderReceipts[this.noticeId(snapshot.accountId, c)] &&
      !this.store.state.notifications.some(n => n.id === this.noticeId(snapshot.accountId, c)));
    if (!pending.length) return;
    await this.store.update(s => {
      for (const c of pending) s.notifications.push({ id: this.noticeId(snapshot.accountId, c),
        sessionId: s.reminderSession.id, threshold: s.notifyBefore,
        accountId: snapshot.accountId, creditId: c.id, time: now, read: false, expiresAt: c.expiresAt,
        message: `这张重置卡剩余不足${s.notifyBefore}。` });
    });
  }
  setEnabled(enabled) {
    return this.setSettings({ useBefore: enabled ? (this.store.state.useBefore === '永不使用' ? '1小时' : this.store.state.useBefore) : '永不使用' });
  }
  tick() {
    return this.serial(async () => {
      if (this.stopping) return;
      if (!(await this.observeRuntime())) return;
      // Tests do not depend on account connectivity, card availability, or business switches.
      await this.deliverScheduledTests();
      const snapshot = await this.read();
      let refreshed = snapshot;
      for (const c of dueCards(snapshot, this.now(), durationOf(this.store.state.useBefore))) {
        refreshed = await this.attemptUse(refreshed, c.id);
      }
      if (this.stopping || !(await this.canExecute())) return;
      await this.checkReminders(refreshed);
      await this.deliverExpiryNotices(refreshed);
    });
  }
  async attemptUse(snapshot, creditId) {
      if (!this.store.state.enabled || this.pauseRequested || this.stopping) return snapshot;
      const now = this.now();
      const card = dueCards(snapshot, now, durationOf(this.store.state.useBefore)).find(c => {
        if (c.id !== creditId) return false;
        const attempt = this.store.state.attempts[c.id];
        return !attempt || (attempt.accountId === snapshot.accountId &&
          !attempt.done && (attempt.nextRetryAt || 0) <= now);
      });
      if (!card) return snapshot;
      // Persist before sending; an ambiguous timeout must reuse this exact key after restart.
      await this.store.update(s => {
        const previous = s.attempts[card.id];
        s.attempts[card.id] = {
          accountId: snapshot.accountId,
          key: previous?.key || randomUUID(), nextRetryAt: now + 60000, done: false,
        };
      });
      if (this.pauseRequested || this.stopping || card.expiresAt * 1000 <= this.now() || !(await this.canExecute())) return snapshot;
      if (this.pauseRequested || this.stopping || card.expiresAt * 1000 <= this.now()) return snapshot;
      const attempt = this.store.state.attempts[card.id];
      try {
        const { outcome } = await this.api.request('account/rateLimitResetCredit/consume', {
          creditId: card.id, idempotencyKey: attempt.key,
        });
        if (!['reset', 'alreadyRedeemed', 'nothingToReset', 'noCredit'].includes(outcome)) {
          throw new Error('服务端返回未知结果，将保留原请求标识等待重试');
        }
        await this.store.update(s => {
          const a = s.attempts[card.id];
          if (outcome === 'reset' || outcome === 'alreadyRedeemed') {
            a.done = true;
            for (const n of s.notifications) if (n.accountId === snapshot.accountId && n.creditId === card.id) n.read = true;
            event(s, `已自动使用重置卡（到期：${new Date(card.expiresAt * 1000).toISOString()}）。`, 'success', this.now());
          } else {
            // A definitive non-redemption ends this attempt. The next poll is a new attempt.
            a.key = null;
            a.nextRetryAt = this.now() + 60000;
            event(s, outcome === 'nothingToReset'
              ? '服务端返回“没有可重置的额度”，本次未消耗卡片；过期前将继续重试。'
              : '服务端返回“无可用重置卡”，本次未成功；将刷新卡片状态。', 'warning', this.now());
          }
        });
      } catch (error) {
        this.error = error.message;
        await this.store.update(s => {
          s.attempts[card.id].nextRetryAt = this.now() + 60000;
          event(s, `自动使用未确认成功：${error.message}。重试时沿用同一请求标识。`, 'error', this.now());
        });
      }
      // Always re-read; do not infer new balances or available cards from consume's result.
      return await this.read();
  }
  delay() {
    if (this.runtimeActive !== true) return 15000;
    const now = this.now();
    const testTargets = this.store.state.notificationTests.filter(t => t.status === 'pending' && t.attempts < 3)
      .map(t => Math.max(t.dueAt, t.nextRetryAt || 0));
    const targets = [];
    for (const c of cardsOf(this.snapshot)) {
      if (c.status !== 'available' || c.resetType !== 'codexRateLimits' || !Number.isFinite(c.expiresAt) ||
          c.expiresAt * 1000 <= now || this.store.state.attempts[c.id]?.done) continue;
      const useDuration = durationOf(this.store.state.useBefore), notifyDuration = durationOf(this.store.state.notifyBefore);
      if (useDuration !== null) targets.push(Math.max(c.expiresAt * 1000 - useDuration + 1, this.store.state.attempts[c.id]?.nextRetryAt || 0));
      if (notifyDuration !== null && !this.store.state.reminderReceipts[this.noticeId(this.snapshot?.accountId, c)]) {
        targets.push(c.expiresAt * 1000 - notifyDuration + 1);
      }
    }
    const next = [...targets, ...testTargets].filter(t => t > now);
    return Math.max(1000, Math.min(60000, ...next.map(t => t - now)));
  }
  status() {
    const availableIds = new Set(dueCards(this.snapshot, this.now(), durationOf(this.store.state.notifyBefore)).map(c => receiptId(this.snapshot?.accountId, c)));
    const notifications = this.store.state.reminderEnabled ? this.store.state.notifications.filter(n =>
      n.accountId === this.snapshot?.accountId && n.id === this.noticeId(n.accountId, n) && availableIds.has(receiptId(this.snapshot?.accountId, n)) &&
      n.expiresAt * 1000 > this.now() && !this.store.state.attempts[n.creditId]?.done) : [];
    return { workerVersion: VERSION, enabled: this.store.state.enabled, reminderEnabled: this.store.state.reminderEnabled,
      ...this.settings(),
      reminderTimezone: this.store.state.reminderTimezone,
      runtimeActive: this.runtimeActive, onlyWhileCodexOpen: true,
      unreadCount: notifications.filter(n => !n.read).length, notifications,
      notificationStatus: this.store.state.notificationStatus,
      notificationTests: this.store.state.notificationTests.slice(-5),
      boundAccountId: this.store.state.accountId,
      currentAccountId: this.snapshot?.accountId ?? null,
      lastCheck: this.lastCheck, error: this.error,
      availableCount: this.snapshot?.rateLimitResetCredits?.availableCount ?? null,
      detailsAvailable: Array.isArray(this.snapshot?.rateLimitResetCredits?.credits),
      cards: cardsOf(this.snapshot).map(card => ({ ...card,
        notificationAttempted: !!this.store.state.reminderReceipts[this.noticeId(this.snapshot?.accountId, card)],
        scheduledAt: Number.isFinite(card.expiresAt) && durationOf(this.store.state.useBefore) !== null
          ? card.expiresAt * 1000 - durationOf(this.store.state.useBefore) + 1 : null,
        reminderAt: Number.isFinite(card.expiresAt) && durationOf(this.store.state.notifyBefore) !== null
          ? card.expiresAt * 1000 - durationOf(this.store.state.notifyBefore) + 1 : null,
        completed: this.store.state.attempts[card.id]?.done || false,
      })), events: this.store.state.events.slice(-20).reverse() };
  }
}
