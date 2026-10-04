// scripts/check-cookie.mjs — 验证 bili-cookie.txt 登录态是否有效
// 用法：node scripts/check-cookie.mjs [视频BV号，默认 BV1FtaJ6BEsd]
// 检查：① Cookie 是否加载 ② 评论接口（需登录态）③ 该视频可用字幕轨（含 AI 字幕）
import { getCookie, getComments, getSubtitles, videoInfo } from '../bili.js';

const bvid = process.argv[2] || 'BV1FtaJ6BEsd';
const c = await getCookie();
console.log('cookie loaded:', !!c, c ? `(masked: ${c.slice(0, 12)}...)` : '(无 —— 检查 bili-cookie.txt（数据根或包目录），或运行 node scripts/doctor.mjs 自检)');

try {
  const j = await getComments(bvid, { limit: 20 });
  console.log(`comments: fetched=${j.fetched ?? 'n/a'}, matched=${j.matched ?? 'n/a'}, comments=${j.comments?.length ?? 0}`,
    (j.comments?.length ?? 0) > 0 ? '✅ 登录态有效' : '⚠️ 接口成功但返回 0 条（可能被折叠/风控静默，换 mode=new 复测）');
} catch (e) {
  console.log('comments FAILED:', e.message, '❌');
}

try {
  const j2 = await getComments(bvid, { limit: 20, mode: 'new' });
  console.log(`comments(new): fetched=${j2.fetched ?? 'n/a'}, comments=${j2.comments?.length ?? 0}`,
    (j2.comments?.length ?? 0) > 0 ? '✅ 最新评论可读' : '⚠️ 最新评论也是 0 条');
} catch (e) {
  console.log('comments(new) FAILED:', e.message, '❌');
}

try {
  const info = await videoInfo(bvid);
  const st = await getSubtitles(bvid, {});
  const subs = st?.subtitles ?? st?.data?.subtitle?.subtitles ?? [];
  console.log(`subtitles(${bvid}):`, subs.length ? subs.map((s) => `${s.lang || s.lan}${s.ai ? '(AI)' : ''}`).join(', ') : '该视频无可用字幕轨（AI字幕非全量视频都有）');
  const info2 = await videoInfo('BV1CAxaeHEeH');
  const st2 = await getSubtitles('BV1CAxaeHEeH', {});
  const subs2 = st2?.subtitles ?? st2?.data?.subtitle?.subtitles ?? [];
  console.log(`subtitles(BV1CAxaeHEeH, ${info2.title?.slice(0, 16)}...):`, subs2.length ? subs2.map((s) => `${s.lang || s.lan}${s.ai ? '(AI)' : ''}`).join(', ') : '无可用字幕轨');
} catch (e) {
  console.log('subtitles FAILED:', e.message);
}
