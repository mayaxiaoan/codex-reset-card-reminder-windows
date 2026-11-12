import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { VERSION } from './version.mjs';

// Use the official JSONL protocol. Credentials remain inside Codex.
export class AppServer {
  constructor(binary = process.env.RESET_GUARD_CODEX || 'codex', args = ['app-server', '--stdio']) {
    this.binary = binary;
    this.args = args;
    this.pending = new Map();
    this.sequence = 0;
  }
  async connect() {
    this.child = spawn(this.binary, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.child.stderr.on('data', () => {}); // Never persist auth-bearing diagnostics.
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', () => this.fail(new Error('Codex App Server 已退出')));
    this.lines.on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== undefined && this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          const error = new Error(message.error.message || 'Codex 接口错误');
          error.code = message.error.code;
          pending.reject(error);
        } else pending.resolve(message.result);
      } else if (message.id !== undefined && message.method) {
        this.send({ id: message.id, error: { code: -32601, message: 'Unsupported client request' } });
      }
    });
    await this.request('initialize', {
      clientInfo: { name: 'codex_reset_guard', title: 'Codex Reset Guard', version: VERSION },
      capabilities: { experimentalApi: true },
    });
    this.send({ method: 'initialized', params: {} });
    return this;
  }
  send(message) {
    if (!this.child?.stdin.writable) throw new Error('Codex App Server 未连接');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex 接口超时：${method}`));
      }, 45000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  fail(error) {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear();
  }
  close() {
    this.fail(new Error('Codex 连接已关闭'));
    this.lines?.close();
    this.child?.stdin.end();
    this.child?.kill();
  }
}
