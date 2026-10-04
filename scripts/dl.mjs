// scripts/dl.mjs — Node fetch 流式下载（绕过沙箱 schannel 限制），带进度日志
// 用法：node scripts/dl.mjs <url> <outPath> [minMB]
// 退出方式：只设 process.exitCode、不硬 process.exit——硬退出会在 fetch 句柄关闭途中
// 触发 libuv 断言（uv async.c:94，进程以 0xC0000409 崩溃且输出丢失）。
import { createWriteStream, mkdirSync, statSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const [url, out, minMB = '1'] = process.argv.slice(2);
if (!url || !out) { console.error('usage: dl.mjs <url> <out> [minMB]'); process.exitCode = 2; } else {
  const tmp = out + '.part';
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(900000) });
    if (!r.ok) {
      console.log('HTTP', r.status);
      process.exitCode = 1;
    } else {
      mkdirSync(dirname(out), { recursive: true });
      const body = Readable.fromWeb(r.body);
      let received = 0;
      let lastLog = 0;
      body.on('data', (chunk) => {
        received += chunk.length;
        if (received - lastLog >= 20 * 1024 * 1024) {
          lastLog = received;
          console.log(`  ... ${(received / 1048576).toFixed(0)} MB`);
        }
      });
      await pipeline(body, createWriteStream(tmp));
      const size = statSync(tmp).size;
      if (size < Number(minMB) * 1024 * 1024) {
        console.log('too small:', size);
        try { (await import('node:fs/promises')).unlink(tmp); } catch { /* ignore */ }
        process.exitCode = 1;
      } else {
        renameSync(tmp, out);
        console.log('saved', out, size, 'bytes');
      }
    }
  } catch (e) {
    console.log('ERR', e.cause?.code || e.message);
    try { if (existsSync(tmp)) (await import('node:fs/promises')).unlink(tmp); } catch { /* ignore */ }
    process.exitCode = 1;
  }
}
