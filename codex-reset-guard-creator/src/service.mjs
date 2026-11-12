import net from 'node:net';
import { readFile, mkdir, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDirectory, pipeName } from './paths.mjs';
import { VERSION } from './version.mjs';
import { requireWindows } from './platform.mjs';
import { createWorkerLifecycle, withWorkerTransitionLock } from './worker-lifecycle.mjs';

export async function serviceRequest(method, params) {
  requireWindows();
  const descriptor = JSON.parse(await readFile(join(dataDirectory, 'service.json'), 'utf8'));
  if (descriptor.pipeName !== pipeName) throw new Error('插件后台连接配置不匹配');
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection(pipeName);
    socket.setEncoding('utf8');
    let input = '';
    socket.setTimeout(method === 'status' ? 3000 : 55000, () => { socket.destroy(); reject(new Error('插件后台请求超时')); });
    socket.on('error', reject);
    socket.on('connect', () => socket.write(JSON.stringify({ token: descriptor.token, method, params }) + '\n'));
    socket.on('data', chunk => {
      input += chunk.toString('utf8');
      if (input.includes('\n')) {
        socket.destroy();
        try {
          const message = JSON.parse(input.split('\n')[0]);
          if (message.error) reject(new Error(message.error)); else resolve(message.result);
        } catch (error) { reject(error); }
      }
    });
    socket.on('end', () => { if (!input.includes('\n')) reject(new Error('插件后台提前断开')); });
  });
}
async function startWorker() {
  await mkdir(dataDirectory, { recursive: true });
  const log = await open(join(dataDirectory, 'startup.log'), 'a');
  const child = spawn(process.execPath, [fileURLToPath(new URL('./daemon.mjs', import.meta.url))], {
    detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd], env: process.env,
  });
  try {
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  } finally { await log.close(); }
}
const ensureWorker = createWorkerLifecycle({ version: VERSION, request: serviceRequest, start: startWorker,
  withLock: operation => withWorkerTransitionLock(pipeName + '-transition', operation) });
export async function ensureService() { requireWindows(); await ensureWorker(); }
