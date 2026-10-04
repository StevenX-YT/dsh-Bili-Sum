// scripts/test-spawn.mjs — 验证 file-stdio 方式启动 whisper main.exe
import { spawn } from 'node:child_process';
import { open, readFile } from 'node:fs/promises';

const cli = 'C:/Users/50855/Documents/deepseek-harness/default-workspace/bilibili-mcp/tools/whisper/Release/main.exe';
const log = 'C:/Users/50855/Documents/deepseek-harness/default-workspace/bilibili-mcp/bin/tmp/spawn-test.log';
const fh = await open(log, 'w');
const child = spawn(cli, ['--help'], { stdio: ['ignore', 'ignore', fh.fd], windowsHide: true });
child.on('error', (e) => console.log('ERROR event:', e.message));
child.on('close', async (code) => {
  await fh.close();
  console.log('exit code:', code);
  const text = await readFile(log, 'utf8').catch(() => '(read fail)');
  console.log('log head:', text.slice(0, 400));
});
