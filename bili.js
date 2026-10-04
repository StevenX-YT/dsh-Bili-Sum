// bili.js — B 站数据访问层（零依赖，Node >= 18）
// 提供：视频元数据 / 弹幕 / 字幕 / 评论 / yt-dlp 集成
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIN_DIR, YTDLP_TMP, cookieFileCandidates } from './paths.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
// 路径解耦（插件化）：yt-dlp / 临时目录 / cookie 均经 BILI_DATA_ROOT 解析（缺省=包目录向后兼容）
export const YTDLP = join(BIN_DIR, 'yt-dlp.exe');

// PyInstaller 打包的 yt-dlp 需要可写的临时目录；沙箱里系统 TEMP 可能不可用，
// 统一重定向到数据根 bin/tmp（恒可写）。
async function ytdlpEnv() {
  await mkdir(YTDLP_TMP, { recursive: true });
  return { ...process.env, TEMP: YTDLP_TMP, TMP: YTDLP_TMP, TMPDIR: YTDLP_TMP };
}

const MODE_NAMES = { 1: '滚动', 4: '底部', 5: '顶部', 6: '逆向', 7: '特殊', 8: '代码', 9: '基准' };

let cookieCache; // undefined=未加载, null=无, string=Cookie 头
let buvidCache;

export async function getCookie() {
  if (cookieCache !== undefined) return cookieCache;
  let raw = (process.env.BILI_COOKIE || process.env.BILI_SESSDATA || '').trim();
  if (!raw) {
    // cookie 候选：数据根优先、包目录回退（老布局兼容）
    for (const p of cookieFileCandidates()) {
      try { raw = (await readFile(p, 'utf8')).trim(); if (raw) break; } catch { /* 无此文件，试下一个 */ }
    }
  }
  if (!raw) { cookieCache = null; return null; }
  if (!raw.includes('=')) raw = `SESSDATA=${raw}`; // 允许文件里只存 SESSDATA 值
  cookieCache = raw;
  return cookieCache;
}

export async function getBuvid() {
  if (buvidCache !== undefined) return buvidCache;
  try {
    const r = await fetch('https://api.bilibili.com/x/frontend/finger/spi', {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json();
    if (j?.code === 0 && j.data?.b_3) {
      buvidCache = `buvid3=${j.data.b_3}; buvid4=${j.data.b_4 || ''}`;
      return buvidCache;
    }
  } catch { /* 忽略 */ }
  buvidCache = '';
  return '';
}

async function apiGet(url, { cookie = false, referer } = {}) {
  const headers = { 'User-Agent': UA, 'Accept': 'application/json, text/plain, */*' };
  if (referer) headers['Referer'] = referer;
  if (cookie) {
    const parts = [];
    const c = await getCookie();
    if (c) parts.push(c);
    const b = await getBuvid();
    if (b) parts.push(b);
    if (parts.length) headers['Cookie'] = parts.join('; ');
  }
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000), redirect: 'follow' });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`B 站接口返回非 JSON（HTTP ${res.status}）`); }
  return json;
}

export function decodeEntities(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0*39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export function cleanBiliHtml(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<img[^>]*?title="([^"]*)"[^>]*?>/g, '[$1]')
      .replace(/<[^>]+>/g, '')
  ).replace(/\s+/g, ' ').trim();
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return (h > 0 ? `${h}:` : '') + `${mm}:${String(s).padStart(2, '0')}`;
}

export function fmtTs(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export async function resolveId(input) {
  if (input && typeof input === 'object' && (input.bvid || input.aid)) return input;
  let s = String(input ?? '').trim();
  if (!s) throw new Error('请输入 BV 号、av 号或视频链接');
  if (/b23\.tv\//i.test(s)) {
    if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
    try {
      const r = await fetch(s, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': UA } });
      s = r.url;
    } catch (e) { throw new Error(`解析 b23.tv 短链失败：${e.message}`); }
  }
  const bv = s.match(/BV[0-9A-Za-z]{10}/);
  if (bv) {
    const out = { bvid: bv[0], aid: null };
    const pm = s.match(/[?&]p=(\d+)/);
    if (pm) out.page = Number(pm[1]); // 链接里的 ?p=N（分 P）
    return out;
  }
  const av = s.match(/\bav(\d+)\b/i);
  if (av) {
    const out = { bvid: null, aid: Number(av[1]) };
    const pm = s.match(/[?&]p=(\d+)/);
    if (pm) out.page = Number(pm[1]);
    return out;
  }
  throw new Error(`无法从输入解析出 BV/av 号：${String(input).slice(0, 80)}`);
}

const viewQuery = (id) => (id.bvid ? `bvid=${id.bvid}` : `aid=${id.aid}`);

// videoInfo 结果缓存（5 分钟 TTL）：analyze 等编排场景一次流程内多次取同一视频信息时避免重复请求
const infoCache = new Map();
const INFO_TTL_MS = 5 * 60 * 1000;

export async function videoInfo(input) {
  const id = await resolveId(input);
  const key = id.bvid || `av${id.aid}`;
  const hit = infoCache.get(key);
  if (hit && Date.now() - hit.at < INFO_TTL_MS) return hit.info;
  const j = await apiGet(`https://api.bilibili.com/x/web-interface/view?${viewQuery(id)}`);
  if (j.code !== 0) throw new Error(`B 站接口错误 code=${j.code}: ${j.message || ''}`);
  const d = j.data;
  const stat = d.stat || {};
  const out = {
    bvid: d.bvid,
    aid: d.aid,
    cid: d.cid,
    title: d.title,
    desc: (d.desc || '').slice(0, 2000),
    owner: { mid: d.owner?.mid, name: d.owner?.name, face: d.owner?.face },
    stat: {
      view: stat.view, danmaku: stat.danmaku, reply: stat.reply,
      favorite: stat.favorite, coin: stat.coin, share: stat.share, like: stat.like,
    },
    duration: fmtDuration(d.duration),
    pubdate: d.pubdate ? new Date(d.pubdate * 1000).toISOString() : null,
    cover: d.pic,
    tname: d.tname_v2 || d.tname,
    pages: (d.pages || []).map((p) => ({
      page: p.page, part: p.part, cid: p.cid, duration: fmtDuration(p.duration),
    })),
    subtitles: (d.subtitle?.list || []).map((s) => ({
      lang: s.lan, name: s.lan_doc, locked: !!s.is_lock, ai: (s.ai_type || 0) > 0,
    })),
    url: `https://www.bilibili.com/video/${d.bvid}`,
  };
  infoCache.set(key, { at: Date.now(), info: out });
  return out;
}

export function parseDanmakuXml(xml) {
  const out = [];
  const re = /<d p="([^"]*)">([\s\S]*?)<\/d>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const p = m[1].split(',');
    const mode = parseInt(p[1], 10) || 1;
    const colorNum = parseInt(p[3], 10);
    const color = Number.isFinite(colorNum) ? colorNum : 16777215;
    out.push({
      time: parseFloat(p[0]) || 0,
      mode,
      modeName: MODE_NAMES[mode] || '其他',
      color: '#' + (color >>> 0).toString(16).padStart(6, '0'),
      timestamp: parseInt(p[4], 10) || 0,
      weight: parseInt(p[8], 10) || 0,
      text: decodeEntities(m[2]),
    });
  }
  return out;
}

export async function getDanmaku(input, { keyword = '', limit = 200, page } = {}) {
  const id = await resolveId(input);
  const info = await videoInfo(id);
  const pages = info.pages?.length ? info.pages : [{ page: 1, part: info.title, cid: info.cid }];
  const idx = Math.min(Math.max(1, Number(page ?? id.page) || 1), pages.length) - 1;
  const p = pages[idx];
  const res = await fetch(`https://api.bilibili.com/x/v1/dm/list.so?oid=${p.cid}`, {
    headers: { 'User-Agent': UA, 'Referer': `https://www.bilibili.com/video/${info.bvid}` },
    signal: AbortSignal.timeout(20000),
  });
  const xml = await res.text();
  const pool = parseDanmakuXml(xml);
  let list = pool;
  if (keyword) list = list.filter((d) => d.text.includes(keyword));
  list.sort((a, b) => a.time - b.time);
  const matched = list.length;
  const lim = Math.min(Math.max(1, Number(limit) || 200), 1000);
  list = list.slice(0, lim);
  const result = {
    bvid: info.bvid, title: info.title, cid: p.cid, page: p.page, part: p.part,
    keyword: keyword || null,
    poolSize: pool.length, matched, returned: list.length,
    danmaku: list.map((d) => ({ t: fmtTs(d.time), time: d.time, text: d.text, mode: d.modeName, weight: d.weight })),
  };
  if (pool.length >= 1000) result.note = '弹幕接口单次最多返回约 1000 条（热门池），并非全量弹幕。';
  return result;
}

// ---------- 字幕 ----------

function formatBiliSubtitleBody(body, maxLines) {
  const lines = (body || []).map(
    (b) => `[${fmtTs(b.from)}] ${String(b.content || '').replace(/\s+/g, ' ').trim()}`
  );
  const total = lines.length;
  const out = lines.slice(0, maxLines);
  return { total, lines: out, truncated: total > out.length };
}

function parseVttToLines(vtt, maxLines) {
  const lines = [];
  const blocks = String(vtt).replace(/\r/g, '').split(/\n\n+/);
  for (const block of blocks) {
    const rows = block
      .split('\n')
      .filter((r) => r.trim() && !/^WEBVTT/i.test(r) && !/^NOTE/.test(r) && !/^\d+$/.test(r.trim()));
    const tsIdx = rows.findIndex((r) => r.includes('-->'));
    if (tsIdx === -1) continue;
    const start = rows[tsIdx].split('-->')[0].trim();
    const text = rows
      .slice(tsIdx + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) lines.push(`[${start.split('.')[0]}] ${text}`);
  }
  const total = lines.length;
  const out = lines.slice(0, maxLines);
  return { total, lines: out, truncated: total > out.length };
}

async function ytdlpSubtitles(bvid, lang, maxLines) {
  const tmp = await mkdtemp(join(tmpdir(), 'bili-mcp-'));
  try {
    const args = [
      '--skip-download', '--no-warnings',
      '--write-subs', '--write-auto-subs',
      '--sub-langs', lang || 'all,-live',
      '--sub-format', 'json3/vtt/best',
      '-o', join(tmp, '%(id)s.%(ext)s'),
      `https://www.bilibili.com/video/${bvid}`,
    ];
    const cookie = await getCookie();
    if (cookie) args.push('--add-header', `Cookie: ${cookie}`);
    await execFileAsync(YTDLP, args, {
      timeout: 150000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: await ytdlpEnv(),
    });
    const files = (await readdir(tmp)).filter((f) => /\.(json3|vtt|srt)$/i.test(f));
    if (!files.length) return null;
    const file =
      files.find((f) => (lang ? f.toLowerCase().includes(String(lang).toLowerCase()) : true)) || files[0];
    const content = await readFile(join(tmp, file), 'utf8');
    let parsed;
    if (/\.json3$/i.test(file)) {
      let j;
      try { j = JSON.parse(content); } catch { return null; }
      const lines = [];
      for (const ev of j.events || []) {
        const text = (ev.segs || []).map((s) => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
        if (text && ev.tStartMs != null) lines.push(`[${fmtTs(ev.tStartMs / 1000)}] ${text}`);
      }
      const total = lines.length;
      const out = lines.slice(0, maxLines);
      parsed = { total, lines: out, truncated: total > out.length };
    } else {
      parsed = parseVttToLines(content, maxLines);
    }
    return { file, ...parsed };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

export async function getSubtitles(input, { lang = '', download = false, maxLines = 500 } = {}) {
  const id = await resolveId(input);
  const cookie = await getCookie();
  const j = await apiGet(
    `https://api.bilibili.com/x/web-interface/view?${viewQuery(id)}`,
    cookie ? { cookie: true } : {}
  );
  if (j.code !== 0) throw new Error(`B 站接口错误 code=${j.code}: ${j.message || ''}`);
  const d = j.data;
  const subs = d.subtitle?.list || [];
  const result = {
    bvid: d.bvid, title: d.title, cid: d.cid,
    loggedIn: !!cookie,
    languages: subs.map((s) => ({
      lang: s.lan, name: s.lan_doc, locked: !!s.is_lock, ai: (s.ai_type || 0) > 0,
    })),
  };
  const target = subs.find((s) => (!lang || s.lan === lang || s.lan_doc === lang) && s.subtitle_url);
  if (target) {
    const url = target.subtitle_url.startsWith('//') ? 'https:' + target.subtitle_url : target.subtitle_url;
    const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    const body = await r.json();
    const fmt = formatBiliSubtitleBody(body.body, maxLines);
    return { ...result, source: 'bilibili-api', language: target.lan, languageName: target.lan_doc, ...fmt };
  }
  if (download || lang) {
    try {
      const yt = await ytdlpSubtitles(d.bvid, lang, maxLines);
      if (yt) {
        return {
          ...result, source: 'yt-dlp', language: lang || 'auto', file: yt.file,
          total: yt.total, truncated: yt.truncated, lines: yt.lines,
        };
      }
      result.ytdlp = 'yt-dlp 未找到可下载的字幕（该视频可能没有字幕，或需要登录 Cookie）。';
    } catch (e) {
      result.ytdlp = `yt-dlp 下载字幕失败：${e.message}`;
    }
  } else if (!subs.some((s) => s.subtitle_url)) {
    result.hint =
      '未登录时拿不到字幕正文。可选：1) 把 SESSDATA 写入 bili-cookie.txt（数据根或包目录）后重试；2) download=true 让 yt-dlp 尝试下载（含 AI 字幕）。';
  }
  return result;
}

// ---------- 评论 ----------

function parseReply(r) {
  return {
    user: r.member?.uname || '',
    uid: r.mid ?? r.member?.mid ?? null,
    like: r.like || 0,
    replyCount: r.rcount || 0,
    time: r.ctime ? new Date(r.ctime * 1000).toISOString() : null,
    message: cleanBiliHtml(r.content?.message),
    rpid: r.rpid,
  };
}

export async function getComments(input, { page = 1, mode = 'hot', keyword = '', limit = 20 } = {}) {
  const cookie = await getCookie();
  if (!cookie) {
    const err = new Error(
      '读取评论需要 B 站登录态：请把浏览器 Cookie 中的 SESSDATA 值写入 bili-cookie.txt（数据根或包目录均可，node scripts/doctor.mjs 可自检），或设置环境变量 BILI_SESSDATA，然后重启 Harness 让 MCP 服务器重新读取。'
    );
    err.needsCookie = true;
    throw err;
  }
  const id = await resolveId(input);
  const info = await videoInfo(id);
  const modeNum = { hot: 3, new: 1, like: 2 }[mode] ?? 3;
  const lim = Math.min(Math.max(1, Number(limit) || 20), 50);
  const url =
    `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${info.aid}` +
    `&mode=${modeNum}&pn=${Math.max(1, Number(page) || 1)}&ps=${lim}&web_location=1315875`;
  const j = await apiGet(url, { cookie: true, referer: `https://www.bilibili.com/video/${info.bvid}` });
  if (j.code !== 0) {
    if (j.code === -352) {
      throw new Error('评论接口被风控拦截（-352）。请确认 SESSDATA 未过期；如仍失败，可稍后重试或补充 buvid Cookie。');
    }
    throw new Error(`B 站评论接口错误 code=${j.code}: ${j.message || ''}`);
  }
  const replies = j.data?.replies || [];
  let list = replies.map(parseReply);
  const before = list.length;
  if (keyword) list = list.filter((c) => c.message.includes(keyword));
  const result = {
    bvid: info.bvid, title: info.title, mode, page: Number(page) || 1,
    keyword: keyword || null,
    fetched: before, matched: list.length,
    comments: list,
  };
  if (before < lim) result.note = '本页评论可能被折叠或需登录查看更多。';
  return result;
}

export async function ytdlpVersion() {
  try {
    const { stdout } = await execFileAsync(YTDLP, ['--version'], {
      timeout: 15000, windowsHide: true, env: await ytdlpEnv(),
    });
    return stdout.trim();
  } catch { return null; }
}
