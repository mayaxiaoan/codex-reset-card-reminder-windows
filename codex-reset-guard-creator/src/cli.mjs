import { ensureService, serviceRequest } from './service.mjs';
try {
  const command = process.argv[2] || 'status';
  if (command === 'start') { await ensureService(); console.log('插件后台已运行。'); }
  else if (command === 'status') {
    await ensureService(); console.log(JSON.stringify(await serviceRequest('refresh'), null, 2));
  } else if (command === 'enable' || command === 'disable') {
    await ensureService(); await serviceRequest('setEnabled', { enabled: command === 'enable' });
    console.log(command === 'enable' ? '防过期已开启。' : '防过期已关闭。');
  } else if (command === 'stop') {
    await serviceRequest('shutdown'); console.log('已关闭防过期并停止插件后台。');
  } else throw new Error('命令：start | status | enable | disable | stop');
} catch (error) { console.error(error.message); process.exitCode = 1; }
