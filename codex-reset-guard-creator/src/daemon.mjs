import net from 'node:net';
import { readFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AppServer } from './app-server.mjs';
import { Engine } from './engine.mjs';
import { Store, atomicWrite } from './store.mjs';
import { dataDirectory, pipeName } from './paths.mjs';
import { isCodexOpen, getCodexPresence } from './app-presence.mjs';
import { sendWindowsNotification } from './windows-notifications.mjs';
import { RestartNotificationTest } from './restart-test.mjs';
import { requireWindows } from './platform.mjs';

requireWindows();

// A local plugin worker, reached only over a named pipe. No web server or page.
const token = randomBytes(32).toString('hex');
let connection, engine, timer, stopping = false;
const restartTest = new RestartNotificationTest(dataDirectory, getCodexPresence, sendWindowsNotification);
const api = { async request(method, params) {
  try {
    if (!connection) { connection = new AppServer(); await connection.connect(); }
    return await connection.request(method, params);
  } catch (error) { connection?.close(); connection = null; throw error; }
} };
function schedule(immediate = false) {
  clearTimeout(timer);
  if (stopping) return;
  timer = setTimeout(async () => {
    // This test is intentionally in the plugin worker, before account/network access.
    try { await restartTest.tick(); } catch (error) { console.error('重启模拟测试：' + error.message); }
    try { await engine.tick(); } catch (error) { engine.error = error.message; }
    schedule();
  }, immediate ? 0 : engine.delay());
}
async function dispatch(message) {
  const supplied = typeof message.token === 'string' ? Buffer.from(message.token) : Buffer.alloc(0);
  const expected = Buffer.from(token);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('本机插件认证失败');
  if (!engine) throw new Error('插件后台正在启动');
  if (message.method === 'status') return engine.status();
  if (message.method === 'checkNow') { schedule(true); return { scheduled: true }; }
  if (message.method === 'refresh') { await engine.refresh(); schedule(true); return engine.status(); }
  if (message.method === 'setEnabled') {
    if (typeof message.params?.enabled !== 'boolean') throw new Error('enabled 必须为布尔值');
    await engine.setEnabled(message.params.enabled); schedule(true); return engine.status();
  }
  if (message.method === 'readSettings') return engine.settings();
  if (message.method === 'updateSettings') {
    const values = await engine.setSettings(message.params?.set);
    schedule(true); return values;
  }
  if (message.method === 'acknowledge') { await engine.acknowledge(); return engine.status(); }
  if (message.method === 'testNotification') return await engine.testNotificationNow();
  if (message.method === 'scheduleNotificationTest') {
    const test = await engine.scheduleNotificationTest(message.params?.delaySeconds ?? 60);
    schedule(); return { test, ...engine.status() };
  }
  if (message.method === 'shutdown') {
    await engine.setEnabled(false);
    setTimeout(shutdown, 50); return { stopped: true };
  }
  if (message.method === 'shutdownForUpgrade') {
    engine.pauseRequested = true; engine.stopping = true;
    setTimeout(shutdown, 50); return { stopped: true, settingsPreserved: true };
  }
  throw new Error('未知插件方法');
}
const server = net.createServer(socket => {
  socket.setEncoding('utf8');
  let input = '', handled = false;
  socket.setTimeout(60000, () => socket.destroy());
  socket.on('error', () => {});
  socket.on('data', chunk => {
    if (handled) return;
    input += chunk.toString('utf8');
    if (Buffer.byteLength(input) > 4096) { socket.destroy(); return; }
    if (!input.includes('\n')) return;
    handled = true;
    void (async () => {
      try { socket.end(JSON.stringify({ result: await dispatch(JSON.parse(input.split('\n')[0])) }) + '\n'); }
      catch (error) { socket.end(JSON.stringify({ error: error.message }) + '\n'); }
    })();
  });
});
server.on('error', error => { console.error(error.message); process.exit(1); });
async function shutdown() {
  if (stopping) return;
  stopping = true; clearTimeout(timer);
  if (engine) { engine.stopping = true; engine.pauseRequested = true; }
  connection?.close();
  try {
    const descriptor = join(dataDirectory, 'service.json');
    const current = JSON.parse(await readFile(descriptor, 'utf8'));
    if (current.pid === process.pid) await unlink(descriptor);
  } catch {}
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
await mkdir(dataDirectory, { recursive: true });
server.listen(pipeName, async () => {
  try {
    const store = await new Store(dataDirectory).load();
    engine = new Engine(store, api, Date.now, isCodexOpen, sendWindowsNotification, getCodexPresence);
    await atomicWrite(join(dataDirectory, 'service.json'), { pid: process.pid, pipeName, token, version: 2 });
    schedule(true);
  } catch (error) { console.error(error.message); await shutdown(); }
});
