// scripts/test-media-pure.mjs — media.js 纯函数回归测试（无需网络/媒体工具）
// 用法：node scripts/test-media-pure.mjs
// 背景：2026-10-03 实战抓到 analyze 引用未定义变量（语法检查查不出、运行才炸），
// 本测试锁定纯函数行为，防参数重构再引入同类回归。
import { durToSec, pageDurationSec, shouldUseDual, parseWhisperSegments, findKeyMoments, buildDraftContent, LECTURE_PROMPT } from '../media.js';
import { toSimplified } from '../zh-conv.js';

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
// Q3② 门控（medium A/B 报告 §四，2026-10-04）：非 small/base 模型一律单进程，env/显式参数也不例外
ok(shouldUseDual(undefined, undefined, 1177, 'medium') === false, 'medium：长视频也不双进程（OOM 门控）');
ok(shouldUseDual('1', undefined, 1177, 'medium') === false, 'medium：env=1 也强制单进程');
ok(shouldUseDual(undefined, true, 1177, 'medium') === false, 'medium：显式 true 也强制单进程');
ok(shouldUseDual(undefined, undefined, 1177, 'large-v3') === false, 'large-v3：同门控');
ok(shouldUseDual(undefined, undefined, 1177, 'small') === true, 'small：门控不影响既有行为');
ok(shouldUseDual(undefined, undefined, 1177, 'base') === true, 'base：门控不影响既有行为');
ok(shouldUseDual(undefined, undefined, 1177, '') === true, '空模型名回退 small 判定');

console.log('== toSimplified（源级繁→简，Q3② medium 配套）==');
ok(toSimplified('家人們，我被發律師函了') === '家人们，我被发律师函了', '样例句转简（A/B medium 实测输出）');
ok(toSimplified('今天跟大家講10月4日天津漫展事件') === '今天跟大家讲10月4日天津漫展事件', '讲/漫展');
ok(toSimplified('在未跟我有任何溝通的情況下') === '在未跟我有任何沟通的情况下', '沟通');
ok(toSimplified('介紹買手機贈送漫展嘉賓簽售卷的活動') === '介绍买手机赠送漫展嘉宾签售卷的活动', '介绍/手机/嘉宾（卷为ASR错字不属转换）');
ok(toSimplified('多次提到手機有國簿') === '多次提到手机有国簿', '国（簿为ASR错字不属转换）');
ok(toSimplified('這裡只是陳述事實') === '这里只是陈述事实', '陈述');
ok(toSimplified('後續不排除會打官司，所有的聊天證據我都已經留存好了') === '后续不排除会打官司，所有的聊天证据我都已经留存好了', '长句批量');
ok(toSimplified('简体文本不受影响') === '简体文本不受影响', '简体幂等');
ok(toSimplified('請選擇相關記錄並繼續') === '请选择相关记录并继续', '审计补缺字抽查（選關錄繼）');
ok(toSimplified('') === '' && toSimplified(null) === null && toSimplified(undefined) === undefined, '空值防御');

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

console.log('== buildDraftContent（v3.4.0 机器草稿）==');
const draftSegs = [
  { from: 0, to: 5, text: '开场白' },
  { from: 30, to: 36, text: '我们先看定义' },
  { from: 95, to: 100, text: '接下来看例题' },
];
const draftKm = [{ timeSec: 30, reason: '关键词', text: '我们先看定义' }, { timeSec: 95, reason: '关键词', text: '接下来看例题' }];
const draftDm = { comprehension: [{ t: 32, text: '懂了' }], sample: [{ t: 3, text: '来了' }] };
const draft = buildDraftContent(draftSegs, draftKm, draftDm);
ok(draft && typeof draft._note === 'string' && draft._note.includes('机器草稿'), '带草稿说明头');
ok(Array.isArray(draft.highlights) && draft.highlights.length === 2, '要点候选=关键时刻数');
ok(draft.highlights[0].ts === '00:30' && draft.highlights[0].quote === '我们先看定义', '候选带 ts 与就近转录行');
ok(Array.isArray(draft.chapters) && draft.chapters.length === 2, '章节按锚点切段');
ok(draft.chapters[0].range.includes('00:30') && draft.chapters[1].range.includes('01:35'), '章节区间正确');
ok(Array.isArray(draft.dm) && draft.dm.length === 2, '弹幕候选合并两池');
const draftEmpty = buildDraftContent([], [], null);
ok(draftEmpty.highlights.length === 0 && draftEmpty.chapters.length === 0 && draftEmpty.dm.length === 0, '空输入零候选不报错');
const draftNoKm = buildDraftContent(draftSegs, [], null);
ok(draftNoKm.chapters.length >= 1, '无锚点回退均分切章');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
