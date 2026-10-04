// probe-cdn-hosts.mjs — 核心取证：多次请求 playurl，收集不同 CDN 主机的视频直链，
// 逐一测试「无 Referer」（file:// 页面的真实处境）是否可访问+可 Range。
// 目标：确认是否存在免 Referer 的 CDN 主机（mcdn 等）→ 决定原生 <video> 方案是否可行。
import { getPlayUrlDurl, getPlayUrl } from '../media.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function probeUrl(url) {
  try {
    const r1 = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000), redirect: 'follow' });
    try { await r1.body?.cancel(); } catch { /* ignore */ }
    if (r1.status !== 200) return { ok: false, status: r1.status };
    const r2 = await fetch(url, { headers: { 'User-Agent': UA, Range: 'bytes=100000-100999' }, signal: AbortSignal.timeout(12000), redirect: 'follow' });
    try { await r2.body?.cancel(); } catch { /* ignore */ }
    return { ok: true, status: r1.status, range: r2.status, len: r1.headers.get('content-length') };
  } catch (e) {
    return { ok: false, err: e.cause?.code || e.message };
  }
}

const seen = new Map(); // host -> {url, result}
for (let i = 0; i < 8 && seen.size < 5; i++) {
  try {
    const d = await getPlayUrlDurl('BV1CAxaeHEeH', { page: 8 });
    const host = new URL(d.url).host;
    if (!seen.has(host)) {
      console.log(`第${i + 1}次: host=${host} qn=${d.quality}`);
      const r = await probeUrl(d.url);
      seen.set(host, { url: d.url, result: r, qn: d.quality });
      console.log(`  无Referer探测: ${r.ok ? 'OK 可播' : 'FAIL'} status=${r.status || r.err} range=${r.range || '-'}`);
    }
  } catch (e) {
    console.log(`第${i + 1}次 playurl 失败: ${e.message}`);
  }
}

console.log('\n=== 汇总 ===');
let anyFree = false;
for (const [host, v] of seen) {
  const tag = v.result.ok ? '✅免Referer可用' : `❌${v.result.status || v.result.err}`;
  console.log(`${tag}  ${host}  qn=${v.qn}`);
  if (v.result.ok && v.result.range === 206) anyFree = true;
}
console.log(anyFree
  ? '\n结论：存在免 Referer 且支持 Range 的 CDN 主机 → 原生 <video> 方案可行（注入时多试几次取到这种主机即可）'
  : '\n结论：所有 CDN 主机都强制 Referer → file:// 页面的原生 <video> 播放不可行，必须换方向');
