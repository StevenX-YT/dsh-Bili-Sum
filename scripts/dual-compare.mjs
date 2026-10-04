// scripts/dual-compare.mjs — ⑦ 双进程 vs 单进程 质量对比（质量门槛判定用）
// 用法：node scripts/dual-compare.mjs [目录，默认 output/BV1CAxaeHEeH_p8]
// 对比：transcript.json（双进程新跑） vs transcript-singleproc-vad-ref.json（单进程VAD参考）
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dir = process.argv[2] || 'output/BV1CAxaeHEeH_p8';
const load = async (f) => JSON.parse(await readFile(join(dir, f), 'utf8'));
const segsOf = (raw) => (raw.transcription || [])
  .map((s) => ({ from: (s.offsets?.from ?? 0) / 1000, to: (s.offsets?.to ?? 0) / 1000, text: String(s.text || '').trim() }))
  .filter((s) => s.text);
const norm = (s) => s.replace(/[\s，。！？、,.!?]/g, '');

const dual = segsOf(await load('transcript.json'));
const single = segsOf(await load('transcript-singleproc-vad-ref.json'));
let bundle = null;
try { bundle = await load('bundle.json'); } catch { /* ignore */ }
const dualInfo = bundle?.pipeline?.dual || null;
const splitAt = dualInfo?.splitAtSec ?? (bundle?.video?.duration ? 0 : 0);

function stats(segs) {
  const speech = segs.reduce((a, s) => a + Math.max(0, s.to - s.from), 0);
  return { segments: segs.length, speechSec: Math.round(speech), firstFrom: segs[0]?.from ?? null, lastTo: segs[segs.length - 1]?.to ?? null };
}
console.log('== single (ref) ==', JSON.stringify(stats(single)));
console.log('== dual (new) ==', JSON.stringify(stats(dual)));
if (bundle?.pipeline) {
  console.log('== timing ==', JSON.stringify({
    singleRefWhisperSec: 269, singleRefNote: '一期记录269s/参考bundle206s(VAD)',
    dualWallSec: bundle.pipeline.whisperElapsedSec, dualInfo,
    totalSec: bundle.pipeline.elapsedSec,
  }));
}

// 接缝窗口分析：切点 ±40s 内的段落逐条列出（人工核对吞字/重复/乱码）
const seamLo = splitAt - 40, seamHi = splitAt + 40;
const seamDual = dual.filter((s) => s.from >= seamLo && s.from <= seamHi);
const seamSingle = single.filter((s) => s.from >= seamLo && s.from <= seamHi);
console.log(`== seam window [${Math.round(seamLo)}s, ${Math.round(seamHi)}s] (splitAt=${splitAt}) ==`);
console.log('--- single ---');
seamSingle.forEach((s) => console.log(`  [${s.from.toFixed(1)}-${s.to.toFixed(1)}] ${s.text}`));
console.log('--- dual ---');
seamDual.forEach((s) => console.log(`  [${s.from.toFixed(1)}-${s.to.toFixed(1)}] ${s.text}`));

// 唯一文本时间戳漂移
const countBy = (segs) => {
  const m = new Map();
  for (const s of segs) { const k = norm(s.text); m.set(k, (m.get(k) || 0) + 1); }
  return m;
};
const sCnt = countBy(single), dCnt = countBy(dual);
const sUniq = new Map(single.filter((s) => sCnt.get(norm(s.text)) === 1).map((s) => [norm(s.text), s]));
let n = 0, sum = 0, max = 0; const big = [];
for (const s of dual) {
  const k = norm(s.text);
  if (dCnt.get(k) !== 1) continue;
  const b = sUniq.get(k);
  if (!b) continue;
  const d = s.from - b.from;
  n += 1; sum += Math.abs(d); max = Math.max(max, Math.abs(d));
  if (big.length < 10 && Math.abs(d) > 2) big.push({ text: s.text.slice(0, 28), single: Math.round(b.from * 10) / 10, dual: Math.round(s.from * 10) / 10, delta: Math.round(d * 10) / 10 });
}
console.log('== drift on unique matched texts ==');
console.log(JSON.stringify({ matched: n, avgAbsSec: n ? Math.round((sum / n) * 100) / 100 : null, maxAbsSec: Math.round(max * 10) / 10, big }, null, 2));

// 覆盖率对比：单进程有而双进程完全没有的段（按唯一文本）——粗查漏转
const dNorm = new Set(dual.map((s) => norm(s.text)));
const missing = single.filter((s) => sCnt.get(norm(s.text)) === 1 && !dNorm.has(norm(s.text)) && norm(s.text).length >= 6);
console.log('== single-only segments (possible omissions in dual, len>=6) ==', missing.length);
missing.slice(0, 12).forEach((s) => console.log(`  [${s.from.toFixed(1)}] ${s.text.slice(0, 40)}`));
