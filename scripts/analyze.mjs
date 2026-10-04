// scripts/analyze.mjs — 一键编排 CLI
// 用法：node scripts/analyze.mjs <链接> [--type lecture|general] [--route balanced|fast] [--page N] [--frames N] [--model small] [--lang zh] [--prompt "..."] [--keep] [--no-vad] [--dual|--no-dual] [--bg]
import { readFile, writeFile } from 'node:fs/promises';
import { analyze, analyzeOrBackground } from '../media.js';

// 后台任务终态回写（analyze-bg.json）：成功写 completed、失败写 failed——analyze-status 据此输出明确终态
async function writeBgState(patch) {
  const p = process.env.BILI_BG_STATUS;
  if (!p) return;
  try {
    let cur = {};
    try { cur = JSON.parse(await readFile(p, 'utf8')); } catch { /* 首写或文件损坏 */ }
    await writeFile(p, JSON.stringify({ ...cur, ...patch }, null, 2), 'utf8');
  } catch { /* 回写失败不影响分析本身 */ }
}

const args = process.argv.slice(2);
const url = args[0];
const opt = { type: 'general', maxFrames: 20 };
for (let i = 1; i < args.length; i += 1) {
  const a = args[i];
  if (a === '--type') opt.type = args[++i] || 'general';
  else if (a === '--route') opt.route = args[++i] || 'balanced';
  else if (a === '--page') opt.page = Number(args[++i]);
  else if (a === '--frames') opt.maxFrames = Number(args[++i]);
  else if (a === '--model') opt.model = args[++i];
  else if (a === '--lang') opt.lang = args[++i];
  else if (a === '--prompt') opt.prompt = args[++i];
  else if (a === '--keep') opt.keepMedia = true;
  else if (a === '--no-vad') opt.vad = false;
  else if (a === '--dual') opt.dual = true;
  else if (a === '--no-dual') opt.dual = false;
  else if (a === '--bg') opt.bg = true;
}
if (!url) {
  console.error('usage: analyze.mjs <url> [--type lecture|general] [--route balanced|fast] [--page N] [--frames N] [--model small] [--lang zh] [--prompt "..."] [--keep] [--no-vad] [--dual|--no-dual] [--bg]');
  process.exit(2);
}
console.log('analyze start:', url, JSON.stringify(opt));
const t0 = Date.now();
try {
  const r = opt.bg ? await analyzeOrBackground(url, opt) : await analyze(url, opt);
  const wallSec = Math.round((Date.now() - t0) / 1000);
  console.log(JSON.stringify({ ...r, wallSec }, null, 2));
  await writeBgState({ state: 'completed', completedAt: new Date().toISOString(), wallSec, resultFiles: r.files || null });
} catch (e) {
  await writeBgState({ state: 'failed', failedAt: new Date().toISOString(), error: String((e && e.message) || e) });
  console.error(String((e && e.stack) || e));
  process.exitCode = 1;
}
