// scripts/analyze-status.mjs — 查询后台分析任务进度
// 用法：node scripts/analyze-status.mjs <BV号|av号|链接|输出目录名>
// 输出：后台任务是否存活 / bundle 是否产出（含生成时间与规模）/ 日志尾部
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveId, videoInfo } from '../bili.js';
import { pickPage, OUTPUT_DIR } from '../media.js';

const arg = process.argv[2];
if (!arg) { console.error('usage: analyze-status.mjs <bvid|url|dirname>'); process.exit(2); }

let dirName = String(arg);
if (/^(BV|av|https?:)/i.test(arg)) {
  const id = await resolveId(arg);
  const info = await videoInfo(id);
  const p = pickPage(info, id.page);
  dirName = p.page > 1 ? `${info.bvid}_p${p.page}` : info.bvid;
}
const workDir = join(OUTPUT_DIR, dirName);
if (!existsSync(workDir)) { console.log(JSON.stringify({ dirName, exists: false })); process.exit(0); }

const statusPath = join(workDir, 'analyze-bg.json');
const bundlePath = join(workDir, 'bundle.json');
const logPath = join(workDir, 'analyze-bg.log');

let st = null;
try { st = JSON.parse(await readFile(statusPath, 'utf8')); } catch { /* 无后台任务记录（前台跑的） */ }
let pidAlive = null;
if (st?.pid) { try { process.kill(st.pid, 0); pidAlive = true; } catch { pidAlive = false; } }

let bundleInfo = null;
if (existsSync(bundlePath)) {
  const s = await stat(bundlePath);
  let b = null;
  try { b = JSON.parse(await readFile(bundlePath, 'utf8')); } catch { /* ignore */ }
  bundleInfo = {
    generatedAt: b?.generatedAt || null,
    route: b?.pipeline?.route || null,
    vad: b?.pipeline?.vad ?? null,
    whisperElapsedSec: b?.pipeline?.whisperElapsedSec ?? null,
    elapsedSec: b?.pipeline?.elapsedSec ?? null,
    segments: b?.transcript?.segments ?? null,
    frames: b?.frames?.length ?? null,
    fileMtime: s.mtime.toISOString(),
  };
}
let logTail = '';
if (existsSync(logPath)) {
  const txt = await readFile(logPath, 'utf8');
  logTail = txt.slice(-1200);
}
console.log(JSON.stringify({
  dirName, workDir,
  bgTask: st ? { pid: st.pid, pidAlive, startedAt: st.startedAt, durationSec: st.durationSec } : null,
  bundle: bundleInfo,
  logTail,
}, null, 2));
