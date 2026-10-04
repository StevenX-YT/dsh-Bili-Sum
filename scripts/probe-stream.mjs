// probe-stream.mjs — 诊断：B站 durl 直链对 <video> 播放/seek 的真实支持情况
// 模拟浏览器 <video> 的三种请求（带B站Referer / 无Referer=跨站嵌入 / file://空Referer），
// 检查：初始响应头（Accept-Ranges/Content-Length）、Range 请求是否返回 206（seek 的前提）
import { getPlayUrlDurl, getPlayUrl } from '../media.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function probe(label, url, headers) {
  console.log(`\n=== ${label} ===`);
  try {
    // 1) 初始请求（仅取响应头，不下载体）
    const r1 = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(20000), redirect: 'follow' });
    // 消耗掉 body 释放连接
    try { await r1.body?.cancel(); } catch { /* ignore */ }
    console.log(`初始 GET: status=${r1.status} type=${r1.headers.get('content-type')} len=${r1.headers.get('content-length')} accept-ranges=${r1.headers.get('accept-ranges')}`);

    // 2) Range 请求（seek 的前提：服务器返回 206 + Content-Range）
    const r2 = await fetch(url, { headers: { ...headers, Range: 'bytes=2000000-2000999' }, signal: AbortSignal.timeout(20000), redirect: 'follow' });
    try { await r2.body?.cancel(); } catch { /* ignore */ }
    console.log(`Range 请求: status=${r2.status}（206=支持seek / 200=忽略Range不支持精确seek） content-range=${r2.headers.get('content-range')}`);
  } catch (e) {
    console.log(`失败: ${e.cause?.code || e.message}`);
  }
}

// 1) durl 直链（当前 <video> 用的源）
const d = await getPlayUrlDurl('BV1CAxaeHEeH', { page: 8 });
console.log('durl quality=' + d.quality + ' exp=' + d.exp + ' segments=' + d.segments);
console.log('url head: ' + d.url.slice(0, 100) + '...');

await probe('A. 带B站Referer（模拟自家页面）', d.url, { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' });
await probe('B. 无Referer（模拟跨站 iframe 嵌入）', d.url, { 'User-Agent': UA });
await probe('C. Referer: null（模拟 file:// 本地页面）', d.url, { 'User-Agent': UA, Referer: 'null' });

// 2) DASH 流（B站自家播放器同款源，备用方案可行性）
console.log('\n=== DASH 流探测（B站自家播放器同源） ===');
try {
  const dash = await getPlayUrl('BV1CAxaeHEeH', { page: 8, videoQn: 64 });
  if (dash.video?.url) {
    console.log('video: ' + dash.video.url.slice(0, 90) + '...');
    const rv = await fetch(dash.video.url, { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/' }, method: 'GET', signal: AbortSignal.timeout(15000) });
    try { await rv.body?.cancel(); } catch { /* ignore */ }
    console.log(`video流: status=${rv.status} accept-ranges=${rv.headers.get('accept-ranges')} len=${rv.headers.get('content-length')}`);
    const rv2 = await fetch(dash.video.url, { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com/', Range: 'bytes=1000000-1000999' }, signal: AbortSignal.timeout(15000) });
    try { await rv2.body?.cancel(); } catch { /* ignore */ }
    console.log(`video流Range: status=${rv2.status}（206=支持分段请求）`);
  } else { console.log('无 video 流'); }
  if (dash.audio?.url) {
    console.log('audio: ' + dash.audio.url.slice(0, 90) + '...');
  } else { console.log('无 audio 流'); }
} catch (e) {
  console.log('DASH 探测失败: ' + (e.cause?.code || e.message));
}
