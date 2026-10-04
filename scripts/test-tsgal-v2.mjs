// tsgal v2 单元测试：徽章解析 + 空降链接生成 + 画廊选帧（纯函数，无需 DOM）
// 用法：node scripts/test-tsgal-v2.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'templates', 'gallery-runtime.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass += 1; console.log(`  PASS ${name}`); }
  else { fail += 1; console.error(`  FAIL ${name} ${extra}`); }
};

// 在无 document 的沙箱里加载：只导出纯函数，不触发 DOM 分支
const sandbox = { console };
sandbox.globalThis = sandbox;
sandbox.window = undefined;
sandbox.document = undefined;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const T = sandbox.__tsgal || sandbox.globalThis.__tsgal;
if (!T) { console.error('FAIL: __tsgal 未导出'); process.exit(1); }

console.log('== parseBadge ==');
ok(T.parseBadge('00:10').start === 10, '单点 00:10');
ok(T.parseBadge('02:57–08:33').start === 177 && T.parseBadge('02:57–08:33').end === 513, '区间 –');
ok(T.parseBadge('1:01:08–1:01:53').start === 3668, '跨小时区间');
ok(T.parseBadge('14:25 起').start === 865, '带后缀单点');
let r = T.parseBadge('00:10–00:35'); ok(r && r.start === 10 && r.end === 35, '表格短区间');
ok(T.parseBadge('无时间') === null, '无时间返回null');

console.log('== jumpUrl / embedUrl ==');
T.setVideo({ bvid: 'BV1CAxaeHEeH', page: 8 });
ok(T.jumpUrl(10) === 'https://www.bilibili.com/video/BV1CAxaeHEeH?p=8&t=10', '多P空降', T.jumpUrl(10));
ok(T.jumpUrl(177.4) === 'https://www.bilibili.com/video/BV1CAxaeHEeH?p=8&t=177', '秒数取整');
T.setVideo({ bvid: 'BV1FtaJ6BEsd', page: 1 });
ok(T.jumpUrl(44) === 'https://www.bilibili.com/video/BV1FtaJ6BEsd?t=44', '单P省略p参数');
const eu1 = T.embedUrl(177);
ok(eu1.indexOf('bvid=BV1FtaJ6BEsd') > 0 && eu1.indexOf('t=177') > 0 && eu1.indexOf('autoplay=1') > 0 && eu1.indexOf('as_wide=1') > 0 && eu1.indexOf('high_quality=1') > 0 && eu1.indexOf('r=') > 0, '单P小窗embed参数齐全(v3.4.2含r防缓存)');
T.setVideo({ bvid: 'BV1CAxaeHEeH', page: 8 });
const eu2 = T.embedUrl(10);
ok(eu2.indexOf('p=8') > 0 && eu2.indexOf('t=10') > 0 && eu2.indexOf('r=') > 0, '多P小窗embed参数齐全(v3.4.2)');
T.setVideo(null);
ok(T.jumpUrl(10) === null, '无视频信息返回null');
ok(T.embedUrl(10) === null, '无视频信息embed返回null');

console.log('== pickFrames/caption ==');
const frames = [{ f: 'a', t: 0 }, { f: 'b', t: 120 }, { f: 'c', t: 244 }, { f: 'd', t: 366 }];
ok(T.pickFrames(frames, 100, 140).length >= 1, '窗口命中');
const fb = T.pickFrames(frames, 9999, 10000);
ok(fb.length === 3 && fb[2].t === 366, '远端回退就近3张');
const lines = T.parseTranscriptText('[00:03] 第一句\n坏行\n[01:02] 第二句');
ok(lines.length === 2, '转录解析跳过坏行');
ok(T.captionFor(lines, 5).includes('第一句'), '最近转录匹配');

console.log('== qualityLabel ==');
ok(T.qualityLabel(64) === '720P', 'qn64=720P');
ok(T.qualityLabel(80) === '1080P', 'qn80=1080P');
ok(T.qualityLabel(32) === '480P', 'qn32=480P');
ok(T.qualityLabel(99) === '99P', '未知qn兜底');

console.log('== embedUrl v3.3 (高清+宽屏参数) ==');
T.setVideo({ bvid: 'BV1CAxaeHEeH', page: 8 });
const eu = T.embedUrl(100);
ok(eu.indexOf('high_quality=1') > 0, 'embed含high_quality');
ok(eu.indexOf('as_wide=1') > 0, 'embed含as_wide');
ok(eu.indexOf('autoplay=1') > 0 && eu.indexOf('t=100') > 0, 'embed含autoplay与t');

console.log('== galleryAnchorAllowed（Q6 挂载点白名单）==');
ok(T.galleryAnchorAllowed('知识点精讲', 'card') === true, 'lecture 知识点卡允许挂画廊');
ok(T.galleryAnchorAllowed('例题精解', 'card') === true, 'lecture 例题卡允许挂画廊');
ok(T.galleryAnchorAllowed('语录摘录', 'quote') === true, 'share 语录摘录允许挂画廊');
ok(T.galleryAnchorAllowed('老师的总结（原话）', 'quote') === false, 'lecture 老师总结不挂（拍板范围外）');
ok(T.galleryAnchorAllowed('分步操作卡', 'card') === false, 'tutorial 步骤卡不挂（拍板范围外）');
ok(T.galleryAnchorAllowed('时间线亮点', 'quote') === false, 'share 时间线不挂（拍板范围外）');
ok(T.galleryAnchorAllowed('', 'card') === false, '无区块标题不挂（判别失败安全兜底）');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
