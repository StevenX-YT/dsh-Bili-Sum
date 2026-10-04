// probe-dash-noref.mjs — 关键取证：B站 DASH 流在无 Referer（file://页面）下是否可用
// 若可用 → MSE 方案可行（重制方向）；若403 → 任何本地直连方案都不可行
import { getPlayUrl } from '../media.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const dash = await getPlayUrl('BV1CAxaeHEeH', { page: 8, videoQn: 64 });
console.log('video url host: ' + (dash.video?.url ? new URL(dash.video.url).host : 'N/A'));
console.log('audio url host: ' + (dash.audio?.url ? new URL(dash.audio.url).host : 'N/A'));

async function probe(label, url) {
  console.log(`\n=== ${label} ===`);
  if (!url) { console.log('无URL'); return; }
  try {
    const r1 = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000), redirect: 'follow' }); // 无 Referer！
    try { await r1.body?.cancel(); } catch { /* ignore */ }
    console.log(`初始GET(无Referer): status=${r1.status} type=${r1.headers.get('content-type')} len=${r1.headers.get('content-length')} accept-ranges=${r1.headers.get('accept-ranges')}`);
    const r2 = await fetch(url, { headers: { 'User-Agent': UA, Range: 'bytes=500000-500999' }, signal: AbortSignal.timeout(15000), redirect: 'follow' });
    try { await r2.body?.cancel(); } catch { /* ignore */ }
    console.log(`Range(无Referer): status=${r2.status}（206=支持MSE分段/403=被拒）`);
  } catch (e) {
    console.log(`失败: ${e.cause?.code || e.message}`);
  }
}

await probe('DASH video（无 Referer）', dash.video?.url);
await probe('DASH audio（无 Referer）', dash.audio?.url);

// 也测一下 mcdn 音频主机是否同样策略
console.log('\n=== 结论辅助：durl 主机对比 ===');
console.log('（前次已测 durl 主机 cn-fjqz-cm 无Referer=403）');
