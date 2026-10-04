// scripts/ab-medium-run.mjs — Q3② A/B：以指定模型转录指定视频，完整结果落盘供比对
// 用法：node scripts/ab-medium-run.mjs [bvid] [model]   （默认 BV1YaeN6xEWR medium）
// 产出：output/<bvid>/ab-<model>.json（元数据+全字段，含转录文本）
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { transcribe } from '../media.js';
import { OUTPUT_DIR } from '../paths.js';

const bv = process.argv[2] || 'BV1YaeN6xEWR';
const model = process.argv[3] || 'medium';
console.log(`transcribe ${bv} model=${model} ...`);
const t0 = Date.now();
const r = await transcribe(bv, { model });
const wallSec = (Date.now() - t0) / 1000;
const meta = {
  bvid: r.bvid, title: r.title, duration: r.duration, model: r.model,
  audioMethod: r.audioMethod, segments: r.segments, elapsedSec: r.elapsedSec, wallSec,
  files: r.files, keys: Object.keys(r),
};
const outDir = join(OUTPUT_DIR, bv);
await writeFile(join(outDir, `ab-${model}.json`), JSON.stringify({ meta, full: r }, null, 2), 'utf8');
console.log(JSON.stringify({ ...meta, preview: String(r.preview ?? '').slice(0, 400) }, null, 2));
