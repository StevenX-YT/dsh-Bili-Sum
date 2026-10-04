// scripts/test-keyframes.mjs — 关键帧抽取测试
import { extractKeyframes } from '../media.js';

const bv = process.argv[2] || 'BV1RdXrB6Eo7';
const maxFrames = Number(process.argv[3] || 6);
const everySec = Number(process.argv[4] || 0);
console.log('extracting keyframes from', bv, 'max', maxFrames, everySec > 0 ? `every ${everySec}s` : '(scene detect)', '...');
const r = await extractKeyframes(bv, { maxFrames, ...(everySec > 0 ? { everySec } : {}) });
console.log(JSON.stringify({
  bvid: r.bvid, title: r.title, duration: r.duration,
  strategy: r.strategy, videoMethod: r.videoMethod,
  framesExtracted: r.framesExtracted, workDir: r.workDir,
  frames: r.frames,
}, null, 2));
