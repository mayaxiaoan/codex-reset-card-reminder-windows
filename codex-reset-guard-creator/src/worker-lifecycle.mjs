import net from 'node:net';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const absent = error => ['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(error.code);
function compatible(status, version) {
  if (!status) return false;
  const parse = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value)
    ? value.split('.').map(Number) : null;
  const running = parse(status.workerVersion), wanted = parse(version);
  if (!running || !wanted) throw new Error('无法确认插件后台版本，请重新加载插件。');
  for (let i = 0; i < 3; i++) {
    if (running[i] !== wanted[i]) {
      // An older connection must never stop or downgrade the newly upgraded worker.
      if (running[i] > wanted[i]) {
        if (running[0] !== wanted[0]) throw new Error('插件后台版本较新，请重新加载插件。');
        return true;
      }
      return false;
    }
  }
  return true;
}

// An OS-owned pipe lock disappears on process exit; no stale lock files or PID kills.
export async function withWorkerTransitionLock(pipe, operation, timeout = 20000) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const lock = net.createServer(socket => socket.destroy());
    const acquired = await new Promise((resolve, reject) => {
      lock.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
      lock.listen(pipe, () => resolve(true));
    });
    if (acquired) {
      try { return await operation(); }
      finally { await new Promise(resolve => lock.close(resolve)); }
    }
    if (Date.now() >= deadline) throw new Error('插件后台正在升级，请稍后重试。');
    await sleep(100);
  }
}

export function createWorkerLifecycle({ version, request, start, withLock, wait = sleep, now = Date.now,
  stopTimeout = 5000, startTimeout = 10000 }) {
  let pending;
  async function status() {
    try { return await request('status'); }
    catch (error) { if (absent(error)) return null; throw error; }
  }
  async function transition() {
    if (compatible(await status(), version)) return;
    return await withLock(async () => {
      let running = await status();
      if (compatible(running, version)) return;
      if (running) {
        // Never use shutdown: that command deliberately disables the user's settings.
        const stopped = await request('shutdownForUpgrade');
        if (stopped?.stopped !== true || stopped.settingsPreserved !== true) {
          throw new Error('旧插件后台未确认保留设置，已取消升级。');
        }
        const deadline = now() + stopTimeout;
        while ((running = await status())) {
          if (compatible(running, version)) return;
          if (now() >= deadline) throw new Error('旧插件后台尚未退出，请稍后重试。');
          await wait(100);
        }
      }
      await start();
      const deadline = now() + startTimeout;
      do {
        if (compatible(await status(), version)) return;
        await wait(100);
      } while (now() < deadline);
      throw new Error('插件后台启动失败，请查看本机插件启动日志。');
    });
  }
  return function ensureWorker() {
    if (!pending) pending = transition().finally(() => { pending = null; });
    return pending;
  };
}
