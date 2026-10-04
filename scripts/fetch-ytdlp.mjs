// 下载/更新 yt-dlp.exe 到数据根 bin/（优先 GitHub，失败自动走国内镜像）
// 用法：node scripts/fetch-ytdlp.mjs
// 数据根：BILI_DATA_ROOT（dsh 插件 patch 注入）优先，缺省=包目录 bin/（老布局兼容）
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BIN_DIR } from '../paths.js';

const binDir = BIN_DIR;
const out = join(binDir, 'yt-dlp.exe');

const urls = [
  'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  'https://ghfast.top/https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  'https://mirror.ghproxy.com/https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
  'https://gh-proxy.com/https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
];

await mkdir(binDir, { recursive: true });

for (const url of urls) {
  console.log('trying', url);
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(240000) });
    if (!res.ok) { console.log('  HTTP', res.status); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 5 * 1024 * 1024) { console.log('  too small:', buf.length); continue; }
    const tmp = out + '.part';
    await writeFile(tmp, buf);
    await rename(tmp, out);
    console.log('saved:', out, buf.length, 'bytes');
    process.exit(0);
  } catch (e) {
    console.log('  error:', e.cause?.code || e.message);
  }
}

console.error('all mirrors failed');
process.exit(1);
