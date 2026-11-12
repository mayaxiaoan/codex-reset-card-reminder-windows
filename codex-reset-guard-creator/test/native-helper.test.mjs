import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script=fileURLToPath(new URL('../notification-helper/windows-x64/ResetGuard.Notifications.exe',import.meta.url));
function validate(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(script, ['--validate'], { windowsHide: true, stdio: ['pipe','pipe','pipe'] });
    let out = '', err = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { err += data; });
    child.on('error', reject); child.on('close', code => resolve({ code, out, err }));
    child.stdin.end(JSON.stringify(payload));
  });
}
test('native notification helper validates UTF-8 content without showing a toast', { skip: process.platform !== 'win32' }, async () => {
  const result = await validate({ title: '重置卡防过期提醒 <&>', body: '测试中文、引号"和换行\n不会破坏传输', tag: 'test-only' });
  assert.equal(result.code, 0); assert.equal(JSON.parse(result.out).validated, true);
});
test('native helper rejects malformed payload without showing a toast', { skip: process.platform !== 'win32' }, async () => {
  const result = await validate({ title: '', body: 'test', tag: 'test-only' });
  assert.equal(result.code, 1); assert.match(result.err, /无效/);
});
