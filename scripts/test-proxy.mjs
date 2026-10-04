// test-proxy.mjs — 验证 /proxy 代理是否解决 CDN Referer 403
// 通过本地代理请求B站直链（模拟 file:// 页面的 <video>：不带任何 Referer 头发给代理，
// 代理负责补 Referer）→ 期望 200 + Range 206
import { getPlayUrlDurl } from '../media.js';

const d = await getPlayUrlDurl('BV1CAxaeHEeH', { page: 8 });
const proxied = 'http://127.0.0.1:8930/proxy?url=' + encodeURIComponent(d.url);
console.log('直链 host:', new URL(d.url).host, 'qn:', d.quality);

async function probe(label, headers) {
  try {
    const r1 = await fetch(proxied, { headers, signal: AbortSignal.timeout(20000) });
    try { await r1.body?.cancel(); } catch { /* ignore */ }
    console.log(`${label} 初始GET: status=${r1.status} len=${r1.headers.get('content-length')} accept-ranges=${r1.headers.get('accept-ranges')}`);
    const r2 = await fetch(proxied, { headers: { ...headers, Range: 'bytes=100000-100999' }, signal: AbortSignal.timeout(20000) });
    try { await r2.body?.cancel(); } catch { /* ignore */ }
    console.log(`${label} Range: status=${r2.status} content-range=${r2.headers.get('content-range')}`);
    return r1.status === 200 && r2.status === 206;
  } catch (e) {
    console.log(`${label} 失败: ${e.cause?.code || e.message}`);
    return false;
  }
}

const ok1 = await probe('经代理(无Referer,模拟file://页面)', {});
console.log(ok1
  ? '\n✅ 代理方案验证通过：403 已解决，原生 <video> 可播放+seek'
  : '\n❌ 代理未解决问题');
