import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAppTool, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import { OpenAIExtensions } from '@openai/mcp-extensions/server';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { ensureService, serviceRequest } from './service.mjs';
import { settingsSchema, settingsLayout } from './settings.mjs';
import { uiUri, dashboardResource } from './ui.mjs';
import { VERSION } from './version.mjs';
import { platformSupport, routePlatformRequest } from './platform.mjs';

const navigationIcon = await readFile(new URL('../assets/icon-nav.png', import.meta.url));
const icons = [{ src: `data:image/png;base64,${navigationIcon.toString('base64')}`, mimeType: 'image/png', sizes: ['48x48'] }];
const server = new McpServer({ name: 'codex-reset-guard-creator', title: '重置卡防过期提醒', version: VERSION, icons });
const extensions = new OpenAIExtensions(server);
const empty = z.strictObject({});
async function request(method, params) {
  return await routePlatformRequest(method, params, async (method, params) => {
    await ensureService();
    return await serviceRequest(method, params);
  });
}
const result = value => ({ structuredContent: value, content: [{ type: 'text', text: JSON.stringify(value) }] });
const run = method => async args => result(await request(method, args));
const readonly = { readOnlyHint: true, openWorldHint: false };

// Separate global and conversation entrypoints, as recommended by Extensions patterns.
for (const [name, type] of [['reset_guard_open', 'global'], ['reset_guard_open_in_chat', 'thread']]) {
  registerAppTool(server, name, {
    title: '重置卡防过期提醒',
    description: '打开重置卡防过期提醒页面，显示时长设置、卡片计划及到期提醒。当前版本仅支持 Windows。',
    inputSchema: empty, annotations: readonly,
    _meta: { ui: { resourceUri: uiUri, visibility: ['app', 'model'] }, 'openai/ui': { entrypoints: [{ type }] } },
  }, run('refresh'));
}
server.registerTool('reset_guard_status', {
  title: '查看重置卡状态', description: '读取本地缓存与计划，不会使用卡片。', inputSchema: empty, annotations: readonly,
}, run('status'));
server.registerTool('reset_guard_refresh', {
  title: '刷新重置卡', description: '刷新当前账号卡片，不会更改时长设置。', inputSchema: empty, annotations: readonly,
}, run('refresh'));
server.registerTool('reset_guard_acknowledge', {
  title: '标记提醒已读', description: '标记当前账号到期提醒已读。', inputSchema: empty,
  annotations: { readOnlyHint: false, destructiveHint: false }, _meta: { ui: { visibility: ['app'] } },
}, run('acknowledge'));
server.registerTool('reset_guard_test_notification', {
  title: '通知测试', description: '用户点击插件页面的通知测试按钮后，发送一条 Windows 测试通知，不使用卡片或更改时长设置。',
  inputSchema: empty,
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  _meta: { ui: { visibility: ['app'] } },
}, run('testNotification'));
server.registerTool('reset_guard_debug_read', {
  title: '读取 Debug 启动测试', description: '仅插件 Debug 面板读取启动通知测试开关，不发送通知。',
  inputSchema: empty, annotations: readonly, _meta: { ui: { visibility: ['app'] } },
}, run('readStartupDebug'));
server.registerTool('reset_guard_debug_update', {
  title: '设置 Debug 启动测试', description: '仅用户在插件 Debug 面板主动操作后，保存下次启动 Codex 时的通知测试开关。',
  inputSchema: z.strictObject({ enabled: z.boolean() }),
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  _meta: { ui: { visibility: ['app'] } },
}, run('updateStartupDebug'));

// SDK generates schemas, validates inputs/outputs, and advertises the settings capability.
extensions.settings.register({
  fields: Object.fromEntries(Object.entries(settingsSchema.properties).map(([key, field]) => [key, {
    schema: z.enum(field.enum), title: field.title, description: field.description,
  }])),
  layout: [{ ...settingsLayout[0], title: platformSupport().supported ? '重置卡防过期提醒' : platformSupport().supportMessage }],
  read: () => request('readSettings'),
  update: set => request('updateSettings', { set }),
});
registerAppResource(server, '重置卡防过期提醒', uiUri, {}, () => dashboardResource());
server.server.oninitialized = () => {
  if (!platformSupport().supported) return;
  void (async () => { await ensureService(); await serviceRequest('checkNow'); })().catch(error => console.error(error.message));
};
await server.connect(new StdioServerTransport());
