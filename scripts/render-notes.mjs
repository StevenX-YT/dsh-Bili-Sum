// scripts/render-notes.mjs — 内容→成品渲染器（快速交付模式核心）
// 用法：node scripts/render-notes.mjs <输出目录名或路径> [--no-stream] [--auto-frames] [--template digest|lecture] [--prefill course|tutorial|share]
//   --template : digest=讲解/评论（默认）；lecture=课程精讲（例题卡 steps 硬保底）；tutorial=教程（步骤卡 verify 硬保底）；share=分享/杂谈（轻量）；info=资讯快报
//   --auto-frames : content.frames 省略时自动均匀选6张（调试用；日常默认不出配图区，Q9①）
//   --prefill <mode> : 只做预填不渲染——按转录停顿+关键时刻起草章节/时间线候选到 _prefill-draft.md（Q11③：课程+教程+分享启用）
// 输入（同目录）：bundle.json（视频元数据/帧/弹幕/管线） + transcript.txt + content.json（agent 智力产出）
// 输出：video-digest.html（content.out 可改名）——自动填充 templates/note-skeleton.html 全部 {{TOKEN}}
//       并注入 tsGal（__TSGAL__ 数据 + gallery-runtime.js；直链经 getPlayUrlDurl 在线获取，失败走 iframe 回退）
//
// content.json schema（快速交付模式只写这个，~60 行）：
// {
//   "out": "video-digest.html",            // 可选，输出文件名
//   "warn": "阅读提示（敏感争议内容必填）",   // 可选
//   "summary": ["段1（内嵌 [MM:SS]）", "段2"],
//   "highlights": [{"emoji":"🎯","title":"短标题","ts":"00:00","quote":"逐字原话"}],   // 条数按 OUTPUT-STANDARDS §2.2（时长档区间+密度条款触顶1.2×+稀疏压缩）
//   "highlightsTitle": "关键点",        // 可选，要点区块自定义名（digest 默认「关键点」、share 默认「时间线亮点」；允许跨模板重名，Q4）
//   "timeline": [{"ts":"00:10","text":"事件","frame":"kf_002.png"}],  // share 时间线；info 兼容 t/e 字段名；frame=行内画面缩略图（Q5，点击放大）
//   "tags": ["#标签"],
//   "qa": [{"q":"问题","ts":"00:00","src":"视频中提到","ext":"延伸思考"}],             // ≥3
//   "terms": [{"t":"术语","d":"一句话定义","ts":"00:00"}],
//   "chapters": [{"range":"00:00–00:18","title":"章节名","text":"80–150字"}],
//   "attribution": {"author":"…","mentioned":"…","facts":"…","other":"…","external":"…"},
//   "dm": [{"cat":"刷屏|反驳|指引|神评","ts":"01:30","text":"弹幕原文"}],
//   "frames": [{"file":"kf_001.png","cap":"图注"}]   // 可省略→自动选6张+转录就近标注
// }
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getPlayUrlDurl, OUTPUT_DIR } from '../media.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tsBadge = (ts) => {
  const bare = String(ts ?? '').replace(/[[\]]/g, '').trim();
  return bare ? `<span class="ts">[${bare}]</span>` : '';
};
// Q5 时间锚点统一规范：真时间戳（MM:SS / H:MM:SS）→ 可点 .ts 徽章；日期等其他文本保持原样不冒充
const tsOrText = (v) => (/^\[?\d{1,2}:\d{2}(:\d{2})?\]?/.test(String(v ?? '')) ? tsBadge(v) : esc(String(v ?? '—')));
const wan = (n) => (Number(n) >= 10000 ? (Number(n) / 10000).toFixed(1).replace(/\.0$/, '') + '万' : String(n ?? '—'));

// 转录行索引（[MM:SS] text）：供自动配图标注取就近文本
function transcriptIndex(transcript) {
  const out = [];
  for (const ln of String(transcript || '').split('\n')) {
    const m = ln.match(/^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(.*)$/);
    if (m) {
      const sec = m[3] !== undefined ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]);
      out.push({ sec, text: m[4] || '' });
    }
  }
  return out;
}
function nearestLine(idx, sec) {
  let best = null, bd = 1e9;
  for (const l of idx) { const d = Math.abs(l.sec - sec); if (d < bd) { bd = d; best = l; } }
  return best ? best.text.slice(0, 26) : '';
}

// 自动选帧：关键时刻配帧优先 → 全片均匀补齐至 maxN；图注=帧时刻+就近转录文本
function pickAutoFrames(bundle, transcript, maxN = 6) {
  const pool = (bundle.frames || []).slice().sort((a, b) => a.timeSec - b.timeSec);
  if (!pool.length) return [];
  const idx = transcriptIndex(transcript);
  const picked = [];
  const seen = new Set();
  const push = (f) => {
    const base = basename(f.file);
    if (!f.file || seen.has(base)) return;
    seen.add(base);
    picked.push({ file: base, timeSec: f.timeSec, time: f.time, cap: `${f.time} ${nearestLine(idx, f.timeSec)}`.trim() });
  };
  for (const km of (bundle.keyMoments || [])) {
    if (picked.length >= maxN) break;
    const f = pool.find((x) => km.nearestFrame && x.file === km.nearestFrame.file);
    if (f) push(f);
  }
  for (let k = 0; picked.length < maxN && k < pool.length; k += 1) {
    push(pool[Math.round((k * (pool.length - 1)) / Math.max(1, maxN - 1))]);
  }
  return picked.sort((a, b) => a.timeSec - b.timeSec).map(({ file, time, cap }) => ({ file, cap: `${time} ${cap.replace(/^\S+\s*/, '')}`.trim() }));
}

const fmtT = (sec) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return (h > 0 ? h + ':' : '') + mm + ':' + String(ss).padStart(2, '0');
};

// 预填引擎（Q11③）：转录停顿间隙 + 关键时刻锚点 → 章节草稿（course/tutorial）或时间线候选（share）
// 纯函数可单测。lines=[{sec,text}] 已按时间排序；返回 [{startSec,endSec,title,hint,hitMoment}]
// 切章双信号：①停顿 gap≥GAP ②时刻命中（紧剪辑课程常无长停顿，靠关键时刻切）；两类切点均要求当前章已攒够半程下限
export function prefillChapters(lines, keyMoments = [], mode = 'course') {
  if (!lines || !lines.length) return [];
  const GAP = mode === 'share' ? 25 : 8;    // share 用长间隔挑大段事件；课程/教程用短停顿切章
  const MIN_SEC = mode === 'share' ? 20 : 45;
  const halfMin = MIN_SEC * 0.5;
  const momentSecs = mode === 'share' ? [] : (keyMoments || []).map((m) => Number(m.timeSec) || 0);
  const nearMoment = (sec) => momentSecs.some((ms) => Math.abs(ms - sec) <= 4);
  const groups = [];
  let cur = { start: lines[0].sec, lines: [lines[0]] };
  for (let i = 1; i < lines.length; i += 1) {
    const l = lines[i];
    const gap = l.sec - lines[i - 1].sec;
    const span = l.sec - cur.start;
    const splitHere = span >= halfMin && ((gap >= GAP) || nearMoment(l.sec));
    if (splitHere) { groups.push(cur); cur = { start: l.sec, lines: [l] }; }
    else cur.lines.push(l);
  }
  groups.push(cur);
  // 兜底：尾段过短并入前章
  if (groups.length > 1) {
    const last = groups[groups.length - 1];
    if (last.lines[last.lines.length - 1].sec - last.start < 10) {
      groups[groups.length - 2].lines.push(...last.lines);
      groups.pop();
    }
  }
  return groups.map((g) => {
    const end = g.lines[g.lines.length - 1].sec;
    const hit = (keyMoments || []).find((m) => m.timeSec >= g.start - 2 && m.timeSec <= end + 2);
    return {
      startSec: g.start, endSec: end,
      title: hit ? hit.text.slice(0, 26) : g.lines[0].text.slice(0, 26),
      hint: `${fmtT(g.start)}–${fmtT(end)}｜${g.lines.length}句`,
      hitMoment: !!hit,
    };
  });
}

async function fetchStreamSafe(bvid, page) {
  try {
    const s = await getPlayUrlDurl(bvid, { qn: 80, page });
    if (s.segments !== 1) return null; // 多段直链 <video> 不可用 → iframe 回退
    return { url: s.url, quality: s.quality, exp: s.exp };
  } catch { return null; }
}

// tsGal 注入（digest/lecture 共用；与 inject-gallery.ps1 相同数据形状）
async function injectTsGalInto(html, bundle, noStream) {
  const v = bundle.video || {};
  const runtime = await readFile(join(ROOT, 'templates', 'gallery-runtime.js'), 'utf8');
  const framePairs = (bundle.frames || []).map((f) => `{f:'${basename(f.file)}',t:${Math.round(Number(f.timeSec) * 10) / 10}}`).join(',');
  const videoJson = `{bvid:'${esc(v.bvid)}',page:${Number(v.page) || 1},title:'${String(v.title || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]/g, ' ')}',part:'${String(v.part || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\r\n]/g, ' ')}'}`;
  const streamObj = (!noStream && v.bvid) ? await fetchStreamSafe(v.bvid, v.page) : null;
  const streamJson = streamObj
    ? `{url:'${streamObj.url.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',quality:${Number(streamObj.quality) || 0},exp:${Number(streamObj.exp) || 0}}`
    : 'null';
  const inject = `<script>window.__TSGAL__ = { frames: [${framePairs}], video: ${videoJson}, stream: ${streamJson} };\n/* tsGal-runtime */\n${runtime}\n</script>\n</body>`;
  return { html: html.replace('</body>', inject), stream: !!streamObj };
}

export async function renderNotes(dirArg, { noStream = false, autoFrames = false, template = 'digest' } = {}) {
  // 目录解析：绝对路径直接用；相对路径先查数据根 output/<arg> 再查包根 output/<arg> 与 ROOT/<arg>
  let workDir = null;
  for (const c of [dirArg, join(OUTPUT_DIR, String(dirArg)), join(ROOT, 'output', String(dirArg)), join(ROOT, String(dirArg))]) {
    if (c && existsSync(join(resolve(c), 'bundle.json'))) { workDir = resolve(c); break; }
  }
  if (!workDir) throw new Error(`找不到含 bundle.json 的目录：${dirArg}`);

  const bundle = JSON.parse((await readFile(join(workDir, 'bundle.json'), 'utf8')).replace(/^\uFEFF/, '')); // BOM 防御（Windows 生态常见）
  const content = JSON.parse((await readFile(join(workDir, 'content.json'), 'utf8')).replace(/^\uFEFF/, ''));
  const transcript = await readFile(join(workDir, 'transcript.txt'), 'utf8').catch(() => '');
  const skeleton = await readFile(join(ROOT, 'templates', ({
    digest: 'note-skeleton.html', lecture: 'note-skeleton-lecture.html',
    tutorial: 'note-skeleton-tutorial.html', share: 'note-skeleton-share.html', info: 'note-skeleton-info.html',
  }[template] || 'note-skeleton.html')), 'utf8');

  // ============ lecture 模板路径（课程精讲，OUTPUT-STANDARDS §4.1） ============
  if (template === 'lecture') {
    const v = bundle.video || {};
    const st = v.stat || {};
    const cse = content.course || {};
    const meta = [
      `<span><b>BV</b>：<a href="https://www.bilibili.com/video/${esc(v.bvid)}${v.page > 1 ? '?p=' + v.page : ''}" target="_blank" rel="noopener">${esc(v.bvid)}${v.page > 1 ? ' · P' + v.page : ''}</a></span>`,
      `<span><b>UP主</b>：${esc(v.owner || '未提供')}</span>`,
      `<span><b>时长</b>：${esc(v.duration || '未提供')}</span>`,
      `<span><b>发布</b>：${esc(String(v.pubdate || '').slice(0, 10) || '未提供')}</span>`,
      `<span><b>播放·点赞·弹幕</b>：${wan(st.view)} · ${wan(st.like)} · ${wan(st.danmaku)}</span>`,
      `<span><b>学科</b>：${esc(cse.subject || '—')}</span>`,
      `<span><b>主题</b>：${esc(cse.topic || '—')}</span>`,
      `<span><b>难度</b>：${esc(cse.level || '—')}</span>`,
      `<span><b>前置知识</b>：${esc(cse.prereq || '—')}</span>`,
      `<span><b>适合人群</b>：${esc(cse.audience || '—')}</span>`,
      `<span><b>内容属性</b>：${esc(content.attr || '课程')}<span class="attr">生成 ${new Date().toISOString().slice(0, 10)}</span></span>`,
    ].join('\n    ');
    const summary = (content.summary || []).map((p) => `    <p>${p}</p>`).join('\n');
    const framework = (content.framework || []).map((f) => {
      const frameCell = f.frame ? `<img src="${esc(String(f.frame).split(/[\\/]/).pop())}" style="width:110px;display:block;border:1px solid var(--line);border-radius:4px;cursor:zoom-in" loading="lazy" alt="${esc(f.name)}">` : '—';
      return `    <tr><td>${esc(f.no)}</td><td>${esc(f.name)}</td><td>${esc(f.core)}</td><td>${tsBadge(f.ts)}</td><td>${frameCell}</td></tr>`;
    }).join('\n');
    const knowledge = (content.knowledge || []).length
      ? `  <h2>知识点精讲</h2>\n${(content.knowledge || []).map((k) => `  <div class="card">
    <div class="hd">知识点${esc(k.no)}｜${esc(k.name)} ${tsBadge(k.ts)}</div>
    ${k.definition ? `<div class="row"><b class="k">定义</b>${esc(k.definition)}</div>` : ''}
    ${(k.points || []).length ? `<div class="row"><b class="k">要点</b><ul class="plain">${k.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
    ${k.emphasis ? `<div class="quote">老师强调：「${esc(k.emphasis)}」</div>` : ''}
    ${k.usage ? `<div class="row"><b class="k">何时用</b>${esc(k.usage)}</div>` : ''}
  </div>`).join('\n')}`
      : '';
    // 例题卡：steps 硬保底（Q1①——课程平衡档起例题必须完整解法，缺步骤渲染报错）
    const exCards = (content.examples || []).map((ex) => {
      if (!Array.isArray(ex.steps) || !ex.steps.length) {
        throw new Error(`例题${ex.no ?? ''}「${ex.title || '未命名'}」缺解题步骤 steps（课程模板硬保底：例题必须含完整解法，见 OUTPUT-STANDARDS §2.3）`);
      }
      return `  <div class="card">
    <div class="hd">例题${esc(ex.no ?? '')}｜${esc(ex.title || '')} ${tsBadge(ex.ts)}</div>
    ${ex.question ? `<div class="row"><b class="k">题目</b>${esc(ex.question)}</div>` : ''}
    ${ex.approach ? `<div class="row"><b class="k">思路</b>${esc(ex.approach)}</div>` : ''}
    <ol class="steps">${ex.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    ${ex.answer ? `<div class="row"><b class="k">答案</b><b>${esc(ex.answer)}</b></div>` : ''}
    ${ex.pitfalls ? `<div class="pit">⚠ 易错点：${esc(ex.pitfalls)}</div>` : ''}
  </div>`;
    }).join('\n');
    const examples = exCards ? `  <h2>例题精解</h2>\n${exCards}` : '';
    const authorSummary = (content.authorSummary || []).length
      ? `  <h2>老师的总结（原话）</h2>\n${content.authorSummary.map((q) => `  <div class="quote">${tsBadge(q.ts)}「${esc(q.quote)}」</div>`).join('\n')}`
      : '';
    const difficulty = (content.difficulty || []).length
      ? `  <h2>难点地图</h2>\n  <table>\n    <tr><th>难点</th><th>弹幕证据</th><th>攻克建议</th></tr>\n${content.difficulty.map((d) => `    <tr><td>${esc(d.point)}</td><td>${esc(d.evidence || '—')}</td><td>${esc(d.advice || '—')}</td></tr>`).join('\n')}\n  </table>`
      : '';
    const pre = content.prereq || {};
    const prereq = (pre.before?.length || pre.after?.length)
      ? `  <h2>前置知识与后续衔接</h2>\n  <div class="card">
    ${pre.before?.length ? `<div class="row"><b class="k">前置</b>${pre.before.map(esc).join('；')}</div>` : ''}
    ${pre.after?.length ? `<div class="row"><b class="k">衔接</b>${pre.after.map(esc).join('；')}</div>` : ''}
  </div>`
      : '';
    const reviewList = (content.review || []).length
      ? `  <h2>复习清单（学完自测）</h2>\n  <div class="rv">\n${content.review.map((r) => `    <label><input type="checkbox"> ${esc(r)}</label>`).join('\n')}\n  </div>`
      : '';
    const sig = content.signals || {};
    const sigLine = (cls, label, arr) => (arr || []).map((t) => `  <div class="sig"><span class="cat ${cls}">${label}</span>${esc(t)}</div>`).join('\n');
    const sigBody = [sigLine('warn', '难点警示', sig.warnings), sigLine('turn', '消化拐点', sig.turning), sigLine('res', '资源指引', sig.resources), sigLine('meme', '课堂梗', sig.memes)].filter(Boolean).join('\n');
    const signals = sigBody ? `  <h2>学习信号（来自弹幕）</h2>\n${sigBody}` : '';
    const lframes = (content.frames && content.frames.length) ? content.frames : [];
    const gridBlock = lframes.length
      ? `  <h2>配图（板书帧）</h2>\n  <div class="grid">\n${lframes.map((f) => `    <figure><img src="${esc(f.file)}" loading="lazy" alt="${esc(f.cap || f.file)}"><figcaption>${tsBadge((f.cap || '').match(/\d{1,2}:\d{2}(?::\d{2})?/)?.[0] || '')}${esc((f.cap || '').replace(/^\[?[\d:]+\]?\s*/, ''))}</figcaption></figure>`).join('\n')}\n  </div>\n${content.gridNote ? `  <div class="note">${esc(content.gridNote)}</div>\n` : ''}`
      : (content.gridNote ? `  <div class="note">${esc(content.gridNote)}</div>\n` : '');
    const ltokens = {
      '{{TITLE}}': esc(v.title || v.bvid || '课程'),
      '{{META}}': meta,
      '{{SUMMARY}}': summary,
      '{{FRAMEWORK}}': framework,
      '{{KNOWLEDGE_BLOCK}}': knowledge,
      '{{EXAMPLES_BLOCK}}': examples,
      '{{AUTHOR_BLOCK}}': authorSummary,
      '{{DIFFICULTY_BLOCK}}': difficulty,
      '{{PREREQ_BLOCK}}': prereq,
      '{{REVIEW_BLOCK}}': reviewList,
      '{{SIGNALS_BLOCK}}': signals,
      '{{GRID_BLOCK}}': gridBlock,
      '{{TRANSCRIPT}}': esc(transcript),
      '{{FOOTER_PIPELINE}}': esc(`type=lecture · route=${(bundle.pipeline || {}).route || 'balanced'} · whisper ${(bundle.pipeline || {}).model || 'small'}${bundle.pipeline?.vad ? ' + VAD' : ''}${bundle.pipeline?.dual ? ' + dual' : ''}`),
      '{{DATE}}': new Date().toISOString().slice(0, 10),
    };
    let lhtml = skeleton;
    for (const [k, val] of Object.entries(ltokens)) lhtml = lhtml.split(k).join(val);
    const linj = await injectTsGalInto(lhtml, bundle, noStream);
    const lout = join(workDir, content.out || 'lecture-notes.html');
    await writeFile(lout, linj.html, 'utf8');
    return {
      out: lout, workDir, bytes: linj.html.length, stream: linj.stream, template: 'lecture',
      frames: lframes.length,
      sections: {
        framework: (content.framework || []).length, knowledge: (content.knowledge || []).length,
        examples: (content.examples || []).length, difficulty: (content.difficulty || []).length,
        review: (content.review || []).length, authorSummary: (content.authorSummary || []).length,
      },
    };
  }

  // ============ tutorial / share / info 轻模板路径（C期） ============
  if (template === 'tutorial' || template === 'share' || template === 'info') {
    const v = bundle.video || {};
    const st = v.stat || {};
    const meta = [
      `<span><b>BV</b>：<a href="https://www.bilibili.com/video/${esc(v.bvid)}${v.page > 1 ? '?p=' + v.page : ''}" target="_blank" rel="noopener">${esc(v.bvid)}${v.page > 1 ? ' · P' + v.page : ''}</a></span>`,
      `<span><b>UP主</b>：${esc(v.owner || '未提供')}</span>`,
      `<span><b>时长</b>：${esc(v.duration || '未提供')}</span>`,
      `<span><b>发布</b>：${esc(String(v.pubdate || '').slice(0, 10) || '未提供')}</span>`,
      `<span><b>播放·点赞·弹幕</b>：${wan(st.view)} · ${wan(st.like)} · ${wan(st.danmaku)}</span>`,
      `<span><b>内容属性</b>：${esc(content.attr || template)}<span class="attr">生成 ${new Date().toISOString().slice(0, 10)}</span></span>`,
    ];
    if (template === 'tutorial') {
      const task = content.task || {};
      if (task.what) meta.push(`<span><b>学什么</b>：${esc(task.what)}</span>`);
      if (task.prereq) meta.push(`<span><b>前置条件</b>：${esc(task.prereq)}</span>`);
      if (task.time) meta.push(`<span><b>预计耗时</b>：${esc(task.time)}</span>`);
      if (task.output) meta.push(`<span><b>最终产出</b>：${esc(task.output)}</span>`);
    }
    const dmClass = { 刷屏: '', 反驳: 'refute', 指引: 'guide', 神评: 'god' };
    const dmLabel = { 刷屏: '梗与刷屏', 反驳: '观点反驳', 指引: '实用指引', 神评: '高赞神评' };
    const dmBlock = (content.dm || []).length
      ? `  <h2>弹幕精选</h2>\n${(content.dm || []).map((d) => `  <div class="dm"><span class="cat ${dmClass[d.cat] ?? ''}">${esc(dmLabel[d.cat] ?? d.cat)}</span>${tsBadge(d.ts)} ${esc(d.text)}</div>`).join('\n')}`
      : '';
    const tframes = (content.frames && content.frames.length) ? content.frames : [];
    const gridBlock = tframes.length
      ? `  <div class="grid">\n${tframes.map((f) => `    <figure><img src="${esc(f.file)}" loading="lazy" alt="${esc(f.cap || f.file)}"><figcaption>${tsBadge((f.cap || '').match(/\d{1,2}:\d{2}(?::\d{2})?/)?.[0] || '')}${esc((f.cap || '').replace(/^\[?[\d:]+\]?\s*/, ''))}</figcaption></figure>`).join('\n')}\n  </div>`
      : '';
    const metaStr = meta.join('\n    ');
    let tokens;
    if (template === 'tutorial') {
      // 步骤卡硬保底：verify 必填（教程模板与例题卡同理念）
      const steps = (content.steps || []).map((s) => {
        if (!s.verify) throw new Error(`步骤${s.no ?? ''}「${s.title || '未命名'}」缺验证方法 verify（教程模板硬保底：每步必须可验证）`);
        return `  <div class="card">
    <div class="hd">步骤${esc(s.no ?? '')}｜${esc(s.title || '')} ${tsBadge(s.ts)}</div>
    ${s.op ? `<div class="op">${esc(s.op)}</div>` : ''}
    ${s.frame ? `<div><img src="${esc(basename(s.frame))}" loading="lazy" alt="" style="width:min(440px,100%);display:block;border:1px solid var(--line);border-radius:6px;cursor:zoom-in"></div>` : ''}
    ${s.purpose ? `<div class="row"><b class="k">目的</b>${esc(s.purpose)}</div>` : ''}
    <div class="row"><b class="k">验证</b>${esc(s.verify)}</div>
    ${s.tip ? `<div class="tip">⚠ 视频提示：${esc(s.tip)}</div>` : ''}
  </div>`;
      }).join('\n');
      const errRows = (content.errors || []).map((e) => `    <tr><td>${esc(e.raw)}</td><td>${esc(e.cause || '—')}</td><td>${esc(e.fix || '—')}${e.ts ? ' ' + tsBadge(e.ts) : ''}</td></tr>`).join('\n');
      const chk = (arr) => (arr || []).map((x) => `    <label><input type="checkbox"> ${esc(x)}</label>`).join('\n');
      const sig = content.signals || {};
      const sigLine = (cls, label, arr) => (arr || []).map((t) => `  <div class="sig"><span class="cat ${cls}">${label}</span>${esc(t)}</div>`).join('\n');
      const sigBody = [sigLine('warn', '难点警示', sig.warnings), sigLine('turn', '消化拐点', sig.turning), sigLine('res', '资源指引', sig.resources), sigLine('meme', '课堂梗', sig.memes)].filter(Boolean).join('\n');
      const signalsBlock = sigBody ? `  <h2>学习信号（来自弹幕）</h2>\n${sigBody}` : '';
      const toolRows = (content.tools || []).map((t) => `    <tr><td>${esc(t.name)}</td><td>${esc(t.note || '—')}</td></tr>`).join('\n');
      const verifyLabels = chk(content.verify);
      tokens = {
        '{{TITLE}}': esc(v.title || v.bvid), '{{META}}': metaStr,
        '{{QUICK_PATH}}': content.quickPath ? esc(content.quickPath) : '—',
        '{{PREREQ_CHECK}}': chk(content.prereqCheck) || '    <div class="note">无</div>',
        '{{STEPS}}': steps || '  <div class="note">无</div>',
        '{{ERRORS_BLOCK}}': errRows ? `  <h2>常见报错与排查</h2>\n  <table>\n    <tr><th>报错</th><th>原因</th><th>解法</th></tr>\n${errRows}\n  </table>` : '',
        '{{VERIFY_BLOCK}}': verifyLabels ? `  <h2>完成验证</h2>\n  <div class="chk">\n${verifyLabels}\n  </div>` : '',
        '{{TOOLS_BLOCK}}': toolRows ? `  <h2>工具与资源</h2>\n  <table>\n    <tr><th>名称</th><th>说明</th></tr>\n${toolRows}\n  </table>` : '',
        '{{SIGNALS_BLOCK}}': signalsBlock, '{{GRID_BLOCK}}': gridBlock,
        '{{TRANSCRIPT}}': esc(transcript),
        '{{FOOTER_PIPELINE}}': esc(`type=tutorial · route=${(bundle.pipeline || {}).route || 'balanced'} · whisper ${(bundle.pipeline || {}).model || 'small'}`),
        '{{DATE}}': new Date().toISOString().slice(0, 10),
      };
    } else if (template === 'share') {
      const tlRows = (content.timeline || []).map((t) => `    <tr><td>${tsOrText(t.ts)}</td><td>${esc(t.text)}${t.frame ? ` <img src="${esc(basename(t.frame))}" loading="lazy" alt="" style="width:96px;display:inline-block;vertical-align:middle;border:1px solid var(--line);border-radius:4px;cursor:zoom-in;margin:2px 0 0 6px">` : ''}</td></tr>`).join('\n');
      const quoteBlocks = (content.quotes || []).map((q) => `  <div class="quote">${tsBadge(q.ts)}「${esc(q.text)}」</div>`).join('\n');
      const usefulRows = (content.useful || []).map((u) => `    <tr><td><b>${esc(u.label)}</b></td><td>${esc(u.value)}${u.ts ? ' ' + tsBadge(u.ts) : ''}</td></tr>`).join('\n');
      tokens = {
        '{{TITLE}}': esc(v.title || v.bvid), '{{META}}': metaStr,
        '{{TLDR}}': content.tldr ? esc(content.tldr) : '—',
        '{{TIMELINE_BLOCK}}': tlRows ? `  <h2>${esc(String(content.highlightsTitle || '时间线亮点'))}</h2>\n  <table>\n    <tr><th>时间</th><th>事件</th></tr>\n${tlRows}\n  </table>` : '',
        '{{QUOTES_BLOCK}}': quoteBlocks ? `  <h2>语录摘录</h2>\n${quoteBlocks}` : '',
        '{{USEFUL_BLOCK}}': usefulRows ? `  <h2>有用信息</h2>\n  <table>\n    <tr><th>项目</th><th>内容</th></tr>\n${usefulRows}\n  </table>` : '',
        '{{DM_BLOCK}}': dmBlock,
        '{{GRID_BLOCK}}': gridBlock,
        '{{TRANSCRIPT}}': esc(transcript),
        '{{FOOTER_PIPELINE}}': esc(`type=share · route=${(bundle.pipeline || {}).route || 'balanced'} · whisper ${(bundle.pipeline || {}).model || 'small'}`),
        '{{DATE}}': new Date().toISOString().slice(0, 10),
      };
    } else { // info
      const wh = content.wh || {};
      const dataCells = (content.data || []).map((d) => `    <div class="cell"><div class="k">${esc(d.k)}</div><div class="v">${esc(d.v)}${d.ts ? ' ' + tsBadge(d.ts) : ''}</div></div>`).join('\n');
      const tlRows = (content.timeline || []).map((t) => `    <tr><td>${tsOrText(t.ts ?? t.t)}</td><td>${esc(t.e ?? t.text)}${t.frame ? ` <img src="${esc(basename(t.frame))}" loading="lazy" alt="" style="width:96px;display:inline-block;vertical-align:middle;border:1px solid var(--line);border-radius:4px;cursor:zoom-in;margin:2px 0 0 6px">` : ''}</td></tr>`).join('\n');
      const reactRows = (content.react || []).map((r) => `    <tr><td><b>${esc(r.side)}</b></td><td>${esc(r.text)}</td></tr>`).join('\n');
      tokens = {
        '{{TITLE}}': esc(v.title || v.bvid), '{{META}}': metaStr,
        '{{FLASH}}': content.flash ? esc(content.flash) : '—',
        '{{WH_ROW1}}': `    <tr><td>${esc(wh.when || '—')}</td><td>${esc(wh.where || '—')}</td><td>${esc(wh.who || '—')}</td></tr>`,
        '{{WH_ROW2}}': `    <tr><td>${esc(wh.what || '—')}</td><td>${esc(wh.why || '—')}</td><td>${esc(wh.how || '—')}</td></tr>`,
        '{{DATA_BLOCK}}': dataCells ? `  <h2>关键数据</h2>\n  <div class="panel">\n${dataCells}\n  </div>` : '',
        '{{TIMELINE_BLOCK}}': tlRows ? `  <h2>事件时间线</h2>\n  <table>\n    <tr><th>时间</th><th>事件</th></tr>\n${tlRows}\n  </table>` : '',
        '{{REACT_BLOCK}}': reactRows ? `  <h2>各方反应</h2>\n  <table>\n    <tr><th>立场</th><th>内容</th></tr>\n${reactRows}\n  </table>` : '',
        '{{BACKGROUND_BLOCK}}': content.background ? `  <h2>背景一页</h2>\n  <div class="bg">${esc(content.background)}</div>` : '',
        '{{DM_BLOCK}}': dmBlock,
        '{{TRANSCRIPT}}': esc(transcript),
        '{{FOOTER_PIPELINE}}': esc(`type=info · route=${(bundle.pipeline || {}).route || 'balanced'} · whisper ${(bundle.pipeline || {}).model || 'small'}`),
        '{{DATE}}': new Date().toISOString().slice(0, 10),
      };
    }
    let thtml = skeleton;
    for (const [k, val] of Object.entries(tokens)) thtml = thtml.split(k).join(val);
    const tinj = await injectTsGalInto(thtml, bundle, noStream);
    const tout = join(workDir, content.out || `${template}-notes.html`);
    await writeFile(tout, tinj.html, 'utf8');
    return {
      out: tout, workDir, bytes: tinj.html.length, stream: tinj.stream, template,
      frames: tframes.length,
      sections: {
        steps: (content.steps || []).length, timeline: (content.timeline || []).length,
        dm: (content.dm || []).length, data: (content.data || []).length, quotes: (content.quotes || []).length,
      },
    };
  }

  // ============ digest 模板路径（讲解/评论，note-skeleton.html） ============

  // ---- 各区块 ----
  const v = bundle.video || {};
  const st = v.stat || {};
  const meta = [
    `<span><b>BV</b>：<a href="https://www.bilibili.com/video/${esc(v.bvid)}${v.page > 1 ? '?p=' + v.page : ''}" target="_blank" rel="noopener">${esc(v.bvid)}${v.page > 1 ? ' · P' + v.page : ''}</a></span>`,
    `<span><b>UP主</b>：${esc(v.owner || '未提供')}</span>`,
    `<span><b>时长</b>：${esc(v.duration || '未提供')}</span>`,
    `<span><b>发布</b>：${esc(String(v.pubdate || '').slice(0, 10) || '未提供')}</span>`,
    `<span><b>播放·点赞·弹幕</b>：${wan(st.view)} · ${wan(st.like)} · ${wan(st.danmaku)}</span>`,
    `<span><b>评论·收藏·转发</b>：${wan(st.reply)} · ${wan(st.favorite)} · ${wan(st.share)}</span>`,
    `<span><b>内容属性</b>：${esc(content.attr || bundle.type || '—')}<span class="attr">生成 ${new Date().toISOString().slice(0, 10)}</span></span>`,
  ].join('\n    ');

  const warnBlock = content.warn ? `  <div class="warn">⚠️ ${esc(content.warn)}</div>\n` : '';
  const summary = (content.summary || []).map((p) => `    <p>${p}</p>`).join('\n');
  const highlights = (content.highlights || []).map((h) => `    <li>${h.emoji || '•'} ${esc(h.title)} ${tsBadge(h.ts)}：「${esc(h.quote)}」</li>`).join('\n');
  // C4 升级（可选字段，缺省时输出与旧版完全一致，向后兼容）
  const thesisBlock = content.thesis
    ? `  <h2>核心论点</h2>\n  <div class="summary" style="border-left:4px solid #c2571f">${content.thesis}</div>\n`
    : '';
  const chainRows = (content.chain || []).map((c) => `    <tr><td><b>${esc(c.role || '')}</b></td><td>${esc(c.text)}${c.ts ? ' ' + tsBadge(c.ts) : ''}</td></tr>`).join('\n');
  const chainBlock = chainRows
    ? `  <h2>论证链</h2>\n  <table>\n    <tr><th>角色</th><th>内容</th></tr>\n${chainRows}\n  </table>\n`
    : '';
  // Q4 区块命名模板化：digest 要点区默认名「关键点」，content.highlightsTitle 可自定义（允许跨模板重名）
  const hlTitle = String(content.highlightsTitle || '关键点');
  const highlightsBlock = chainRows ? '' : `  <h2>${esc(hlTitle)}</h2>\n  <ul class="hl">\n${highlights}\n  </ul>`;
  // F2：内容驱动区块 token 化——空则整块消失（含 h2），不硬凑占位
  const tags = (content.tags || []).length
    ? `  <h2>标签</h2>\n  <div class="tags">\n${content.tags.map((t) => `<span>${esc(t)}</span>`).join('')}\n  </div>`
    : '';
  const qa = (content.qa || []).length
    ? `  <h2>思考 Q&amp;A</h2>\n${content.qa.map((x) => `  <div class="qa">
    <div class="q">Q${content.qa.indexOf(x) + 1}${tsBadge(x.ts)} ${esc(x.q)}</div>
    <div class="a">
      <p><span class="src">视频中提到</span>：${esc(x.src)}</p>
      <p><span class="ext">延伸思考</span>：${esc(x.ext)}</p>
    </div>
  </div>`).join('\n')}`
    : '';
  const terms = (content.terms || []).length
    ? `  <h2>术语解释</h2>\n  <table>\n    <tr><th>术语</th><th>释义</th><th>出处</th></tr>\n${content.terms.map((t) => `    <tr><td>${esc(t.t)}</td><td>${esc(t.d)}</td><td>${tsBadge(t.ts)}</td></tr>`).join('\n')}\n  </table>`
    : '';
  // §6.8 时间锚点统一：章节区间也是时间锚点——渲染为可点 .ts 徽章（运行时 parseBadge 支持区间，点击 seek 到区间起点）
  const chapters = (content.chapters || []).length
    ? `  <h2>章节总结</h2>\n  <div class="chaps">\n${content.chapters.map((c) => `    <p><b>${tsBadge(c.range)} ${esc(c.title)}</b>：${esc(c.text)}</p>`).join('\n')}\n  </div>`
    : '';
  const a = content.attribution || {};
  const attrRows = [
    a.author ? `    <tr><td><b>作者认为</b></td><td>${esc(a.author)}</td></tr>` : '',
    a.mentioned ? `    <tr><td><b>视频中提到</b></td><td>${esc(a.mentioned)}</td></tr>` : '',
    a.facts ? `    <tr><td><b>事实（可核验）</b></td><td>${esc(a.facts)}</td></tr>` : '',
    a.other ? `    <tr><td><b>反方/其他观点</b></td><td>${esc(a.other)}</td></tr>` : '',
    a.external ? `    <tr><td><b>外部关联</b></td><td>${esc(a.external)}</td></tr>` : '',
    content.credibility ? `    <tr><td><b>可信度提示</b></td><td>${(Array.isArray(content.credibility) ? content.credibility : [content.credibility]).map(esc).join('；')}</td></tr>` : '',
  ].filter(Boolean).join('\n');
  const attributionBlock = attrRows
    ? `  <h2>观点归因</h2>\n  <table>\n    <tr><th>类型</th><th>内容</th></tr>\n${attrRows}\n  </table>`
    : '';
  // 配图：内容驱动（Q9①）——content.frames 显式给出才出图；日常默认不出配图区；--auto-frames 供调试
  const frames = (content.frames && content.frames.length) ? content.frames : (autoFrames ? pickAutoFrames(bundle, transcript, 6) : []);
  const grid = frames.map((f) => `    <figure><img src="${esc(f.file)}" loading="lazy" alt="${esc(f.cap || f.file)}"><figcaption>${tsBadge((f.cap || '').match(/\d{1,2}:\d{2}(?::\d{2})?/)?.[0] || '')}${esc((f.cap || '').replace(/^\[?[\d:]+\]?\s*/, ''))}</figcaption></figure>`).join('\n');
  const gridNote = content.gridNote ? `  <div class="note">${esc(content.gridNote)}</div>\n` : '';
  const gridBlock = frames.length
    ? `  <h2>配图（关键帧）</h2>\n  <div class="grid">\n${grid}\n  </div>\n${gridNote}`
    : (content.gridNote ? `  <div class="note">${esc(content.gridNote)}</div>\n` : '');
  const dmClass = { 刷屏: '', 反驳: 'refute', 指引: 'guide', 神评: 'god' };
  const dmLabel = { 刷屏: '梗与刷屏', 反驳: '观点反驳', 指引: '实用指引', 神评: '高赞神评' };
  const dm = (content.dm || []).length
    ? `  <h2>弹幕精选</h2>\n${content.dm.map((d) => `  <div class="dm"><span class="cat ${dmClass[d.cat] ?? ''}">${esc(dmLabel[d.cat] ?? d.cat)}</span>${tsBadge(d.ts)} ${esc(d.text)}</div>`).join('\n')}`
    : '';

  // ---- token 替换 ----
  const pipe = bundle.pipeline || {};
  const tokens = {
    '{{TITLE}}': esc(v.title || v.bvid || '视频'),
    '{{META}}': meta,
    '{{THESIS_BLOCK}}': thesisBlock,
    '{{WARN_BLOCK}}': warnBlock,
    '{{SUMMARY}}': summary,
    '{{CHAIN_BLOCK}}': chainBlock,
    '{{HIGHLIGHTS_BLOCK}}': highlightsBlock,
    '{{TAGS_BLOCK}}': tags,
    '{{QA_BLOCK}}': qa,
    '{{TERMS_BLOCK}}': terms,
    '{{CHAPTERS_BLOCK}}': chapters,
    '{{ATTRIBUTION_BLOCK}}': attributionBlock,
    '{{GRID_BLOCK}}': gridBlock,
    '{{DM_BLOCK}}': dm,
    '{{TRANSCRIPT}}': esc(transcript),
    '{{FOOTER_PIPELINE}}': esc(`type=${bundle.type || 'general'} · route=${pipe.route || 'balanced'} · whisper ${pipe.model || 'small'}${pipe.vad ? ' + VAD' : ''}${pipe.dual ? ' + dual' : ''}`),
    '{{DATE}}': new Date().toISOString().slice(0, 10),
  };
  let html = skeleton;
  for (const [k, val] of Object.entries(tokens)) html = html.split(k).join(val);

  // ---- tsGal 注入（共用 helper） ----
  const inj = await injectTsGalInto(html, bundle, noStream);
  html = inj.html;

  const outFile = join(workDir, content.out || 'video-digest.html');
  await writeFile(outFile, html, 'utf8');
  return {
    out: outFile, workDir, bytes: html.length,
    frames: frames.length, stream: inj.stream, template: 'digest',
    sections: {
      highlights: (content.highlights || []).length, qa: (content.qa || []).length,
      chapters: (content.chapters || []).length, dm: (content.dm || []).length,
    },
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const dirArg = process.argv[2];
  const noStream = process.argv.includes('--no-stream');
  const autoFrames = process.argv.includes('--auto-frames');
  const tplIdx = process.argv.indexOf('--template');
  const template = tplIdx >= 0 ? (process.argv[tplIdx + 1] || 'digest') : 'digest';
  const prefillIdx = process.argv.indexOf('--prefill');
  const prefillMode = prefillIdx >= 0 ? (process.argv[prefillIdx + 1] || 'course') : null;
  if (!dirArg) { console.error('usage: render-notes.mjs <输出目录名或路径> [--no-stream] [--auto-frames] [--template digest|lecture|tutorial|share|info] [--prefill course|tutorial|share]'); process.exit(2); }
  try {
    // --prefill：只起草不渲染（读 bundle+transcript，写 _prefill-draft.md）
    if (prefillMode) {
      let workDir = null;
      for (const c of [dirArg, join(OUTPUT_DIR, String(dirArg)), join(ROOT, 'output', String(dirArg)), join(ROOT, String(dirArg))]) {
        if (c && existsSync(join(resolve(c), 'bundle.json'))) { workDir = resolve(c); break; }
      }
      if (!workDir) throw new Error(`找不到含 bundle.json 的目录：${dirArg}`);
      const bundle = JSON.parse((await readFile(join(workDir, 'bundle.json'), 'utf8')).replace(/^\uFEFF/, ''));
      const transcript = await readFile(join(workDir, 'transcript.txt'), 'utf8').catch(() => '');
      const drafts = prefillChapters(transcriptIndex(transcript), bundle.keyMoments || [], prefillMode);
      const modeLabel = { course: '课程章节草稿', tutorial: '教程步骤草稿', share: '时间线候选' }[prefillMode] || prefillMode;
      const draft = [
        `# 预填草稿（mode=${prefillMode}：${modeLabel}）— 机器起草，改写提炼后写入 content.json`,
        `来源：${bundle.video?.title || ''}（转录 ${transcriptIndex(transcript).length} 句，关键时刻 ${(bundle.keyMoments || []).length} 个）`,
        '',
        ...drafts.map((d) => `- [${d.hint}]${d.hitMoment ? '⭐' : ''} ${d.title}`),
        '',
        `共 ${drafts.length} 条；⭐=有关键时刻锚点（标题候选可信度更高）`,
      ].join('\n');
      const out = join(workDir, '_prefill-draft.md');
      await writeFile(out, draft, 'utf8');
      console.log(JSON.stringify({ prefill: true, mode: prefillMode, out, drafts: drafts.length }, null, 2));
      process.exit(0);
    }
    const r = await renderNotes(dirArg, { noStream, autoFrames, template });
    console.log(JSON.stringify(r, null, 2));
  } catch (e) {
    console.error(String(e && e.message || e));
    process.exit(1);
  }
}
