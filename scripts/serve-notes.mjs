// serve-notes.mjs — 本地笔记服务器：静态托管 + B站CDN代理（补 Referer）
// 用法：node scripts/serve-notes.mjs [端口，默认8930]
// 打开：http://127.0.0.1:8930/output/<目录>/<笔记>.html
// 作用：
//   1. 静态托管 bilibili-mcp 目录（笔记 HTML + 截图可正常显示）
//   2. /proxy?url=... 代理B站 CDN 请求并自动带 Referer: https://www.bilibili.com/
//      —— file:// 页面的 <video> 无法伪造 Referer（实测403），经此代理后原生播放器获得完整
//      播放/seek/暂停能力，空降随之根治；视频仍由B站 CDN 在线流式传输，不落盘。
import http from 'node:http';
import { createReadStream, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.zip': 'application/zip', '.css': 'text/css',
};

function listNotes() {
  const outDir = join(ROOT, 'output');
  const items = [];
  if (!existsSync(outDir)) return items;
  for (const d of readdirSync(outDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = join(outDir, d.name);
    for (const f of readdirSync(dir)) {
      if (f.endsWith('.html') && !f.startsWith('frames')) {
        items.push({ dir: d.name, file: f, url: `/output/${d.name}/${f}` });
      }
    }
  }
  return items;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');

  // B站CDN代理：自动补 Referer（file:// 直连403的根因），透传 Range（seek 需要）
  if (u.pathname === '/proxy') {
    const target = u.searchParams.get('url');
    if (!target || !/^https:\/\/[^/]*(bilibili|bilivideo|mcdn)/.test(target)) {
      res.writeHead(400, { 'Access-Control-Allow-Origin': '*' }); res.end('bad url'); return;
    }
    try {
      const headers = { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' };
      if (req.headers.range) headers.Range = req.headers.range;
      const r = await fetch(target, { headers, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      const rh = {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': r.headers.get('content-type') || 'application/octet-stream',
        'Accept-Ranges': r.headers.get('accept-ranges') || 'bytes',
      };
      const cl = r.headers.get('content-length'); if (cl) rh['Content-Length'] = cl;
      const cr = r.headers.get('content-range'); if (cr) rh['Content-Range'] = cr;
      res.writeHead(r.status, rh);
      if (r.body && res.writable) {
        // 视频 seek 会中断上一次 Range 请求 → 上游流会 error/abort，必须挂处理器否则整个服务器崩
        const stream = Readable.fromWeb(r.body);
        stream.on('error', () => { try { res.destroy(); } catch { /* ignore */ } });
        res.on('close', () => { try { stream.destroy(); } catch { /* ignore */ } });
        stream.pipe(res);
      } else { res.end(); }
    } catch (e) {
      res.writeHead(502, { 'Access-Control-Allow-Origin': '*' }); res.end(String(e && e.message || e));
    }
    return;
  }

  // 落地页：列出所有笔记
  if (u.pathname === '/' || u.pathname === '/index.html') {
    const notes = listNotes();
    const rows = notes.map((n) => `<li><a href="${n.url}">${n.dir} / ${n.file}</a></li>`).join('\n');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><meta charset="utf-8"><title>笔记列表</title>
<body style="font-family:system-ui;max-width:720px;margin:40px auto">
<h1>B站视频笔记（本地服务器模式）</h1>
<p>此模式下小窗播放走 <b>/proxy</b> 代理（自动补B站 Referer）→ 原生播放器完整支持空降/暂停。
视频仍由B站 CDN 在线流式传输，不下载到本地。</p>
<ul style="line-height:2">${rows}</ul></body>`);
    return;
  }

  // 静态文件
  const fp = normalize(join(ROOT, decodeURIComponent(u.pathname)));
  if (!fp.startsWith(ROOT) || !existsSync(fp) || !statSync(fp).isFile()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(fp).toLowerCase()] || 'application/octet-stream' });
  createReadStream(fp).pipe(res);
});

const basePort = Number(process.argv[2]) || 8930;
function listen(port, tries) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && tries > 0) listen(port + 1, tries - 1);
    else { console.error('启动失败:', e.message); process.exit(1); }
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`笔记服务器已启动（端口 ${port}）：`);
    console.log(`  http://127.0.0.1:${port}/`);
    for (const n of listNotes()) console.log(`  http://127.0.0.1:${port}${n.url}`);
    console.log('按 Ctrl+C 停止');
  });
}
listen(basePort, 10);
