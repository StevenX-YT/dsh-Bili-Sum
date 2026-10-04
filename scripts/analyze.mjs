// scripts/analyze.mjs — 一键编排 CLI
// 用法：node scripts/analyze.mjs <链接> [--type lecture|general] [--route balanced|fast] [--page N] [--frames N] [--model small] [--lang zh] [--prompt "..."] [--keep] [--no-vad] [--dual|--no-dual] [--bg]
import { analyze, analyzeOrBackground } from '../media.js';

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
const r = opt.bg ? await analyzeOrBackground(url, opt) : await analyze(url, opt);
console.log(JSON.stringify({ ...r, wallSec: Math.round((Date.now() - t0) / 1000) }, null, 2));
