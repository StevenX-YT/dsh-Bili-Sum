// scripts/test-media-pure.mjs — media.js 纯函数回归测试（无需网络/媒体工具）
// 用法：node scripts/test-media-pure.mjs
// 背景：2026-10-03 实战抓到 analyze 引用未定义变量（语法检查查不出、运行才炸），
// 本测试锁定纯函数行为，防参数重构再引入同类回归。
import { durToSec, pageDurationSec, shouldUseDual, parseWhisperSegments, findKeyMoments, LECTURE_PROMPT } from '../media.js';

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass += 1; console.log(`  PASS ${name}`); }
  else { fail += 1; console.error(`  FAIL ${name} ${extra}`); }
};

console.log('== durToSec ==');
ok(durToSec('1:40') === 100, 'M:SS');
ok(durToSec('108:09:18') === 389358, 'H:MM:SS');
ok(durToSec('2:56') === 176, 'M:SS 两位秒');
ok(durToSec(125) === 125, '纯数字透传');
ok(durToSec('') === 0, '空值归零');

console.log('== pageDurationSec ==');
const info = { duration: '10:00', pages: [{ page: 1, part: 'a', cid: 1, duration: '19:37' }, { page: 2, part: 'b', cid: 2, duration: '5:00' }] };
ok(pageDurationSec(info, 1) === 1177, '取分P时长');
ok(pageDurationSec(info, 2) === 300, '第二P');
ok(pageDurationSec({ duration: '8:00', pages: [] }, 1) === 480, '无pages回退整片');
ok(pageDurationSec({ duration: '8:00' }, 1) === 480, '无pages字段回退整片');

console.log('== shouldUseDual ==');
ok(shouldUseDual(undefined, undefined, 1177) === true, '自动：≥360s 启用');
ok(shouldUseDual(undefined, undefined, 468) === true, '自动：7:48视频(468s)启用');
ok(shouldUseDual(undefined, undefined, 359) === false, '自动：短于360s 不启用');
ok(shouldUseDual('1', undefined, 100) === true, 'env=1 强制启用（短视频也开）');
ok(shouldUseDual('0', undefined, 9999) === false, 'env=0 强制关闭');
ok(shouldUseDual(undefined, false, 9999) === false, '显式参数 false 覆盖自动');
ok(shouldUseDual('0', true, 9999) === true, '显式参数 true 覆盖 env=0');
ok(shouldUseDual('1', false, 9999) === false, '显式参数 false 覆盖 env=1');
ok(shouldUseDual(undefined, undefined, NaN) === false, '异常时长不启用');

console.log('== parseWhisperSegments ==');
const ms = parseWhisperSegments({ transcription: [{ offsets: { from: 3960, to: 5230 }, text: ' 你好 ' }, { offsets: { from: 1, to: 2 }, text: '' }] });
ok(ms.length === 1 && ms[0].from === 3.96 && ms[0].to === 5.23 && ms[0].text === '你好', 'offsets毫秒格式+空段过滤');
const ts = parseWhisperSegments({ transcription: [{ timestamps: { from: '00:00:03,960', to: '00:00:05,230' }, text: '测试' }] });
ok(ts.length === 1 && Math.abs(ts[0].from - 3.96) < 0.001, 'timestamps字符串格式');
ok(parseWhisperSegments({}).length === 0, '空输入');
ok(parseWhisperSegments(null).length === 0, 'null输入');

console.log('== findKeyMoments ==');
const segs = [
  { from: 0, to: 3, text: '今天我们讲极限的定义' },
  { from: 40, to: 44, text: '这是一个例子' },
  { from: 100, to: 104, text: '大家注意这个定理' },
  { from: 110, to: 113, text: '接下来我们看性质' },
];
const kmL = findKeyMoments(segs, { type: 'lecture' });
ok(kmL.length >= 2, 'lecture关键词命中');
ok(kmL[0].timeSec === 0, '首个关键时刻带时间戳');
const kmG = findKeyMoments(segs, { type: 'general' });
ok(Array.isArray(kmG), 'general不报错');

console.log('== LECTURE_PROMPT ==');
ok(typeof LECTURE_PROMPT === 'string' && LECTURE_PROMPT.length > 50, '课程偏置词表非空');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
