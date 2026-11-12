import { App } from '@modelcontextprotocol/ext-apps';
import { VERSION } from '../src/version.mjs';
const app = new App({ name: '重置卡防过期提醒', version: VERSION });
const controls = ['refresh', 'test-notification', 'remind', 'protect', 'ack'];
const $ = id => document.getElementById(id);
const date = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const element = (tag, text, cls) => { const e = document.createElement(tag); e.textContent = text; if (cls) e.className = cls; return e; };
let status, busy = false;
const clientIsMac = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
function showUnsupported(message) {
  $('platform-warning').textContent = message;
  $('platform-warning').hidden = false;
  $('app-content').hidden = true;
  $('dot').hidden = true;
  for (const id of controls) $(id).disabled = true;
}
if (clientIsMac) showUnsupported('当前版本仅支持 Windows，暂不支持 macOS。系统通知和自动使用暂不可用。');
function error(message) { $('error').hidden = !message; $('error').textContent = message || ''; }
async function call(name, args = {}) {
  const result = await app.callServerTool({ name, arguments: args });
  if (result.isError) throw new Error(result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '插件操作失败');
  return result.structuredContent || JSON.parse(result.content.find(c => c.type === 'text').text);
}
function render(s) {
  if (!s || typeof s.notifyBefore !== 'string' || typeof s.useBefore !== 'string') return;
  status = s;
  if (s.supported === false || clientIsMac) {
    showUnsupported(s.supportMessage || '当前版本仅支持 Windows，暂不支持 macOS。');
    return;
  }
  $('remind').value = s.notifyBefore;
  $('protect').value = s.useBefore;
  for (const id of controls) $(id).disabled = busy;
  $('runtime').textContent = s.runtimeActive === false ? '检查已暂停 · Codex 主窗口未打开'
    : s.runtimeActive === true ? '检查中 · 仅在 Codex 开着时生效' : '等待首次检查 · 仅在 Codex 开着时生效';
  $('count').textContent = s.availableCount ?? '—';
  $('dot').hidden = !s.unreadCount;
  $('notices').hidden = !s.unreadCount;
  $('notice-title').textContent = `有 ${s.unreadCount || 0} 张重置卡已进入提醒时段`;
  $('notice-items').replaceChildren();
  for (const n of s.notifications || []) if (!n.read) $('notice-items').append(element('p', `到期时间：${date(n.expiresAt * 1000)}。请及时使用；本次打开中不再重复此时长的提醒。`));
  $('cards').replaceChildren();
  if (!s.detailsAvailable) $('cards').append(element('p', '暂未获取卡片明细，请点击刷新。', 'empty'));
  else if (!s.cards.length) $('cards').append(element('p', '当前没有可用重置卡。', 'empty'));
  for (const c of s.cards || []) {
    const card = element('article', '', 'card'), top = element('div', '', 'card-top');
    top.append(element('h3', c.resetType === 'codexRateLimits' ? '完全重置' : c.title || '重置卡'),
      element('span', c.completed ? '已使用' : c.status === 'available' ? '可用' : c.status, 'badge'));
    card.append(top, element('p', Number.isFinite(c.expiresAt) ? '到期时间：' + date(c.expiresAt * 1000) : '未提供到期时间，不自动使用'));
    if (c.resetType === 'codexRateLimits' && !c.completed && c.expiresAt * 1000 > Date.now() && c.status === 'available') {
      card.append(element('p', Number.isFinite(c.scheduledAt)
        ? c.scheduledAt <= Date.now() ? '已进入自动使用时段' : '开始自动尝试使用：' + date(c.scheduledAt)
        : '自动使用：永不使用', 'schedule'));
      card.append(element('p', Number.isFinite(c.reminderAt)
        ? c.notificationAttempted ? '本次打开中，此时长的提醒已处理'
          : c.reminderAt <= Date.now() ? '已进入提醒时段' : '进入提醒时段：' + date(c.reminderAt)
        : '到期通知：永不'));
    }
    $('cards').append(card);
  }
  $('lastcheck').textContent = s.lastCheck ? '最近检查：' + date(s.lastCheck) : '尚未成功检查卡片。';
  error(s.error || (s.notificationStatus?.lastError ? '系统通知未成功：' + s.notificationStatus.lastError : null));
}
async function action(operation) {
  if (busy) return;
  busy = true;
  for (const id of controls) $(id).disabled = true;
  try { await operation(); render(await call('reset_guard_status')); }
  catch (e) { error(e.message); }
  finally {
    busy = false;
    if (status) { $('remind').value = status.notifyBefore; $('protect').value = status.useBefore; }
    for (const id of controls) $(id).disabled = !status || status.supported === false || clientIsMac;
  }
}
$('refresh').onclick = () => action(async () => render(await call('reset_guard_refresh')));
$('test-notification').onclick = () => {
  if (busy) return;
  $('notification-test-result').hidden = true;
  return action(async () => {
    $('test-notification').textContent = '发送中…';
    try {
      render(await call('reset_guard_test_notification'));
      $('notification-test-result').textContent = '测试通知已提交 Windows。若未看到弹窗，请检查系统通知设置和勿扰模式。';
      $('notification-test-result').hidden = false;
    } finally {
      $('test-notification').textContent = '通知测试';
    }
  });
};
$('remind').onchange = () => { const value = $('remind').value; return action(() => call('settings.update', { set: { notifyBefore: value } })); };
$('protect').onchange = () => { const value = $('protect').value; return action(() => call('settings.update', { set: { useBefore: value } })); };
$('ack').onclick = () => action(async () => render(await call('reset_guard_acknowledge')));
app.ontoolresult = result => render(result.structuredContent);
try {
  await app.connect();
  if (clientIsMac) {
    showUnsupported('当前版本仅支持 Windows，暂不支持 macOS。系统通知和自动使用暂不可用。');
  } else {
  render(await call('reset_guard_status'));
  $('refresh').disabled = status?.supported === false;
  setInterval(async () => { if (!busy) try { render(await call('reset_guard_status')); } catch (e) { error(e.message); } }, 20000);
  }
} catch (e) { error('无法连接 Codex 插件宿主：' + e.message); }
