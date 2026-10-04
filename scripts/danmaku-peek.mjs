// scripts/danmaku-peek.mjs — 查看指定分 P 的弹幕（学习场景：找"没听懂"标记点）
// 用法：node scripts/danmaku-peek.mjs <链接或BV> [limit] [page]
import { getDanmaku } from '../bili.js';

const r = await getDanmaku(process.argv[2], {
  limit: Number(process.argv[3] || 150),
  page: process.argv[4] ? Number(process.argv[4]) : undefined,
});
console.log(JSON.stringify({
  title: r.title, page: r.page, part: r.part,
  poolSize: r.poolSize, returned: r.returned,
  danmaku: r.danmaku,
}, null, 2));
