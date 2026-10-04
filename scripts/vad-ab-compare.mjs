// scripts/vad-ab-compare.mjs — VAD A/B 对比：基线（无VAD）vs 新跑（VAD+幻觉抑制）
// 用法：node scripts/vad-ab-compare.mjs [输出目录，默认 output/BV1CAxaeHEeH_p8]
// 前置：目录内须有 transcript-novad-baseline.json（旧跑备份）与 transcript.json（新跑）
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2] || 'output/BV1CAxaeHEeH_p8';
const load = async (f) => JSON.parse(await readFile(join(dir, f), 'utf8'));
const segsOf = (raw) => (raw.transcription || [])
  .map((s) => ({ from: (s.offsets?.from ?? 0) / 1000, to: (s.offsets?.to ?? 0) / 1000, text: String(s.text || '').trim() }))
  .filter((s) => s.text);

const base = segsOf(await load('transcript-novad-baseline.json'));
const nova = segsOf(await load('transcript.json'));
let bundle = null;
try { bundle = await load('bundle.json'); } catch { /* ignore */ }

function stats(segs) {
  const speech = segs.reduce((a, s) => a + Math.max(0, s.to - s.from), 0);
  const intro = segs.filter((s) => s.from < 30); // 片头 BGM/静音高危区
  const uniq = new Set(segs.map((s) => s.text.replace(/\s+/g, '')));
  return {
    segments: segs.length,
    speechSec: Math.round(speech),
    firstFrom: segs.length ? segs[0].from : null,
    lastTo: segs.length ? segs[segs.length - 1].to : null,
    introSegs0to30s: intro.length,
    introTexts: intro.slice(0, 12).map((s) => `[${Math.round(s.from)}s] ${s.text}`),
    dupTextPairs: segs.length - uniq.size,
    veryShortSegs: segs.filter((s) => s.text.replace(/\s+/g, '').length <= 1).length,
  };
}

console.log('== baseline (no VAD, old run) ==');
console.log(JSON.stringify(stats(base), null, 2));
console.log('== new (VAD + suppress-nst) ==');
console.log(JSON.stringify(stats(nova), null, 2));
if (bundle?.pipeline) {
  console.log('== new pipeline ==');
  console.log(JSON.stringify({
    route: bundle.pipeline.route, vad: bundle.pipeline.vad, model: bundle.pipeline.model,
    threads: bundle.pipeline.threads, whisperElapsedSec: bundle.pipeline.whisperElapsedSec,
    totalElapsedSec: bundle.pipeline.elapsedSec,
  }, null, 2));
}

// 时间戳漂移抽样：只匹配「两边各只出现一次」的文本（重复短语如「那么」会造成错配假漂移）
const countBy = (segs) => {
  const m = new Map();
  for (const s of segs) {
    const k = s.text.replace(/\s+/g, '');
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
};
const baseCnt = countBy(base), novaCnt = countBy(nova);
const baseUnique = new Map(base.filter((s) => baseCnt.get(s.text.replace(/\s+/g, '')) === 1)
  .map((s) => [s.text.replace(/\s+/g, ''), s]));
let driftN = 0, driftSum = 0, driftMax = 0;
const bigDrift = [];
for (const s of nova) {
  const key = s.text.replace(/\s+/g, '');
  if (novaCnt.get(key) !== 1) continue; // 新跑中也须唯一
  const b = baseUnique.get(key);
  if (!b) continue;
  const d = s.from - b.from;
  driftN += 1; driftSum += Math.abs(d); driftMax = Math.max(driftMax, Math.abs(d));
  if (bigDrift.length < 8 && Math.abs(d) > 2) {
    bigDrift.push({ text: s.text.slice(0, 30), base: Math.round(b.from * 10) / 10, new: Math.round(s.from * 10) / 10, deltaSec: Math.round(d * 10) / 10 });
  }
}
console.log('== timestamp drift on unique matched texts ==');
console.log(JSON.stringify({
  matchedSegs: driftN,
  avgAbsDriftSec: driftN ? Math.round((driftSum / driftN) * 100) / 100 : null,
  maxAbsDriftSec: Math.round(driftMax * 10) / 10,
  bigDriftSamples: bigDrift,
}, null, 2));
