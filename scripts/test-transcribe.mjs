// scripts/test-transcribe.mjs — 端到端转录测试
import { transcribe } from '../media.js';

const bv = process.argv[2] || 'BV1RdXrB6Eo7';
console.log('transcribing', bv, '...');
const t0 = Date.now();
const r = await transcribe(bv);
console.log(JSON.stringify({
  bvid: r.bvid,
  title: r.title,
  duration: r.duration,
  model: r.model,
  audioMethod: r.audioMethod,
  segments: r.segments,
  elapsedSec: r.elapsedSec,
  wallSec: Math.round((Date.now() - t0) / 1000),
  files: r.files,
  preview: r.preview.slice(0, 15),
}, null, 2));
