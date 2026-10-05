// media.js — 视频媒体理解流水线
// playurl 直连下载（wbi 签名） / yt-dlp 回退 / ffmpeg 音频转换与抽帧 / whisper.cpp 转录
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, writeFile, rm, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { videoInfo, resolveId, UA, YTDLP, ytdlpVersion, getBuvid, getCookie, fmtTs, getDanmaku } from './bili.js';
import { PKG_ROOT, DATA_ROOT, TOOLS_DIR, OUTPUT_DIR, YTDLP_TMP } from './paths.js';
import { toSimplified } from './zh-conv.js';

// 路径解耦（插件化）：运行时数据（output/tools/bin）经 BILI_DATA_ROOT 解析（dsh patch 注入数据根），
// 未设置时回退包目录——老布局完全兼容。代码资产（scripts/templates）恒在包内（PKG_ROOT）。
export { PKG_ROOT, DATA_ROOT, TOOLS_DIR, OUTPUT_DIR };
const __dirname = PKG_ROOT; // 后台 spawn 等代码资产引用仍用包根

// whisper 线程数：默认用满 CPU（留 2 核给系统），可用环境变量 BILI_WHISPER_THREADS 覆盖
export function whisperThreads() {
  const envN = Number(process.env.BILI_WHISPER_THREADS || 0);
  if (envN > 0) return envN;
  const n = cpus()?.length || 4;
  // 混合架构 CPU（如 i9-14900HX）上 decoder 线程过大反而变慢（whisper.cpp#1282），上限 8
  return n >= 16 ? 8 : Math.max(4, n - 2);
}

// VAD 开关：默认开启（跳过静音/BGM 段，省 20~50% 转录时间并消除幻觉）；BILI_WHISPER_VAD=0 关闭
export function vadEnabled() {
  const v = String(process.env.BILI_WHISPER_VAD ?? '1');
  return !(v === '0' || v === 'off' || v === 'false');
}

// VAD 模型定位（Silero ggml，tools/models/ggml-silero-*.bin；缺失时返回 null=不启用 VAD，不报错）
export async function vadModelPath() {
  const dir = join(TOOLS_DIR, 'models');
  if (!existsSync(dir)) return null;
  for (const n of ['ggml-silero-v6.2.0.bin', 'ggml-silero-v6.0.bin', 'ggml-silero-v5.1.2.bin', 'ggml-silero-v5.bin']) {
    const p = join(dir, n);
    if (existsSync(p)) return p;
  }
  try {
    const files = await readdir(dir);
    const hit = files.find((f) => /^ggml-silero-.*\.bin$/i.test(f));
    return hit ? join(dir, hit) : null;
  } catch { return null; }
}

// 子进程执行：stderr 重定向到日志文件再读回。
// 原因：DSH 沙箱禁止 stdio 命名管道（execFile/spawn 默认 pipe → EPERM），
// 文件描述符重定向在沙箱与宿主两种环境都能工作。
async function run(cmd, args, { timeout = 300000, env } = {}) {
  await mkdir(YTDLP_TMP, { recursive: true });
  const logPath = join(YTDLP_TMP, `run-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.log`);
  let fh;
  try { fh = await open(logPath, 'w'); } catch (e) { return { ok: false, code: -1, stdout: '', stderr: `无法创建日志文件: ${e.message}` }; }
  return new Promise((resolve) => {
    let settled = false;
    const finish = async (ok, code, extra) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      let stderr = extra || '';
      try { stderr += await readFile(logPath, 'utf8'); } catch { /* ignore */ }
      try { await fh.close(); } catch { /* ignore */ }
      await rm(logPath, { force: true }).catch(() => {});
      resolve({ ok, code, stdout: '', stderr: stderr.slice(-512 * 1024) });
    };
    let timer = null;
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'ignore', fh.fd], windowsHide: true, ...(env ? { env } : {}) });
    } catch (e) { finish(false, -1, `spawn 异常: ${e.message}`); return; }
    if (timeout > 0) {
      timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } finish(false, null, 'timeout killed; '); }, timeout);
    }
    child.on('error', (e) => { finish(false, null, `spawn error: ${e.message}`); });
    child.on('close', (code) => { finish(code === 0, code, ''); });
  });
}

// ---------- 工具定位 ----------
async function findFirst(dir, names) {
  if (!existsSync(dir)) return null;
  let entries;
  try { entries = await readdir(dir, { recursive: true, withFileTypes: true }); } catch { return null; }
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    if (names.some((n) => ent.name.toLowerCase() === n.toLowerCase())) {
      return join(ent.parentPath || ent.path || dir, ent.name);
    }
  }
  return null;
}

export async function ffmpegExe() {
  return findFirst(join(TOOLS_DIR, 'ffmpeg'), ['ffmpeg.exe']);
}
export async function whisperCliExe() {
  // 只认 whisper-cli.exe：同目录的 main.exe / command.exe 是 v1.9.x 的弃用桩（只打印警告就退出）
  return (await findFirst(join(TOOLS_DIR, 'whisper'), ['whisper-cli.exe']))
      || (await findFirst(join(TOOLS_DIR, 'whisper-vulkan'), ['whisper-cli.exe']));
}
export async function whisperModel(prefer = 'small') {
  const order = [prefer, 'small', 'base', 'medium', 'large-v3'].filter((v, i, a) => a.indexOf(v) === i);
  for (const name of order) {
    const p = join(TOOLS_DIR, 'models', `ggml-${name}.bin`);
    if (existsSync(p)) return { path: p, name };
  }
  return null;
}

// ---------- WBI 签名 ----------
const WBI_MIXIN = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
let mixinKeyCache = null;

async function getMixinKey() {
  if (mixinKeyCache) return mixinKeyCache;
  let cookie = '';
  try { cookie = (await getBuvid()) || ''; } catch { /* 无 buvid 时裸请求 */ }
  const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: {
      'User-Agent': UA,
      Referer: 'https://www.bilibili.com',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json();
  const img = j?.data?.wbi_img?.img_url || '';
  const sub = j?.data?.wbi_img?.sub_url || '';
  // 密钥 = 文件名去掉扩展名（兼容任意前缀格式）
  const keyOf = (url) => {
    const name = String(url).slice(String(url).lastIndexOf('/') + 1);
    return name.slice(0, name.lastIndexOf('.'));
  };
  const imgKey = keyOf(img);
  const subKey = keyOf(sub);
  if (!imgKey || !subKey || imgKey === '.png') throw new Error(`获取 WBI 密钥失败：code=${j?.code} ${j?.message || ''}`);
  const raw = imgKey + subKey;
  mixinKeyCache = WBI_MIXIN.map((i) => raw[i]).join('');
  return mixinKeyCache;
}

export async function wbiGet(path, params, { referer, cookie } = {}) {
  const mixin = await getMixinKey();
  const p = { ...params, wts: Math.floor(Date.now() / 1000) };
  const clean = {};
  for (const k of Object.keys(p).sort()) {
    clean[k] = String(p[k] ?? '').replace(/[!'()*]/g, '');
  }
  const query = new URLSearchParams(clean).toString();
  const wrid = createHash('md5').update(query + mixin).digest('hex');
  const headers = {
    'User-Agent': UA, 'Accept': 'application/json, text/plain, */*',
    Referer: referer || 'https://www.bilibili.com',
  };
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(`${path}?${query}&w_rid=${wrid}`, { headers, signal: AbortSignal.timeout(20000) });
  return res.json();
}

// ---------- playurl 直连 ----------
export function pickPage(info, page) {
  const pages = info.pages?.length ? info.pages : [{ page: 1, part: info.title, cid: info.cid }];
  const idx = Math.min(Math.max(1, Number(page) || 1), pages.length) - 1;
  return pages[idx];
}

export async function getPlayUrl(input, { videoQn = 64, page } = {}) {
  const id = await resolveId(input);
  const info = await videoInfo(id);
  const p = pickPage(info, page ?? id.page);
  const base = { bvid: info.bvid, cid: p.cid, fnver: 0, fnval: 4048, fourk: 1, qn: videoQn };
  let j = null;
  try {
    j = await wbiGet('https://api.bilibili.com/x/player/wbi/playurl', base, { referer: info.url });
  } catch { j = null; }
  if (!j || j.code !== 0) {
    const qs = new URLSearchParams({ bvid: info.bvid, cid: String(p.cid), fnver: '0', fnval: '4048', fourk: '1', qn: String(videoQn) });
    const buvid = (await getBuvid()) || 'buvid3=infoc';
    const res = await fetch(`https://api.bilibili.com/x/player/playurl?${qs}`, {
      headers: { 'User-Agent': UA, Referer: info.url, Cookie: buvid },
      signal: AbortSignal.timeout(20000),
    });
    j = await res.json();
  }
  if (!j || j.code !== 0) throw new Error(`playurl 失败：code=${j?.code} ${j?.message || ''}`);
  const dash = j.data?.dash;
  const out = {
    bvid: info.bvid, aid: info.aid, cid: p.cid, page: p.page, part: p.part, title: info.title, url: info.url,
    quality: j.data?.quality, acceptQuality: j.data?.accept_quality,
  };
  if (dash?.audio?.length) {
    const audio = [...dash.audio].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];
    out.audio = { id: audio.id, bandwidth: audio.bandwidth, codecs: audio.codecs, url: audio.baseUrl || audio.base_url };
  }
  if (dash?.video?.length) {
    let v = null;
    for (const qn of [videoQn, 64, 32, 16, 80]) { v = dash.video.find((x) => x.id === qn); if (v) break; }
    v = v || dash.video[0];
    out.video = { id: v.id, width: v.width, height: v.height, codecs: v.codecs, url: v.baseUrl || v.base_url };
  }
  if (!out.audio && !out.video && j.data?.durl?.length) {
    out.durl = j.data.durl.map((d) => ({ url: d.url, size: d.size }));
  }
  if (!out.audio && !out.video && !out.durl) throw new Error('playurl 未返回可用流（可能需要登录或活动限制）');
  return out;
}

// 直链流（durl 单文件 MP4，fnval=1）：供前端 <video> 在线播放（不落盘）。
// 原生 <video> 有 timeupdate/pause/seek 事件，小窗字幕可与视频天然联动；
// 有 bili-cookie.txt 登录态时自动请求更高清晰度（qn=80→1080P档）。
export async function getPlayUrlDurl(input, { qn = 80, page } = {}) {
  const id = await resolveId(input);
  const info = await videoInfo(id);
  const p = pickPage(info, page ?? id.page);
  const cookie = (await getCookie()) || (await getBuvid());
  const base = { bvid: info.bvid, cid: p.cid, fnver: 0, fnval: 1, fourk: 1, qn };
  let j = null;
  try {
    j = await wbiGet('https://api.bilibili.com/x/player/wbi/playurl', base, {
      referer: info.url, cookie: cookie || undefined,
    });
  } catch { j = null; }
  if (!j || j.code !== 0) {
    const qs = new URLSearchParams({
      bvid: info.bvid, cid: String(p.cid), fnver: '0', fnval: '1', fourk: '1', qn: String(qn),
    });
    const res = await fetch(`https://api.bilibili.com/x/player/playurl?${qs}`, {
      headers: { 'User-Agent': UA, Referer: info.url, Cookie: cookie || 'buvid3=infoc' },
      signal: AbortSignal.timeout(20000),
    });
    j = await res.json();
  }
  if (!j || j.code !== 0) throw new Error(`playurl(durl) 失败：code=${j?.code} ${j?.message || ''}`);
  const durls = j.data?.durl || [];
  if (!durls.length) throw new Error('playurl(durl) 未返回直链（该视频可能仅支持 DASH 流）');
  const url = durls[0].url;
  let exp = 0;
  const m = String(url).match(/[?&](?:expires?|deadline|e)=(\d+)/i);
  if (m) exp = Number(m[1]);
  return {
    bvid: info.bvid, cid: p.cid, page: p.page, part: p.part, title: info.title,
    url, quality: j.data?.quality ?? qn, size: durls[0].size || 0, exp,
    segments: durls.length, at: Date.now(),
  };
}

export async function downloadToFile(url, outPath, { referer } = {}) {
  await mkdir(dirname(outPath), { recursive: true });
  const headers = { 'User-Agent': UA, Referer: referer || 'https://www.bilibili.com' };
  if (referer) headers['Origin'] = 'https://www.bilibili.com';
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(900000), redirect: 'follow' });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(outPath, buf);
  return { path: outPath, bytes: buf.length };
}

// ---------- yt-dlp 辅助 ----------
async function ytdlpEnv() {
  await mkdir(YTDLP_TMP, { recursive: true });
  return { ...process.env, TEMP: YTDLP_TMP, TMP: YTDLP_TMP, TMPDIR: YTDLP_TMP };
}

async function ytdlpFetch(args, timeout) {
  const env = await ytdlpEnv();
  return run(YTDLP, [...args, '--no-warnings', '--no-playlist'], { env, timeout });
}

// ---------- 音频获取 ----------
async function obtainAudio(info, workDir, page = 1) {
  const ver = await ytdlpVersion();
  if (ver) {
    const outT = join(workDir, 'audio.%(ext)s');
    const mediaUrl = page > 1 ? `${info.url}?p=${page}` : info.url;
    const args = ['-f', 'bestaudio/best', '-o', outT];
    if (page > 1) args.push('--playlist-items', String(page));
    args.push(mediaUrl);
    const r = await ytdlpFetch(args, 600000);
    if (r.ok) {
      const files = await readdir(workDir);
      const audio = files.find((f) => /^audio\./.test(f) && !/\.part$/i.test(f));
      if (audio) return { path: join(workDir, audio), method: 'yt-dlp' };
    }
  }
  const pu = await getPlayUrl(info.bvid, { videoQn: 64, page });
  if (pu.audio) {
    const p = join(workDir, 'audio.m4a');
    await downloadToFile(pu.audio.url, p, { referer: info.url });
    return { path: p, method: 'playurl-direct' };
  }
  if (pu.durl?.length) {
    const p = join(workDir, 'audio-video.mp4');
    await downloadToFile(pu.durl[0].url, p, { referer: info.url });
    return { path: p, method: 'playurl-durl' };
  }
  throw new Error('无法获取音频：yt-dlp 与 playurl 直连均失败');
}

async function toWav(inputPath, workDir) {
  const ff = await ffmpegExe();
  if (!ff) throw new Error('未找到 ffmpeg.exe（应在 tools/ffmpeg 下）');
  const wav = join(workDir, 'audio-16k.wav');
  const r = await run(ff, ['-y', '-i', inputPath, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], { timeout: 600000 });
  if (!r.ok || !existsSync(wav)) throw new Error(`ffmpeg 转 wav 失败：${r.stderr.slice(-600)}`);
  return wav;
}

async function runWhisper(wavPath, workDir, { lang = 'zh', modelName = '', prompt = '', threads, vad, outBase } = {}) {
  const cli = await whisperCliExe();
  if (!cli) throw new Error('未找到 whisper-cli.exe（应在 tools/whisper 下）');
  const m = modelName ? await whisperModel(modelName) : await whisperModel();
  if (!m) throw new Error('未找到模型文件 tools/models/ggml-*.bin');
  const base = outBase || join(workDir, 'transcript');
  const jsonPath = base + '.json';
  await rm(jsonPath, { force: true }).catch(() => {}); // 先删旧结果，防止运行失败时误判为成功
  const t = threads || whisperThreads();
  const args = ['-m', m.path, '-f', wavPath, '-l', lang || 'auto', '-oj', '-of', base, '-t', String(t)];
  // VAD：跳过静音/BGM 段（-vp 200 段首尾 padding 防吞字；-vmsd 25 防超长段导致时间戳漂移）
  const useVad = vad ?? vadEnabled();
  const vm = useVad ? await vadModelPath() : null;
  if (vm) args.push('--vad', '-vm', vm, '-vp', '200', '-vmsd', '25');
  // 抑制非语音 token（独立于 VAD 的幻觉抑制，零风险，恒开）
  args.push('--suppress-nst');
  let promptFile = null;
  if (prompt) {
    // v1.9.2 BLAS 版 -p 直接传参会崩溃（中英文皆然）；改用 ggml 的 @response-file 语法规避
    await mkdir(YTDLP_TMP, { recursive: true });
    promptFile = join(YTDLP_TMP, `prompt-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.txt`);
    await writeFile(promptFile, `-p\n${prompt}\n`, 'utf8');
    args.push(`@${promptFile}`, '--carry-initial-prompt'); // 全程携带偏置，长视频必需
  }
  const tw = Date.now();
  const r = await run(cli, args, {
    timeout: 3600000, maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, OPENBLAS_NUM_THREADS: String(Math.min(8, t)) },
  });
  const whisperElapsedSec = Math.round((Date.now() - tw) / 1000);
  if (promptFile) await rm(promptFile, { force: true }).catch(() => {});
  if (!r.ok || !existsSync(jsonPath)) throw new Error(`whisper 转录失败（exit=${r.code}）：${String(r.stderr).slice(-800)}`);
  return { jsonPath, model: m.name, cli, stderrTail: String(r.stderr).slice(-400), whisperElapsedSec, vad: !!vm };
}

// ---------- ⑦ whisper 双进程分块并行 ----------
// 音频在静音点一分为二 → 两个 whisper 进程各 8 线程同时转录 → 拼接段落（part2 时间戳 +切点偏移）。
// 纯本地 CPU 并行（无网络，不涉及B站CDN双流问题）。BILI_WHISPER_DUAL=1 启用（极速路线候选）。

// ffmpeg silencedetect 找距中点最近的静音中点作切点；不合适则硬切中点
export async function detectSplitPoint(wavPath) {
  const ff = await ffmpegExe();
  const r = await run(ff, ['-i', wavPath, '-af', 'silencedetect=noise=-35dB:d=0.35', '-f', 'null', '-'], { timeout: 300000 });
  const stderr = String(r.stderr || '');
  const silences = [];
  const re = /silence_start:\s*([0-9.]+)[\s\S]*?silence_end:\s*([0-9.]+)/g;
  let m;
  while ((m = re.exec(stderr)) !== null) silences.push({ start: Number(m[1]), end: Number(m[2]) });
  const dm = stderr.match(/Duration: (\d+):(\d+):(\d+)/);
  const dur = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 0;
  const mid = dur / 2;
  let best = null, bestD = Infinity;
  for (const s of silences) {
    const c = (s.start + s.end) / 2;
    const d = Math.abs(c - mid);
    if (d < bestD) { bestD = d; best = c; }
  }
  if (best != null && dur > 0 && bestD < dur * 0.2) return { at: Math.round(best * 10) / 10, method: 'silence', dur, silenceCount: silences.length };
  return { at: Math.round(mid * 10) / 10, method: 'hard', dur, silenceCount: silences.length };
}

async function splitWav(ff, wavPath, workDir, atSec) {
  const p1 = join(workDir, 'part1-16k.wav');
  const p2 = join(workDir, 'part2-16k.wav');
  const r1 = await run(ff, ['-y', '-i', wavPath, '-t', String(atSec), '-c:a', 'pcm_s16le', p1], { timeout: 300000 });
  const r2 = await run(ff, ['-y', '-ss', String(atSec), '-i', wavPath, '-c:a', 'pcm_s16le', p2], { timeout: 300000 });
  if (!r1.ok || !r2.ok || !existsSync(p1) || !existsSync(p2)) throw new Error('音频切分失败');
  return { p1, p2 };
}

const normText = (s) => String(s || '').replace(/[\s，。！？、,.!?]/g, '');

export async function runWhisperDual(wavPath, workDir, opts = {}) {
  const ff = await ffmpegExe();
  if (!ff) throw new Error('未找到 ffmpeg.exe');
  const split = await detectSplitPoint(wavPath);
  const force = process.env.BILI_WHISPER_DUAL === '1';
  if (split.method === 'hard' && !force) {
    // 无合适静音切点（如重配乐视频）：硬切接缝吞字风险高 → 自动回退单进程（=1 强制时才硬切）
    const w = await runWhisper(wavPath, workDir, opts);
    return { ...w, dual: { splitAtSec: split.at, splitMethod: 'hard-fallback-single', silenceCount: split.silenceCount } };
  }
  const { p1, p2 } = await splitWav(ff, wavPath, workDir, split.at);
  const t0 = Date.now();
  let w1, w2;
  try {
    [w1, w2] = await Promise.all([
      runWhisper(p1, workDir, { ...opts, outBase: join(workDir, 'transcript-p1') }),
      runWhisper(p2, workDir, { ...opts, outBase: join(workDir, 'transcript-p2') }),
    ]);
  } catch (e) {
    // 双进程失败（典型：内存不足——两个长块各需 ~500MB，与其他负载叠加 OOM）→ 回退单进程全量转录，不牺牲产出
    await rm(p1, { force: true }).catch(() => {});
    await rm(p2, { force: true }).catch(() => {});
    const w = await runWhisper(wavPath, workDir, opts);
    return { ...w, dual: { splitAtSec: split.at, splitMethod: 'dual-failed-fallback-single', error: String((e && e.message) || e).slice(0, 200) } };
  }
  const wallSec = Math.round((Date.now() - t0) / 1000);
  const raw1 = JSON.parse(await readFile(w1.jsonPath, 'utf8'));
  const raw2 = JSON.parse(await readFile(w2.jsonPath, 'utf8'));
  const segs1 = parseWhisperSegments(raw1);
  const segs2 = parseWhisperSegments(raw2).map((s) => ({ from: s.from + split.at, to: s.to + split.at, text: s.text }));
  // 接缝防御性去重：p2 开头段与 p1 结尾段文本高度重叠时丢弃（静音切分通常不重叠，防双转）
  let dropped = 0;
  if (segs1.length && segs2.length) {
    const tail = normText(segs1[segs1.length - 1].text);
    const keep2 = [];
    for (const s of segs2) {
      const n = normText(s.text);
      if (n && tail && n.length >= 4 && (tail.endsWith(n) || n.endsWith(tail) || tail.includes(n) || n.includes(tail))) { dropped += 1; continue; }
      keep2.push(s);
    }
    segs2.length = 0;
    segs2.push(...keep2);
  }
  const mergedSegs = [...segs1, ...segs2];
  // 写出与 whisper-cli -oj 兼容的合并结果（offsets 毫秒），下游 parseWhisperSegments 无感
  const mergedRaw = {
    transcription: mergedSegs.map((s) => ({ offsets: { from: Math.round(s.from * 1000), to: Math.round(s.to * 1000) }, text: s.text })),
  };
  const jsonPath = join(workDir, 'transcript.json');
  await writeFile(jsonPath, JSON.stringify(mergedRaw, null, 2), 'utf8');
  await rm(p1, { force: true }).catch(() => {});
  await rm(p2, { force: true }).catch(() => {});
  return {
    jsonPath,
    model: w1.model,
    cli: w1.cli,
    stderrTail: `p1: ${w1.stderrTail.slice(-150)} | p2: ${w2.stderrTail.slice(-150)}`,
    whisperElapsedSec: wallSec,
    vad: !!w1.vad,
    dual: {
      splitAtSec: split.at, splitMethod: split.method, silenceCount: split.silenceCount,
      partSec: [w1.whisperElapsedSec, w2.whisperElapsedSec], seamDropped: dropped,
      segs1: segs1.length, segs2: segs2.length,
    },
  };
}

// 解析 whisper-cli JSON：兼容 offsets.from/to（毫秒）与 timestamps.from/to（"00:00:03,960"）两种格式
export function parseWhisperSegments(raw) {
  const tsToSec = (v) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v / 1000;
    const m = String(v || '').match(/(\d+):(\d+):(\d+)[,.](\d+)/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    return 0;
  };
  return ((raw && raw.transcription) || [])
    .map((s) => {
      const off = s.offsets || {};
      const from = off.from ?? off.from_ms;
      const to = off.to ?? off.to_ms;
      return {
        from: typeof from === 'number' ? from / 1000 : tsToSec(s.timestamps?.from),
        to: typeof to === 'number' ? to / 1000 : tsToSec(s.timestamps?.to),
        text: String(s.text || '').trim(),
      };
    })
    .filter((s) => s.text);
}

// ---------- 转录 ----------
export async function transcribe(input, { lang = 'zh', model = '', keepMedia = false, page, prompt = '', threads, vad } = {}) {
  const id = await resolveId(input);
  const info = await videoInfo(id);
  const p = pickPage(info, page ?? id.page);
  const dirName = p.page > 1 ? `${info.bvid}_p${p.page}` : info.bvid;
  const workDir = join(OUTPUT_DIR, dirName);
  await mkdir(workDir, { recursive: true });
  const t0 = Date.now();
  const audio = await obtainAudio(info, workDir, p.page);
  const wav = await toWav(audio.path, workDir);
  const w = await runWhisper(wav, workDir, { lang, modelName: model, prompt, threads, vad });
  const raw = JSON.parse(await readFile(w.jsonPath, 'utf8'));
  // 源级繁→简静默校正（Q3② medium 接入配套）：medium/large 常输出繁体，落盘前统一转简
  const segs = parseWhisperSegments(raw).map((s) => ({ ...s, text: toSimplified(s.text) }));
  const txt = segs.map((s) => `[${fmtTs(s.from)}] ${s.text}`).join('\n');
  const txtPath = join(workDir, 'transcript.txt');
  await writeFile(txtPath, txt, 'utf8');
  const metaPath = join(workDir, 'meta.json');
  await writeFile(metaPath, JSON.stringify({
    bvid: info.bvid, aid: info.aid, page: p.page, part: p.part, title: info.title, url: info.url,
    duration: info.duration, lang, model: w.model, audioMethod: audio.method,
    segments: segs.length, createdAt: new Date().toISOString(),
  }, null, 2), 'utf8');
  if (!keepMedia) {
    await rm(audio.path, { force: true }).catch(() => {});
    await rm(wav, { force: true }).catch(() => {});
  }
  const preview = txt ? txt.split('\n').slice(0, 40) : [];
  return {
    bvid: info.bvid, page: p.page, part: p.part, title: info.title, url: info.url, duration: info.duration,
    language: lang, model: w.model, audioMethod: audio.method,
    // 质量路线防呆（审计 2026-10-04）：请求模型缺失回退时显式标注
    ...(w.model && w.model !== String(model || 'small')
      ? { modelFallback: `requested ${model || 'small'} -> actual ${w.model}（模型文件缺失已回退；下载 ggml-${model}.bin 至数据根 tools/models/ 可启用）` }
      : {}),
    segments: segs.length, elapsedSec: Math.round((Date.now() - t0) / 1000),
    previewLines: preview.length, preview,
    files: { transcriptTxt: txtPath, transcriptJson: w.jsonPath, meta: metaPath, workDir },
    ...(segs.length > 40 ? { note: `预览仅前 40 行（共 ${segs.length} 行），全文在 transcriptTxt 文件中。` } : {}),
  };
}

// ---------- 关键帧 ----------
// ---------- 关键帧 ----------

async function obtainVideo(info, workDir, page = 1) {
  let videoPath = null;
  let method = null;
  const ver = await ytdlpVersion();
  if (ver) {
    const ff = await ffmpegExe();
    const outT = join(workDir, 'video.%(ext)s');
    const mediaUrl = page > 1 ? `${info.url}?p=${page}` : info.url;
    const args = ['-f', 'bv*[height<=480]+ba/b[height<=480]/b', '-o', outT];
    if (ff) args.push('--ffmpeg-location', dirname(ff));
    if (page > 1) args.push('--playlist-items', String(page));
    args.push(mediaUrl);
    const r = await ytdlpFetch(args, 900000);
    if (r.ok) {
      const files = await readdir(workDir);
      const vf = files.find((f) => /^video\./.test(f) && !/\.part$/i.test(f));
      if (vf) { videoPath = join(workDir, vf); method = 'yt-dlp'; }
    }
  }
  if (!videoPath) {
    const pu = await getPlayUrl(info.bvid, { videoQn: 32, page });
    if (pu.video) { videoPath = join(workDir, 'video.mp4'); await downloadToFile(pu.video.url, videoPath, { referer: info.url }); method = 'playurl-direct'; }
    else if (pu.durl?.length) { videoPath = join(workDir, 'video.mp4'); await downloadToFile(pu.durl[0].url, videoPath, { referer: info.url }); method = 'playurl-durl'; }
  }
  if (!videoPath) throw new Error('无法获取视频流：yt-dlp 与 playurl 直连均失败');
  return { path: videoPath, method };
}

async function framesAtTimestamps(ff, videoPath, workDir, timestamps) {
  const frames = [];
  for (const tSec of timestamps) {
    const out = join(workDir, `kf_at_${fmtTs(tSec).replace(/:/g, 'm')}s.png`);
    const r = await run(ff, ['-y', '-ss', String(Math.max(0, Math.round(tSec * 10) / 10)), '-i', videoPath, '-frames:v', '1', '-q:v', '2', out], { timeout: 120000 });
    if (r.ok && existsSync(out)) frames.push({ index: frames.length + 1, time: fmtTs(tSec), timeSec: Math.round(tSec * 10) / 10, file: out });
  }
  return frames;
}

async function smartSceneFrames(ff, videoPath, workDir, { scene, maxFrames }) {
  const sceneDir = join(workDir, '_scene');
  await mkdir(sceneDir, { recursive: true });
  const metaFile = join(sceneDir, 'scene_meta.txt');
  // 全量抽取场景切换帧并落盘时间元数据，再按全片时长均匀取样——避免旧实现"只截前 maxFrames 张"的前段偏置
  const vf = `select='gt(scene,${scene})',metadata=print:file=${metaFile.replace(/\\/g, '/')}`;
  const r = await run(ff, ['-y', '-i', videoPath, '-vf', vf, '-fps_mode', 'vfr', join(sceneDir, 's_%05d.png')], { timeout: 900000 });
  let times = [];
  try {
    const meta = await readFile(metaFile, 'utf8');
    times = [...meta.matchAll(/pts_time:([0-9.]+)/g)].map((m) => parseFloat(m[1]));
  } catch { /* 无元数据则时间按 0 处理 */ }
  const files = (await readdir(sceneDir)).filter((f) => /^s_\d+\.png$/i.test(f)).sort();
  if (files.length === 0) return { frames: [], sceneCount: 0, stderr: r.stderr };
  const n = Math.min(maxFrames, files.length);
  const picked = [];
  for (let k = 0; k < n; k += 1) {
    const idx = n === 1 ? 0 : Math.round((k * (files.length - 1)) / (n - 1));
    if (!picked.includes(idx)) picked.push(idx);
  }
  const frames = [];
  for (const idx of picked) {
    const tSec = times[idx] ?? 0;
    const dest = join(workDir, `kf_${String(frames.length + 1).padStart(3, '0')}.png`);
    await copyFile(join(sceneDir, files[idx]), dest);
    frames.push({ index: frames.length + 1, time: fmtTs(tSec), timeSec: Math.round(tSec * 10) / 10, file: dest });
  }
  frames.sort((a, b) => a.timeSec - b.timeSec);
  frames.forEach((f, i) => { f.index = i + 1; });
  return { frames, sceneCount: files.length, stderr: r.stderr };
}

// 自适应抽帧：低帧率采样全片 → 与上一保留帧做字节差异比对去重 → 只保留"画面真正变化"的帧。
// 对课程板书（渐进书写、无镜头切换）比相邻帧场景检测有效：每次板书重写都会被捕捉。
async function adaptiveFrames(ff, videoPath, workDir, { maxFrames, gapSec = 0 } = {}) {
  const rawDir = join(workDir, '_raw');
  await mkdir(rawDir, { recursive: true });
  let gap = Number(gapSec) > 0 ? Number(gapSec) : 0;
  if (!gap) {
    const probe = await run(ff, ['-i', videoPath, '-f', 'null', '-'], { timeout: 60000 });
    const m = String(probe.stderr || '').match(/Duration: (\d+):(\d+):(\d+)/);
    const durSec = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 600;
    gap = Math.max(2, Math.round(durSec / 300));
  }
  await run(ff, ['-y', '-i', videoPath, '-vf', `fps=1/${gap},scale=-2:480`, '-q:v', '5', join(rawDir, 'r_%05d.png')], { timeout: 900000 });
  const files = (await readdir(rawDir)).filter((f) => /^r_\d+\.png$/i.test(f)).sort();
  if (files.length === 0) return { frames: [], gapSec: gap, rawCount: 0 };
  const bufCache = new Map();
  const load = async (f) => {
    if (!bufCache.has(f)) bufCache.set(f, await readFile(join(rawDir, f)));
    return bufCache.get(f);
  };
  const diffRatio = (a, b) => {
    const n = Math.min(a.length, b.length);
    if (n === 0) return 1;
    if (Math.abs(a.length - b.length) / n > 0.05) return 1;
    const step = Math.max(1, Math.floor(n / 2048));
    let diff = 0; let samples = 0;
    for (let i = 0; i < n; i += step) { samples += 1; if (a[i] !== b[i]) diff += 1; }
    return diff / Math.max(1, samples);
  };
  const keep = [0];
  let last = await load(files[0]);
  for (let i = 1; i < files.length; i += 1) {
    const cur = await load(files[i]);
    if (diffRatio(last, cur) > 0.02) { keep.push(i); last = cur; }
  }
  if (keep[keep.length - 1] !== files.length - 1) keep.push(files.length - 1);
  let picked = keep;
  if (picked.length > maxFrames) {
    picked = [];
    for (let k = 0; k < maxFrames; k += 1) picked.push(keep[Math.round((k * (keep.length - 1)) / (maxFrames - 1))]);
  }
  if (picked.length < 3 && files.length >= 3) {
    const n = Math.min(maxFrames, files.length);
    picked = [];
    for (let k = 0; k < n; k += 1) picked.push(Math.round((k * (files.length - 1)) / (n - 1)));
  }
  const frames = [];
  for (const idx of picked) {
    const tSec = idx * gap;
    const dest = join(workDir, `kf_${String(frames.length + 1).padStart(3, '0')}.png`);
    await copyFile(join(rawDir, files[idx]), dest);
    frames.push({ index: frames.length + 1, time: fmtTs(tSec), timeSec: tSec, file: dest });
  }
  bufCache.clear();
  await rm(rawDir, { recursive: true, force: true }).catch(() => {});
  return { frames, gapSec: gap, rawCount: files.length };
}

// 快速路线抽帧：转录驱动定点快取——在有语音的时间点均匀取样 + 片尾帧（课程最终板书常在结尾），
// ffmpeg -ss 跳跃抽取不解码全片，比 adaptiveFrames 快 60~70%；代价是画面变化捕捉密度低（不适合板书课）。
export async function quickFrames(ff, videoPath, workDir, segs, { maxFrames = 12 } = {}) {
  const n = Math.max(4, Math.min(Number(maxFrames) || 12, 12));
  const pts = new Set();
  const lastSec = segs.length ? segs[segs.length - 1].to : 0;
  if (segs.length) {
    const k = Math.max(2, n - 1); // 末尾另补片尾帧
    for (let i = 0; i < k; i += 1) {
      const idx = Math.round((i * (segs.length - 1)) / (k - 1));
      pts.add(Math.max(0, Math.round(segs[idx].from)));
    }
  }
  if (lastSec > 3) pts.add(Math.max(0, Math.round(lastSec - 2)));
  return framesAtTimestamps(ff, videoPath, workDir, [...pts].sort((a, b) => a - b));
}

export async function extractKeyframes(input, { maxFrames = 16, scene = 0.06, everySec = 0, timestamps = null, gapSec = 0, keepMedia = false, page } = {}) {
  const id = await resolveId(input);
  const info = await videoInfo(id);
  const p = pickPage(info, page ?? id.page);
  const dirName = p.page > 1 ? `${info.bvid}_p${p.page}` : info.bvid;
  const workDir = join(OUTPUT_DIR, dirName, 'frames');
  await mkdir(workDir, { recursive: true });
  // 清理旧帧，避免场景检测误判"已有结果"而不重抽
  const stale = (await readdir(workDir)).filter((f) => /^kf_/i.test(f));
  await Promise.all(stale.map((f) => rm(join(workDir, f), { force: true }).catch(() => {})));
  const { path: videoPath, method } = await obtainVideo(info, workDir, p.page);
  const ff = await ffmpegExe();
  if (!ff) throw new Error('未找到 ffmpeg.exe（应在 tools/ffmpeg 下）');

  let frames = [];
  let strategy = '';
  if (Array.isArray(timestamps) && timestamps.length) {
    const list = timestamps.map((t) => Number(t)).filter((t) => Number.isFinite(t) && t >= 0).slice(0, 60);
    frames = await framesAtTimestamps(ff, videoPath, workDir, list);
    strategy = `按时间戳精抽（目标 ${list.length} 个，成功 ${frames.length}）`;
  } else if (everySec > 0) {
    const outT = join(workDir, 'kf_%03d.png');
    const r = await run(ff, ['-y', '-i', videoPath, '-vf', `fps=1/${everySec},showinfo`, '-fps_mode', 'vfr', '-frames:v', String(maxFrames), outT], { timeout: 900000 });
    const files = (await readdir(workDir)).filter((f) => /^kf_\d+\.png$/i.test(f)).sort();
    if (files.length === 0) throw new Error(`抽帧失败（0 帧）：${r.stderr.slice(-400)}`);
    const times = [...r.stderr.matchAll(/pts_time:\s*([0-9.]+)/g)].map((m) => parseFloat(m[1]));
    frames = files.map((f, i) => {
      const tSec = times[i] ?? i * everySec;
      return { index: i + 1, time: fmtTs(tSec), timeSec: Math.round(tSec * 10) / 10, file: join(workDir, f) };
    });
    strategy = `等间隔（每 ${everySec} 秒 1 帧，${frames.length} 张）`;
  } else {
    const ad = await adaptiveFrames(ff, videoPath, workDir, { maxFrames, gapSec });
    frames = ad.frames;
    strategy = `自适应去重（采样间隔 ${ad.gapSec}s，候选 ${ad.rawCount}，保留 ${frames.length} 张）`;
    if (frames.length < 3) throw new Error(`自适应抽帧失败（仅 ${frames.length} 帧）`);
  }
  if (frames.length === 0) throw new Error('抽帧失败（0 帧）');
  if (!keepMedia) {
    await rm(videoPath, { force: true }).catch(() => {});
    await rm(join(workDir, '_scene'), { recursive: true, force: true }).catch(() => {});
  }
  return {
    bvid: info.bvid, page: p.page, part: p.part, title: info.title, url: info.url, duration: info.duration,
    videoMethod: method, framesExtracted: frames.length, strategy, frames, workDir,
  };
}

// ---------- 宿主诊断 ----------
export async function hostDiag() {
  const info = {
    when: new Date().toISOString(),
    node: process.version,
    pid: process.pid,
    temp: process.env.TEMP || null,
    ytdlp: await ytdlpVersion(),
    ffmpeg: await ffmpegExe(),
    whisperCli: await whisperCliExe(),
    model: (await whisperModel())?.path || null,
  };
  try {
    const p = join(YTDLP_TMP, 'host-diag.json');
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(info, null, 2), 'utf8');
  } catch { /* 诊断文件写失败不影响返回 */ }
  return info;
}

// ---------- 一键编排 analyze ----------

// 课程类默认 prompt：用领域词表偏置 whisper，降低数学术语同音字错误
export const LECTURE_PROMPT = '以下是大学课程课堂录音的转录。请优先使用正确的学科术语，例如：极限、趋近、去心邻域、邻域、数列、子列、收敛、发散、无穷小、无穷大、导数、微分、积分、连续、间断点、偏导数、级数、行列式、矩阵、概率、方差、期望等。数字和符号按标准写法。';

// 一次下载同时产出 wav 音频与 ≤480p 视频，供转录与抽帧共用，避免重复下载
export async function obtainMedia(info, workDir, page = 1) {
  const ver = await ytdlpVersion();
  if (ver) {
    const ff = await ffmpegExe();
    const outT = join(workDir, 'merged.%(ext)s');
    const mediaUrl = page > 1 ? `${info.url}?p=${page}` : info.url;
    const args = ['-f', 'bv*[height<=480]+ba/b[height<=480]/b', '-o', outT];
    if (ff) args.push('--ffmpeg-location', dirname(ff));
    if (page > 1) args.push('--playlist-items', String(page));
    args.push(mediaUrl);
    const r = await ytdlpFetch(args, 900000);
    if (r.ok) {
      const files = await readdir(workDir);
      const merged = files.find((f) => /^merged\./.test(f) && !/\.part$/i.test(f));
      if (merged) {
        const mp4 = join(workDir, merged);
        const wav = await toWav(mp4, workDir);
        return { videoPath: mp4, wavPath: wav, audioPath: mp4, method: 'yt-dlp' };
      }
    }
  }
  const pu = await getPlayUrl(info.bvid, { videoQn: 64, page });
  let audioPath = null;
  let videoPath = null;
  if (pu.audio) { audioPath = join(workDir, 'audio.m4a'); await downloadToFile(pu.audio.url, audioPath, { referer: info.url }); }
  if (pu.video) { videoPath = join(workDir, 'video.mp4'); await downloadToFile(pu.video.url, videoPath, { referer: info.url }); }
  else if (pu.durl?.length) { videoPath = join(workDir, 'video.mp4'); await downloadToFile(pu.durl[0].url, videoPath, { referer: info.url }); audioPath = videoPath; }
  if (!audioPath && !videoPath) throw new Error('无法获取媒体流：yt-dlp 与 playurl 直连均失败');
  if (!audioPath) audioPath = videoPath;
  const wavPath = await toWav(audioPath, workDir);
  return { videoPath, wavPath, audioPath, method: 'playurl-direct' };
}

// 时长解析："H:MM:SS" / "M:SS" / 秒数 → 秒
export function durToSec(s) {
  const p = String(s || '').split(':').map(Number);
  if (p.length === 3) return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0);
  if (p.length === 2) return (p[0] || 0) * 60 + (p[1] || 0);
  return Number(s) || 0;
}

// 当前分 P 的时长（秒）：优先 pages[].duration，回退整片 duration
export function pageDurationSec(info, page) {
  const p = pickPage(info, page);
  return durToSec(p?.duration || info.duration);
}

// 双进程启用决策（纯函数，可单测）：envVal=环境变量原值，optDual=显式参数（true/false/undefined），durSec=分P时长秒，model=转录模型
// 优先级：optDual 显式 > env 强制(1/0) > 自动规则（≥6min，2026-10-03 由 480s 降为 360s——治 7:48 视频差12s吃不到双进程）
// Q3② 门控（medium A/B 报告 §四，2026-10-04）：medium/large 单进程峰值 ~2GB，双进程在 8GB 级机器必 OOM
// ——非 small/base 一律单进程，env/显式参数也不例外（防 C 期 OOM 事故复现）。
export function shouldUseDual(envVal, optDual, durSec, model = '') {
  const m = String(model || 'small');
  if (m !== 'small' && m !== 'base') return false;
  let useDual;
  if (envVal === '1') useDual = true;
  else if (envVal === '0') useDual = false;
  else useDual = Number(durSec) >= 360;
  if (optDual === true) useDual = true;
  if (optDual === false) useDual = false;
  return useDual;
}

// ---------- ⑥ 下载/转录并行（错峰版） ----------
// 实测：同一 IP 双流并发下载（音频流+视频流同时打B站CDN）时，音频流会被 CDN 饥饿掐断
//（掉速至 26KB/s 后 "bytes read, more expected" 重试耗尽）。因此改为错峰：
//   ① 音频单连接先下（5~15s）→ 立即转录；② 视频流在转录期间（CPU 忙、无网络请求）下载。
// 任何时刻只保持一条B站连接，下载耗时被转录时间掩盖。BILI_PARALLEL_DOWNLOAD=0 禁用（回退串行）。
export async function obtainAudioOnly(info, workDir, page = 1) {
  if (process.env.BILI_PARALLEL_DOWNLOAD === '0') return null;
  const ver = await ytdlpVersion();
  if (!ver) return null; // 无 yt-dlp（受限沙箱）→ 串行路径
  const ff = await ffmpegExe();
  const mediaUrl = page > 1 ? `${info.url}?p=${page}` : info.url;
  const outT = join(workDir, 'audiodl.%(ext)s');
  const args = ['-f', 'bestaudio/best', '-o', outT];
  if (ff) args.push('--ffmpeg-location', dirname(ff));
  if (page > 1) args.push('--playlist-items', String(page));
  args.push(mediaUrl);
  const r = await ytdlpFetch(args, 600000);
  if (!r.ok) return null;
  const files = await readdir(workDir);
  const f = files.find((x) => x.startsWith('audiodl.') && !/\.part$/i.test(x));
  return f ? { path: join(workDir, f), method: 'yt-dlp-parallel' } : null;
}

// 视频流单独下载（转录期间后台跑；失败返回 null → 跳过抽帧分支）
export async function downloadVideoOnly(info, workDir, page = 1) {
  const ver = await ytdlpVersion();
  if (!ver) return null;
  const ff = await ffmpegExe();
  const mediaUrl = page > 1 ? `${info.url}?p=${page}` : info.url;
  const outT = join(workDir, 'videodl.%(ext)s');
  const args = ['-f', 'bestvideo[height<=480]/b[height<=480]/bestvideo/b', '-o', outT];
  if (ff) args.push('--ffmpeg-location', dirname(ff));
  if (page > 1) args.push('--playlist-items', String(page));
  args.push(mediaUrl);
  const r = await ytdlpFetch(args, 900000);
  if (!r.ok) return null;
  const files = await readdir(workDir);
  const f = files.find((x) => x.startsWith('videodl.') && !/\.part$/i.test(x));
  return f ? join(workDir, f) : null;
}

// ---------- ⑧ 长视频后台化 ----------
// 超过阈值（默认 30 分钟）的视频 analyze 不在工具调用内同步跑（防超时中断），
// 改为 detached 后台进程执行 scripts/analyze.mjs，立即返回 pid/日志/bundle 路径。
export const LONG_VIDEO_BG_SEC = Number(process.env.BILI_LONG_VIDEO_BG_SEC || 1800);

export async function analyzeBg(input, opts = {}) {
  const id = await resolveId(input);
  const info = await videoInfo(id);
  const p = pickPage(info, opts.page ?? id.page);
  const dirName = p.page > 1 ? `${info.bvid}_p${p.page}` : info.bvid;
  const workDir = join(OUTPUT_DIR, dirName);
  await mkdir(workDir, { recursive: true });
  const args = [join(__dirname, 'scripts', 'analyze.mjs'), String(input)];
  if (opts.type) args.push('--type', String(opts.type));
  if (opts.route) args.push('--route', String(opts.route));
  if (opts.page) args.push('--page', String(opts.page));
  if (opts.maxFrames) args.push('--frames', String(opts.maxFrames));
  if (opts.model) args.push('--model', String(opts.model));
  if (opts.vad === false) args.push('--no-vad');
  const logPath = join(workDir, 'analyze-bg.log');
  const statusPath = join(workDir, 'analyze-bg.json');
  const fh = await open(logPath, 'w');
  let child;
  try {
    // BILI_BG_STATUS：子进程完成后把终态（completed/failed+时间戳）回写此文件——analyze-status 据此判定终态
    child = spawn(process.execPath, args, { cwd: __dirname, detached: true, stdio: ['ignore', fh.fd, fh.fd], windowsHide: true, env: { ...process.env, BILI_BG_STATUS: statusPath } });
  } catch (e) {
    await fh.close();
    throw new Error(`后台任务启动失败：${e.message}`);
  }
  child.unref();
  await fh.close();
  const st = {
    pid: child.pid, input: String(input), opts: { type: opts.type, route: opts.route, page: opts.page, maxFrames: opts.maxFrames, model: opts.model, vad: opts.vad },
    startedAt: new Date().toISOString(), durationSec: pageDurationSec(info, p.page),
    log: logPath, status: statusPath, bundle: join(workDir, 'bundle.json'), workDir,
  };
  await writeFile(statusPath, JSON.stringify(st, null, 2), 'utf8');
  return { background: true, ...st, dirName };
}

// 统一入口：bg=false 强制同步；bg=true 强制后台；默认按时长自动（>30min → 后台）
export async function analyzeOrBackground(input, opts = {}) {
  if (opts.bg === false) return analyze(input, opts);
  const id = await resolveId(input);
  const info = await videoInfo(id);
  const p = pickPage(info, opts.page ?? id.page);
  const dur = pageDurationSec(info, p.page);
  if (opts.bg === true || dur > LONG_VIDEO_BG_SEC) {
    const bg = await analyzeBg(input, { ...opts, page: opts.page ?? p.page });
    const why = opts.bg === true ? '后台分析任务' : `长视频（${Math.round(dur / 60)} 分钟）已转后台分析`;
    return { ...bg, durationSec: dur, note: `${why}；稍后用 node scripts/analyze-status.mjs ${info.bvid} 查进度，产物在 ${bg.workDir}` };
  }
  return analyze(input, opts);
}

// 从转录分段中挑"关键时刻"：关键词命中 + 长停顿后的段落开头（章节边界信号）
export function findKeyMoments(segs, { type = 'general' } = {}) {
  const lectureKw = /定义|定理|性质|推论|法则|公式|考点|注意|总结|也就是说|换句话说|我们看|我们发现|记住|条件|结论|例[：:一二三123]|练习/;
  const generalKw = /但是|所以|因此|关键|事实|数据|结果|表明|认为|表示|宣布|首次|突破|问题|原因|影响|首先|然后|最后|总结|其实/;
  const kw = type === 'lecture' ? lectureKw : generalKw;
  const moments = [];
  let lastEnd = 0;
  for (const s of segs) {
    const gap = s.from - lastEnd;
    lastEnd = Math.max(lastEnd, s.to);
    const hit = kw.test(s.text);
    const prev = moments[moments.length - 1];
    const far = !prev || s.from - prev.timeSec > 45;
    if (hit && far) {
      moments.push({ timeSec: Math.round(s.from), reason: '关键词', text: s.text.slice(0, 60) });
    } else if (gap > 3 && s.from > 10 && far) {
      moments.push({ timeSec: Math.round(s.from), reason: '段落间隔', text: s.text.slice(0, 60) });
    }
    if (moments.length >= 40) break;
  }
  return moments;
}

// ---------- content.json 机器草稿（v3.4.0，纯函数可单测） ----------
// 动机（session-ee6408ef 实证）：deep 推理模型会把「从零创作整份笔记」的规划全部塞进单轮
// 思考，打满输出 token 上限（32k）后被 our-free-model 插件判定为「中断」，注入
// 「禁止调用工具」恢复指令——成品只能以聊天文本泄出、文件零落盘。把素材级机械工作
// （候选要点/章节切分/弹幕候选）在服务器侧先做成草稿，agent 的任务从「创作」降级为
// 「校正+筛选+补全」，思考量大幅下降，工具调用得以在预算内发出。
// 纪律：_draft-content.json 是底稿不是成品；renderer 不读取；最终 content.json 仍由
// agent 全责撰写，输出标准（条数/硬保底/归因/静默校正）不变。
export function buildDraftContent(segs = [], keyMoments = [], danmakuSignals = null) {
  const lineAt = (sec) => {
    let best = null;
    for (const s of segs) if (s.from <= sec + 2 && (!best || s.from > best.from)) best = s;
    return (best || {}).text || (segs[0] || {}).text || '';
  };
  const highlights = keyMoments.slice(0, 20).map((m) => ({
    emoji: '•',
    title: String(m.text || '').slice(0, 18),
    ts: fmtTs(m.timeSec),
    quote: String(lineAt(m.timeSec) || m.text || '').slice(0, 60),
  }));
  // 章节草稿：关键时刻锚点切段（无锚点则 ~90s 均分）；text 留占位提示由 agent 改写
  const dur = segs.length ? Number(segs[segs.length - 1].to) || 0 : 0;
  const anchors = keyMoments.map((m) => Number(m.timeSec) || 0);
  const cuts = anchors.length ? anchors : (dur ? Array.from({ length: Math.max(1, Math.ceil(dur / 90)) }, (_, i) => Math.round(i * dur / Math.max(1, Math.ceil(dur / 90)))) : []);
  const chapters = cuts.map((start, i) => {
    const end = i + 1 < cuts.length ? cuts[i + 1] : dur;
    return {
      range: `${fmtTs(start)}–${fmtTs(end)}`,
      title: String(lineAt(start) || '').slice(0, 20) || `第${i + 1}段`,
      text: '（草稿占位：请按 brief.md 改写为 80–150 字本段总结）',
    };
  });
  const dm = [
    ...((danmakuSignals?.comprehension) || []).slice(0, 10),
    ...((danmakuSignals?.sample) || []).slice(0, 10),
  ].map((d) => ({ cat: '', ts: fmtTs(d.t), text: String(d.text || '') }));
  return {
    _note: '机器草稿（analyze 生成；renderer 不读取）。agent 任务：以此为底校正同音字、筛选合并、补全 qa/terms/attribution 等字段后写 content.json。「」引文必须逐条对 brief.md 转录校正后才可入稿——草稿原话含 ASR 错字，照抄=违规。草稿候选可超量；成稿条数按 Q4 时长档区间收口。',
    highlights, chapters, dm,
  };
}

// 一键编排：媒体下载 → 转录 → 转录驱动抽帧 → 弹幕信号 → bundle.json
// route: 'balanced'（默认，自适应全片比对抽帧）| 'fast'（转录驱动定点快取，帧上限 12，快 40~55%）
export async function analyze(input, { type = 'general', page, lang = 'zh', model = '', prompt = '', maxFrames = 20, keepMedia = false, route = 'balanced', vad, dual } = {}) {
  const id = await resolveId(input);
  const info = await videoInfo(id);
  const p = pickPage(info, page ?? id.page);
  const dirName = p.page > 1 ? `${info.bvid}_p${p.page}` : info.bvid;
  const workDir = join(OUTPUT_DIR, dirName);
  await mkdir(workDir, { recursive: true });
  const t0 = Date.now();
  const routeMode = route === 'fast' ? 'fast' : 'balanced';
  const effMaxFrames = routeMode === 'fast' ? Math.min(Number(maxFrames) || 12, 12) : maxFrames;

  // ⑥ 下载/转录并行（错峰）：音频单连接先下→立即转录；视频流在转录期间下载。失败回退串行。
  let media = null;
  let videoP = null;
  const parAudio = await obtainAudioOnly(info, workDir, p.page);
  if (parAudio) {
    media = { audioPath: parAudio.path, wavPath: null, videoPath: null, method: parAudio.method };
    videoP = downloadVideoOnly(info, workDir, p.page); // 网络活儿在转录期间跑，不阻塞
    videoP.catch(() => {}); // 防未处理拒绝（后续 await 会取结果）
    media.wavPath = await toWav(parAudio.path, workDir);
  } else {
    media = await obtainMedia(info, workDir, p.page);
  }
  // ⑦ 双进程分块并行：质量门槛 A/B 全过（2026-10-03，接缝零损伤/漂移0.03s/提速39%）→ 集成默认路径。
  // 自动规则：视频 ≥8min 且能找到静音切点（找不到时 runWhisperDual 内部自动回退单进程）。
  // 开关：BILI_WHISPER_DUAL=0 关闭 / =1 强制（含硬切）；route 参数 dual:true/false 显式控制
  const useDual = shouldUseDual(process.env.BILI_WHISPER_DUAL, dual, pageDurationSec(info, p.page), model);
  const wOpts = {
    lang, modelName: model, threads: whisperThreads(), vad,
    prompt: prompt || (type === 'lecture' ? LECTURE_PROMPT : ''),
  };
  const w = useDual
    ? await runWhisperDual(media.wavPath, workDir, wOpts)
    : await runWhisper(media.wavPath, workDir, wOpts);
  const raw = JSON.parse(await readFile(w.jsonPath, 'utf8'));
  // 源级繁→简静默校正（Q3② medium 接入配套）：medium/large 常输出繁体，转 brief/transcript 前统一转简
  const segs = parseWhisperSegments(raw).map((s) => ({ ...s, text: toSimplified(s.text) }));
  const txt = segs.map((s) => `[${fmtTs(s.from)}] ${s.text}`).join('\n');
  await writeFile(join(workDir, 'transcript.txt'), txt, 'utf8');

  // 转录期间视频流应已下载完成；此处收拢（下载失败 = null → 跳过抽帧分支）
  if (videoP && !media.videoPath) media.videoPath = await videoP;

  const moments = findKeyMoments(segs, { type });

  let frames = [];
  let frameStrategy = '';
  if (media.videoPath && existsSync(media.videoPath)) {
    const ff = await ffmpegExe();
    if (routeMode === 'fast') {
      frames = await quickFrames(ff, media.videoPath, workDir, segs, { maxFrames: effMaxFrames });
      frameStrategy = `quick定点快取(转录驱动, ${frames.length}帧)`;
    } else {
      const ad = await adaptiveFrames(ff, media.videoPath, workDir, { maxFrames: effMaxFrames });
      frames = ad.frames;
      frameStrategy = `adaptive(间隔${ad.gapSec}s, 候选${ad.rawCount}, 保留${frames.length})`;
      const covered = (t) => frames.some((f) => Math.abs(f.timeSec - t) <= 25);
      const missing = moments.filter((m) => !covered(m.timeSec)).slice(0, 8);
      if (missing.length && ff) {
        const extra = await framesAtTimestamps(ff, media.videoPath, workDir, missing.map((m) => m.timeSec));
        frames = [...frames, ...extra].sort((a, b) => a.timeSec - b.timeSec).map((f, i) => ({ ...f, index: i + 1 }));
        frameStrategy += ` +时刻补抽${extra.length}`;
      }
    }
  }

  // 每个关键时刻配最近帧（≤40s 内），供渲染层决定是否配图
  const paired = moments.map((m) => {
    let best = null;
    let bestD = Infinity;
    for (const f of frames) {
      const d = Math.abs(f.timeSec - m.timeSec);
      if (d < bestD) { bestD = d; best = f; }
    }
    return {
      ...m,
      nearestFrame: best && bestD <= 40
        ? { time: best.time, timeSec: best.timeSec, file: best.file, deltaSec: Math.round(bestD * 10) / 10 }
        : null,
    };
  });

  let danmakuSignals = null;
  try {
    const d1 = await getDanmaku(id, { limit: 120, page: p.page });
    const d2 = await getDanmaku(id, { keyword: '懂', limit: 40, page: p.page });
    danmakuSignals = {
      poolSize: d1.poolSize,
      sample: d1.danmaku.slice(0, 20).map((d) => ({ t: d.t, text: d.text })),
      comprehension: d2.danmaku.slice(0, 30).map((d) => ({ t: d.t, text: d.text })),
    };
  } catch { /* 弹幕失败不阻塞主流程 */ }

  const bundle = {
    generatedAt: new Date().toISOString(),
    type,
    video: {
      bvid: info.bvid, page: p.page, part: p.part, title: info.title, url: info.url,
      duration: info.duration, owner: info.owner?.name, pubdate: info.pubdate, stat: info.stat,
    },
    pipeline: {
      audioMethod: media.method, model: w.model, lang, threads: whisperThreads(),
      route: routeMode, vad: !!w.vad, whisperElapsedSec: w.whisperElapsedSec,
      dual: w.dual || null,
      // 质量路线防呆（审计 2026-10-04）：请求的模型文件缺失而回退时显式记录，防质量档静默降级
      ...(w.model && w.model !== String(model || 'small')
        ? { modelFallback: `requested ${model || 'small'} -> actual ${w.model}（模型文件缺失已回退；下载 ggml-${model}.bin 至数据根 tools/models/ 可启用）` }
        : {}),
      elapsedSec: Math.round((Date.now() - t0) / 1000), frameStrategy,
      whisperStderrTail: w.stderrTail || '',
    },
    transcript: { segments: segs.length, file: join(workDir, 'transcript.txt'), json: w.jsonPath },
    keyMoments: paired,
    frames,
    danmakuSignals,
  };
  await writeFile(join(workDir, 'bundle.json'), JSON.stringify(bundle, null, 2), 'utf8');

  // brief.md 一页简报（Q10①）：给 agent 读稿用的合一文件——元信息+分析参数+关键时刻+弹幕信号+完整转录
  const dms = bundle.danmakuSignals || {};
  const brief = [
    `# brief: ${info.title}（${info.bvid}${p.page > 1 ? ' P' + p.page : ''}）`,
    '',
    `- UP主：${info.owner?.name || '—'}｜时长：${info.duration}｜发布：${String(info.pubdate || '').slice(0, 10)}`,
    `- 播放·点赞·弹幕：${info.stat?.view ?? '—'}·${info.stat?.like ?? '—'}·${info.stat?.danmaku ?? '—'}｜评论：${info.stat?.reply ?? '—'}`,
    `- 分析：type=${type} route=${routeMode} 模型=${w.model} vad=${!!w.vad}${w.dual ? ' dual=' + JSON.stringify(w.dual) : ''} 转录${w.whisperElapsedSec}s ${segs.length}段`,
    '',
    `## 关键时刻`,
    ...(paired.length ? paired.map((m) => `- [${fmtTs(m.timeSec)}] ${m.reason}：${m.text}${m.nearestFrame ? `（帧 ${m.nearestFrame.time}）` : ''}`) : ['- 无']),
    '',
    `## 弹幕信号`,
    `池：${dms.poolSize ?? 0} 条`,
    ...(dms.comprehension?.length ? ['- 理解信号（懂类高频）：', ...dms.comprehension.slice(0, 15).map((d) => `  - [${fmtTs(d.t)}] ${d.text}`)] : []),
    ...(dms.sample?.length ? ['- 开场采样：', ...dms.sample.slice(0, 15).map((d) => `  - [${fmtTs(d.t)}] ${d.text}`)] : []),
    '',
    `## 转录（${segs.length} 段）`,
    txt || '- 无',
    '',
  ].join('\n');
  await writeFile(join(workDir, 'brief.md'), brief, 'utf8');

  // 机器草稿（v3.4.0）：素材级底稿，降低 agent 从零创作的思考量；失败不影响主流程
  try {
    await writeFile(join(workDir, '_draft-content.json'), JSON.stringify(buildDraftContent(segs, paired, bundle.danmakuSignals), null, 2), 'utf8');
  } catch { /* 草稿生成失败不阻塞 */ }

  if (!keepMedia) {
    await rm(media.wavPath, { force: true }).catch(() => {});
    if (media.audioPath && media.audioPath !== media.videoPath) await rm(media.audioPath, { force: true }).catch(() => {});
    if (media.videoPath) await rm(media.videoPath, { force: true }).catch(() => {});
    await rm(join(workDir, '_scene'), { recursive: true, force: true }).catch(() => {});
  }

  return {
    bvid: info.bvid, page: p.page, part: p.part, title: info.title, duration: info.duration, type, route: routeMode,
    segments: segs.length, keyMoments: paired.length, frames: frames.length, frameStrategy,
    vad: !!w.vad, whisperElapsedSec: w.whisperElapsedSec,
    elapsedSec: Math.round((Date.now() - t0) / 1000),
    topMoments: paired.slice(0, 12).map((m) => ({ t: fmtTs(m.timeSec), reason: m.reason, text: m.text, frame: m.nearestFrame?.time || null })),
    files: { bundle: join(workDir, 'bundle.json'), transcriptTxt: join(workDir, 'transcript.txt'), brief: join(workDir, 'brief.md'), draft: join(workDir, '_draft-content.json'), workDir },
  };
}
