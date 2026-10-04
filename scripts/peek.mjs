// scripts/peek.mjs — 查看视频基本信息与分 P 列表
// 用法：node scripts/peek.mjs <BV号或链接>
import { videoInfo, resolveId } from '../bili.js';

const input = process.argv[2];
const id = await resolveId(input);
const info = await videoInfo(id);
console.log(JSON.stringify({
  bvid: info.bvid,
  aid: info.aid,
  title: info.title,
  owner: info.owner?.name,
  duration: info.duration,
  pubdate: info.pubdate,
  tname: info.tname,
  url: info.url,
  resolvedPage: id.page || 1,
  stat: { view: info.stat?.view, like: info.stat?.like, danmaku: info.stat?.danmaku, reply: info.stat?.reply },
  pageCount: info.pages?.length ?? 0,
  pages: info.pages,
  subtitleLangs: (info.subtitles || []).map((s) => s.lang),
}, null, 2));
