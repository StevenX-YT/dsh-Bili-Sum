// scripts/doctor.mjs — 安装自检（数据根 / 工具链 / 模型 / 登录态 / 可写性）
// 用法：node scripts/doctor.mjs [--json]
// 退出码：0 = 核心就绪（可跑 analyze 全链路）；1 = 核心有缺失（打印修复指引）
// 可选项（yt-dlp / silero VAD / cookie）缺失只警告不失败——流水线有对应回退。
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { PKG_ROOT, DATA_ROOT, OUTPUT_DIR, TOOLS_DIR, BIN_DIR, cookieFileCandidates } from '../paths.js';
import { hostDiag, vadModelPath } from '../media.js';
import { getCookie } from '../bili.js';

const asJson = process.argv.includes('--json');
const checks = [];
const add = (name, ok, detail, fix = '', optional = false) => checks.push({ name, ok: !!ok, detail: String(detail ?? ''), fix, optional });

// 1) node 版本（ESM + fetch 需要 >= 18）
add('node >= 18', Number(process.versions.node.split('.')[0]) >= 18, process.version, '安装 Node.js >= 18 并确保在 PATH 上');

// 2) 数据根可写（插件布局下 = BILI_DATA_ROOT；老布局 = 包目录）
let writable = false;
let werr = '';
try {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const probe = join(OUTPUT_DIR, '.doctor-probe');
  writeFileSync(probe, 'ok');
  rmSync(probe, { force: true });
  writable = true;
} catch (e) { werr = e.message; }
add('dataRoot writable', writable, DATA_ROOT + (writable ? '' : ` (${werr})`),
  '检查 BILI_DATA_ROOT 指向的目录可写；或删除该环境变量回退包目录布局');

// 3) 工具链（hostDiag 走与 analyze 相同的定位逻辑）
const diag = await hostDiag();
add('ffmpeg', !!diag.ffmpeg, diag.ffmpeg || `未找到（期望在 ${join(TOOLS_DIR, 'ffmpeg')}）`, 'node scripts/setup-media.ps1');
add('whisper-cli', !!diag.whisperCli, diag.whisperCli || `未找到（期望在 ${join(TOOLS_DIR, 'whisper')}）`, 'node scripts/setup-media.ps1');
add('whisper model', !!diag.model, diag.model || `未找到 ggml-small/base（期望在 ${join(TOOLS_DIR, 'models')}）`, 'node scripts/setup-media.ps1');
add('yt-dlp', !!diag.ytdlp, diag.ytdlp ? `${diag.ytdlp} @ ${join(BIN_DIR, 'yt-dlp.exe')}` : `未找到（期望在 ${join(BIN_DIR, 'yt-dlp.exe')}）`,
  'node scripts/fetch-ytdlp.mjs', true);
const silero = await vadModelPath();
add('silero VAD model', !!silero, silero || `未找到（期望在 ${join(TOOLS_DIR, 'models')}）`, 'node scripts/setup-media.ps1', true);

// 4) 登录态（评论/高清需要；getCookie 支持 BILI_SESSDATA env 或数据根/包目录 bili-cookie.txt）
const cookie = await getCookie();
add('bili cookie', !!cookie,
  cookie ? '已加载（值已脱敏）' : `未配置（候选路径：${cookieFileCandidates().join('  |  ')}）`,
  '把 SESSDATA 写入数据根 bili-cookie.txt（一行即可）；勿提交/勿外传', true);

// 汇报
const CORE = new Set(['node >= 18', 'dataRoot writable', 'ffmpeg', 'whisper-cli', 'whisper model']);
const coreFailed = checks.filter((c) => CORE.has(c.name) && !c.ok);
const warn = checks.filter((c) => !c.ok && c.optional);

if (asJson) {
  console.log(JSON.stringify({
    pkgRoot: PKG_ROOT, dataRoot: DATA_ROOT, isolatedDataRoot: DATA_ROOT !== PKG_ROOT,
    checks, ready: coreFailed.length === 0,
  }, null, 2));
} else {
  console.log(`dsh-Bili-Sum doctor — pkgRoot=${PKG_ROOT}`);
  console.log(`dataRoot=${DATA_ROOT}${DATA_ROOT !== PKG_ROOT ? '  (isolated plugin layout)' : '  (legacy layout: data lives beside code)'}`);
  console.log('');
  for (const c of checks) {
    const mark = c.ok ? 'OK  ' : (c.optional ? 'WARN' : 'FAIL');
    console.log(`[${mark}] ${c.name}: ${c.detail}`);
    if (!c.ok && c.fix) console.log(`       fix -> ${c.fix}`);
  }
  console.log('');
  console.log(coreFailed.length === 0
    ? `READY — 核心工具链就绪${warn.length ? `（${warn.length} 项可选缺失，见 WARN）` : ''}`
    : `NOT READY — ${coreFailed.length} 项核心缺失，按上方 fix 指引修复后重跑`);
}
process.exit(coreFailed.length === 0 ? 0 : 1);
