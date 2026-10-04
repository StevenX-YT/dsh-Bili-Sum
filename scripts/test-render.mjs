// scripts/test-render.mjs — render-notes.mjs 渲染器冒烟测试（离线，--no-stream）
// 用法：node scripts/test-render.mjs
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderNotes, prefillChapters } from './render-notes.mjs';
import { BIN_DIR } from '../paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dir = join(BIN_DIR, 'tmp', 'render-test');

let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) { pass += 1; console.log(`  PASS ${name}`); }
  else { fail += 1; console.error(`  FAIL ${name} ${extra}`); }
};

try {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'bundle.json'), JSON.stringify({
    type: 'general',
    video: { bvid: 'BVTEST00001', page: 1, part: 'p1', title: '测试视频标题', duration: '3:05', owner: '测试UP', pubdate: '2026-10-01T00:00:00Z', stat: { view: 455000, like: 10100, danmaku: 340, reply: 2600, favorite: 1100, coin: 1000, share: 300 } },
    pipeline: { route: 'balanced', model: 'small', vad: true, dual: null },
    frames: [{ index: 1, time: '00:00', timeSec: 0, file: 'kf_001.png' }, { index: 2, time: '01:00', timeSec: 60, file: 'kf_002.png' }, { index: 3, time: '02:00', timeSec: 120, file: 'kf_003.png' }],
    keyMoments: [{ timeSec: 5, reason: '关键词', text: '测试关键时刻', nearestFrame: { time: '00:00', timeSec: 0, file: 'kf_001.png', deltaSec: 5 } }],
  }, null, 2));
  await writeFile(join(dir, 'transcript.txt'), '[00:00] 第一句转录\n[01:00] 第二句转录\n[02:00] 第三句转录\n');
  await writeFile(join(dir, 'content.json'), JSON.stringify({
    attr: '测试属性',
    warn: '测试提示',
    summary: ['段落一 [00:00]', '段落二'],
    highlights: [{ emoji: '🎯', title: '亮点', ts: '00:00', quote: '原话' }],
    tags: ['#测试'],
    qa: [{ q: '问题', ts: '00:00', src: '提到', ext: '延伸' }],
    terms: [{ t: '术语', d: '定义', ts: '00:00' }],
    chapters: [{ range: '00:00–03:05', title: '全片', text: '章正文'.repeat(20) }],
    attribution: { author: 'A认为', facts: '事实F' },
    dm: [{ cat: '神评', ts: '00:00', text: '弹幕X' }],
  }));

  const r = await renderNotes(dir, { noStream: true });
  ok(existsSync(r.out), '输出文件生成');
  const html = await readFile(r.out, 'utf8');
  ok(!html.includes('{{SUMMARY}}') && !html.includes('{{TITLE}}'), '正文 token 全部替换');
  ok(html.includes('tsGal-runtime'), 'tsGal 运行时已注入');
  ok(html.includes('pre id="transcript"'), 'transcript 容器存在');
  ok(html.includes('background:var(--blue); color:#fff'), '.ts 蓝底徽章样式存在');
  ok(html.includes('测试视频标题') && html.includes('BVTEST00001'), '元数据来自 bundle');
  ok(html.includes('测试提示'), 'warn 区块渲染');
  ok(html.includes('原话'), '亮点渲染');
  ok(!html.includes('配图（关键帧）'), '默认不出配图区（Q9① 内容驱动）');
  ok(html.includes('第一句转录'), '转录附录渲染');
  ok(r.stream === false, 'no-stream 模式直链为 null');
  ok(html.includes('window.__TSGAL__ = { frames: [{f:\'kf_001.png\',t:0}'), '帧数据注入形状正确');

  // 自动选帧仅显式开启（--auto-frames / autoFrames:true）
  const r2 = await renderNotes(dir, { noStream: true, autoFrames: true });
  ok(r2.frames >= 1 && r2.frames <= 6, 'autoFrames 显式开启时自动选帧', `frames=${r2.frames}`);
  const html2 = await readFile(r2.out, 'utf8');
  ok(html2.includes('配图（关键帧）'), 'autoFrames 时配图区出现');

  // prefillChapters 纯函数（Q11③）——样例模拟真实语音节奏：连续句+偶发停顿
  const lines = [
    { sec: 0, text: '今天我们讲根的分布' }, { sec: 5, text: '先看定义' }, { sec: 10, text: '什么是根的分布' },
    { sec: 15, text: '已知两根位置求参数' }, { sec: 20, text: '这种问题就叫根的分布' },
    { sec: 40, text: '下面我们看画图四步' }, { sec: 45, text: '第一步先看开口' }, { sec: 50, text: '第二步看对称轴' },
    { sec: 200, text: '第二道例题' }, { sec: 205, text: '两根都大于2' },
    { sec: 500, text: '课程总结' }, { sec: 505, text: '特殊点每道题必用' },
  ];
  const km = [{ timeSec: 45, reason: '关键词', text: '第一步先看开口' }];
  const ch = prefillChapters(lines, km, 'course');
  ok(ch.length >= 2 && ch.length <= 4, 'course 模式切章数量合理', `ch=${ch.length}`);
  ok(ch[0].startSec === 0 && ch[0].endSec === 20, '第一段区间正确（停顿切章）', JSON.stringify(ch[0]));
  ok(ch.some((c) => c.hitMoment), '关键时刻锚点命中');
  const tl = prefillChapters(lines, km, 'share');
  ok(tl.length >= 1 && tl.length <= 3, 'share 模式大段候选（不强制时刻切）', `tl=${tl.length}`);
  ok(prefillChapters([], [], 'course').length === 0, '空输入返回空');

  // ---- lecture 模板（B期） ----
  await writeFile(join(dir, 'content.json'), JSON.stringify({
    attr: '课程速览（数学·测试）',
    summary: ['课程摘要段落'],
    course: { subject: '数学', topic: '测试专题', level: '高一', prereq: '集合', audience: '高一学生' },
    framework: [{ no: 1, name: '概念A', core: '一句话结论', ts: '01:00' }],
    knowledge: [{ no: 1, name: '概念A', ts: '01:00', definition: '定义文本', points: ['要点1', '要点2'], emphasis: '老师原话' }],
    examples: [{ no: 1, ts: '05:00', title: '例1', question: '题目文本', approach: '思路文本', steps: ['第一步列式', '第二步求解'], answer: '答案=2', pitfalls: '漏判恒成立' }],
    authorSummary: [{ ts: '23:00', quote: '特殊点每道题必用' }],
    difficulty: [{ point: '特殊点为什么选端点', evidence: '弹幕听不懂刷屏', advice: '重看07:11' }],
    prereq: { before: ['集合'], after: ['不等式'] },
    review: ['掌握画图四步', '会列特殊点不等式'],
    signals: { warnings: ['07:00难点区'], turning: ['09:02懂了拐点'], resources: ['去看集合'], memes: ['课堂梗'] },
  }));
  const rl = await renderNotes(dir, { noStream: true, template: 'lecture' });
  ok(rl.template === 'lecture' && existsSync(rl.out), 'lecture 渲染输出');
  const hl = await readFile(rl.out, 'utf8');
  ok(hl.includes('AI 课程精讲'), 'lecture 骨架标题');
  ok(hl.includes('知识框架表') && hl.includes('例题精解') && hl.includes('难点地图') && hl.includes('学习信号'), 'lecture 区块齐全');
  ok(hl.includes('第一步列式') && hl.includes('答案</b><b>答案=2'), '例题卡完整解法渲染');
  ok(hl.includes('cat warn') && hl.includes('消化拐点'), '学习信号面板');
  ok(hl.includes('<input type="checkbox">'), '复习清单 checkbox');
  ok(hl.includes('tsGal-runtime'), 'lecture tsGal 注入');

  // 硬保底：例题缺 steps 必须报错（Q1①）
  const bad = JSON.parse(await readFile(join(dir, 'content.json'), 'utf8'));
  bad.examples = [{ no: 1, ts: '05:00', title: '坏例题', question: 'q', steps: [] }];
  await writeFile(join(dir, 'content.json'), JSON.stringify(bad));
  let threw = false;
  try { await renderNotes(dir, { noStream: true, template: 'lecture' }); } catch (e) { threw = String(e.message).includes('steps'); }
  ok(threw, '例题缺 steps 渲染报错（硬保底）');

  // ---- C4：digest 升级（thesis/chain/credibility，向后兼容） ----
  await writeFile(join(dir, 'content.json'), JSON.stringify({
    attr: '测试', summary: ['摘要'], thesis: '核心论点一句话',
    chain: [{ role: '论点', text: '主张X', ts: '01:00' }, { role: '依据', text: '证据Y', ts: '02:00' }],
    highlights: [{ emoji: '🎯', title: '旧亮点', ts: '00:00', quote: 'q' }],
    attribution: { author: 'A认为' }, credibility: ['视频标注含AI生成内容'],
  }));
  const rc = await renderNotes(dir, { noStream: true });
  const hc = await readFile(rc.out, 'utf8');
  ok(hc.includes('核心论点') && hc.includes('核心论点一句话'), 'thesis 区块');
  ok(hc.includes('论证链') && hc.includes('证据Y'), 'chain 论证链渲染');
  ok(!hc.includes('旧亮点'), 'chain 存在时替换亮点区');
  ok(hc.includes('可信度提示') && hc.includes('含AI生成内容'), 'credibility 可信度行');

  // ---- C期轻模板冒烟 ----
  const base = { attr: '测试', dm: [{ cat: '神评', ts: '00:00', text: '弹幕X' }] };
  await writeFile(join(dir, 'content.json'), JSON.stringify({ ...base, out: 'tutorial-notes.html',
    task: { what: '部署Windows', prereq: 'VMware', time: '30分钟', output: '可用虚拟机' },
    quickPath: '三步走', prereqCheck: ['装好VMware'], verify: ['虚拟机能开机'],
    steps: [{ no: 1, ts: '01:00', title: '生成应答文件', op: '访问 schneegans.de', purpose: '自动化配置', verify: '得到 unattend.xml' }],
    errors: [{ raw: '安装卡住', cause: '磁盘未分区', fix: '先分好区再装' }],
    tools: [{ name: 'VMware 17.6.3', note: '虚拟机软件' }],
  }));
  const rt = await renderNotes(dir, { noStream: true, template: 'tutorial' });
  const ht = await readFile(rt.out, 'utf8');
  ok(rt.template === 'tutorial' && ht.includes('分步操作') && ht.includes('得到 unattend.xml'), 'tutorial 渲染');
  ok(ht.includes('常见报错与排查') && ht.includes('虚拟机能开机') && ht.includes('一句话速查'), 'tutorial 区块齐全');
  let threwT = false;
  const badT = JSON.parse(await readFile(join(dir, 'content.json'), 'utf8'));
  badT.steps = [{ no: 1, title: '无验证步', op: 'x' }];
  await writeFile(join(dir, 'content.json'), JSON.stringify(badT));
  try { await renderNotes(dir, { noStream: true, template: 'tutorial' }); } catch (e) { threwT = String(e.message).includes('verify'); }
  ok(threwT, '步骤缺 verify 渲染报错（硬保底）');

  await writeFile(join(dir, 'content.json'), JSON.stringify({ ...base, out: 'share-notes.html',
    tldr: '一句TLDR', timeline: [{ ts: '00:00', text: '出门' }], quotes: [{ ts: '01:00', text: '语录原话' }],
    useful: [{ label: '地点', value: '上饶' }],
  }));
  const rs = await renderNotes(dir, { noStream: true, template: 'share' });
  const hs = await readFile(rs.out, 'utf8');
  ok(rs.template === 'share' && hs.includes('一句TLDR') && hs.includes('时间线亮点') && hs.includes('语录摘录') && hs.includes('上饶'), 'share 渲染');
  ok(!hs.includes('观点归因'), 'share 无归因表（轻量纪律）');

  await writeFile(join(dir, 'content.json'), JSON.stringify({ ...base, out: 'info-notes.html',
    flash: '一句话快讯', wh: { when: '6月18日', where: '中东', who: '各方', what: '冲突', why: '博弈', how: '停火谈判' },
    data: [{ k: '伤亡', v: '—' }], timeline: [{ t: '6月17日', e: '前情' }], react: [{ side: '官方', text: '声明' }], background: '前情提要',
  }));
  const ri = await renderNotes(dir, { noStream: true, template: 'info' });
  const hi = await readFile(ri.out, 'utf8');
  ok(ri.template === 'info' && hi.includes('一句话快讯') && hi.includes('5W1H') && hi.includes('停火谈判') && hi.includes('关键数据') && hi.includes('各方反应') && hi.includes('背景一页'), 'info 渲染');
} finally {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
