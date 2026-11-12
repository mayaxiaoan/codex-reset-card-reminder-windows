import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, cp, open, realpath } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version.mjs';

const pluginRoot = fileURLToPath(new URL('../', import.meta.url));
const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const launcher = join(pluginRoot, 'scripts/launch.ps1');
const baseArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', launcher];
const supported = process.platform === 'win32';
function terminate(child) {
  if (child.exitCode !== null) return;
  spawnSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
}
async function isolatedEnvironment() {
  const root = await mkdtemp(join(tmpdir(), 'Reset Guard 中文 '));
  return { ...process.env, PATH: join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
    NODE_OPTIONS: '--require C:\\missing-node-hook.cjs', NODE_PATH: 'C:\\invalid-node-modules',
    DOTNET_ROOT: 'C:\\missing-dotnet', DOTNET_ROOT_X64: 'C:\\missing-dotnet', DOTNET_MULTILEVEL_LOOKUP: '0',
    RESET_GUARD_RUNTIME_CACHE: join(root, '运行环境'), RESET_GUARD_CREATOR_HOME: join(root, 'isolated-state') };
}
function run(args, env, input, script = launcher) {
  return new Promise((resolve, reject) => {
    const child = spawn(powershell, [...baseArgs.slice(0, -1), script, ...args], { windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { terminate(child); reject(new Error('Portable launcher timed out: ' + err)); }, 60000);
    child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; }); child.stdin.end(input || '');
  });
}

test('offline cold start works without Node/.NET on PATH, despite incompatible system environment', { skip: !supported, timeout: 90000 }, async () => {
  const env = await isolatedEnvironment();
  const result = await run(['-Mode', 'runtime-info'], env);
  assert.equal(result.code, 0, result.err);
  const info = JSON.parse(result.out);
  assert.match(info.nodeVersion, /^v22\./);
  assert.ok((await realpath(info.runtimeRoot)).startsWith(await realpath(env.RESET_GUARD_RUNTIME_CACHE)));
  // System notification validation must work without any installed modern .NET runtime.
  const native = await new Promise((resolve, reject) => {
    const child = spawn(info.notificationExecutable, ['--validate'], { windowsHide: true, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = ''; child.on('error', reject); child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    child.on('close', code => resolve({ code, out, err }));
    child.stdin.end(JSON.stringify({ title: '离线验证', body: '不发送通知', tag: 'validation-only' }));
  });
  assert.equal(native.code, 0, native.err); assert.equal(JSON.parse(native.out).validated, true);
});

test('concurrent cold starts share one valid cache and damaged cached runtime is repaired offline', { skip: !supported, timeout: 120000 }, async () => {
  const env = await isolatedEnvironment();
  const [first, second] = await Promise.all([run(['-Mode', 'runtime-info'], env), run(['-Mode', 'runtime-info'], env)]);
  assert.equal(first.code, 0, first.err); assert.equal(second.code, 0, second.err);
  const a = JSON.parse(first.out), b = JSON.parse(second.out);
  assert.equal(a.runtimeRoot, b.runtimeRoot);
  const license = join(a.runtimeRoot, 'node/LICENSE');
  const original = await readFile(license);
  await writeFile(license, 'simulated interrupted/corrupt cache');
  const repaired = await run(['-Mode', 'runtime-info'], env);
  assert.equal(repaired.code, 0, repaired.err);
  assert.deepEqual(await readFile(license), original);
});

test('packaged launcher preserves MCP JSONL stdin/stdout and Unicode without installed Node', { skip: !supported, timeout: 90000 }, async t => {
  const env = await isolatedEnvironment();
  const child = spawn(powershell, baseArgs, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { child.stdin.end(); });
  let errors = '', sequence = 0, protocolError;
  const pending = new Map();
  const lines = createInterface({ input: child.stdout });
  child.stderr.on('data', data => { errors += data; });
  lines.on('line', line => {
    let response;
    try { response = JSON.parse(line); } catch (e) { protocolError = new Error('Non-JSON MCP stdout: ' + line); for (const item of pending.values()) item.reject(protocolError); return; }
    const item = pending.get(response.id);
    if (item) { clearTimeout(item.timer); pending.delete(response.id); item.resolve(response); }
  });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { terminate(child); reject(new Error('Portable MCP timeout: ' + errors)); }, 45000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  // Do not send notifications/initialized: this test must never start the real card worker.
  const initial = await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'portable-verifier', version: '1' } });
  assert.equal(initial.result.serverInfo.version, VERSION);
  assert.equal(initial.result.serverInfo.title, '重置卡防过期提醒');
  assert.equal((await request('tools/list', {})).result.tools.length, 8);
  const resource = (await request('resources/list', {})).result.resources[0];
  const html = await request('resources/read', { uri: resource.uri });
  assert.match(html.result.contents[0].text, /当剩余不足以下时长时通知我/);
  const closed = once(child, 'close');
  child.stdin.end();
  const [exitCode] = await closed;
  assert.equal(exitCode, 0, errors);
  assert.equal(protocolError, undefined);
});

test('a corrupted bundled archive is rejected before executing its runtime', { skip: !supported, timeout: 90000 }, async () => {
  const env = await isolatedEnvironment();
  const damaged = join(env.RESET_GUARD_RUNTIME_CACHE, 'damaged-plugin');
  await cp(join(pluginRoot, 'scripts'), join(damaged, 'scripts'), { recursive: true });
  await cp(join(pluginRoot, 'runtime'), join(damaged, 'runtime'), { recursive: true });
  await cp(join(pluginRoot, 'notification-helper'), join(damaged, 'notification-helper'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(damaged, 'runtime/windows-x64/manifest.json')));
  const part = await open(join(damaged, 'runtime/windows-x64', manifest.parts[0].file), 'r+');
  try { const byte = Buffer.alloc(1); await part.read(byte, 0, 1, 0); byte[0] ^= 255; await part.write(byte, 0, 1, 0); }
  finally { await part.close(); }
  const result = await run(['-Mode', 'runtime-info'], env, '', join(damaged, 'scripts/launch.ps1'));
  assert.equal(result.code, 1);
  assert.match(result.err, /校验失败/);
  assert.equal(result.out, '');
});
