import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDirectory } from './paths.mjs';

export const notificationTag = id => createHash('sha256').update(id).digest('hex').slice(0, 32);
export async function ensureNotificationRuntime() {
  const source = fileURLToPath(new URL('../notification-helper/', import.meta.url));
  const destination = join(dataDirectory, 'WindowsNotifications');
  const files = ['notify.ps1', 'Shortcut.cs', 'notification-icon.ico', 'notification-icon.png'];
  const hash = createHash('sha256');
  for (const file of files) hash.update(await readFile(join(source, file)));
  const fingerprint = hash.digest('hex');
  let installed;
  try { installed = await readFile(join(destination, '.build'), 'utf8'); } catch {}
  if (installed !== fingerprint) {
    await mkdir(destination, { recursive: true });
    for (const file of files) await cp(join(source, file), join(destination, file), { force: true });
    await writeFile(join(destination, '.build'), fingerprint);
  }
  return join(destination, 'notify.ps1');
}
export const systemPowerShell = () => join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
export const notificationArguments = (script, mode = 'send') => ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script, '-Mode', mode];
export async function sendWindowsNotification({ title, body, id }) {
  if (process.platform !== 'win32') throw new Error('Windows 系统通知仅支持 Windows');
  const executable = await ensureNotificationRuntime();
  return new Promise((resolve, reject) => {
    const child = spawn(systemPowerShell(), notificationArguments(executable), { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '', settled = false;
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timeout);
      error ? reject(error) : resolve(result);
    };
    const timeout = setTimeout(() => { child.kill(); finish(new Error('Windows 通知组件超时')); }, 20000);
    child.on('error', error => finish(error));
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') finish(error); });
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', text => { output += text; });
    child.stderr.on('data', text => { errors += text; });
    child.on('close', code => {
      if (code !== 0) { finish(new Error(errors.trim() || `Windows 通知组件退出：${code}`)); return; }
      try {
        const result = JSON.parse(output.trim());
        if (result.accepted !== true) throw new Error('Windows 未确认接受通知');
        finish(null, result);
      } catch (error) { finish(error); }
    });
    child.stdin.end(JSON.stringify({ title, body, tag: notificationTag(id) }));
  });
}
