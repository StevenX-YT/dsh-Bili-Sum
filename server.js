#!/usr/bin/env node
/**
 * bilibili-mcp — B 站数据 MCP 服务器（stdio，换行分隔 JSON-RPC 2.0）
 * 工具：video-info / danmaku / subtitles / comments / status
 * 零依赖；日志只写 stderr，stdout 仅输出 JSON-RPC 消息。
 */
import { createInterface } from 'node:readline';
import {
  videoInfo, getDanmaku, getSubtitles, getComments,
  ytdlpVersion, getCookie, YTDLP,
} from './bili.js';
import { transcribe, extractKeyframes, analyze, analyzeOrBackground, hostDiag } from './media.js';
import { PKG_ROOT, DATA_ROOT, OUTPUT_DIR, TOOLS_DIR } from './paths.js';

const SERVER_INFO = { name: 'bilibili', version: '3.1.0' };
const DEBUG = !!process.env.MCP_DEBUG;

function log(...args) {
  if (!DEBUG) return;
  process.stderr.write(
    '[bilibili-mcp] ' + args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n'
  );
}

const TOOLS = [
  {
    name: 'video-info',
    description:
      '获取 B 站视频元数据：标题、简介、UP主、播放/点赞等数据、分P列表、可用字幕语言。输入支持 BV 号、av 号、完整视频链接或 b23.tv 短链。',
    inputSchema: {
      type: 'object',
      properties: {
        bvid: { type: 'string', description: 'BV 号 / av 号 / 视频链接 / b23.tv 短链' },
      },
      required: ['bvid'],
      additionalProperties: false,
    },
    handler: async (a) => ({ text: JSON.stringify(await videoInfo(a.bvid), null, 2) }),
  },
  {
    name: 'danmaku',
    description:
      '获取 B 站视频弹幕（带时间轴），可按关键词过滤。返回弹幕文本、出现时间、类型与权重。单次最多约 1000 条（热门池）。',
    inputSchema: {
      type: 'object',
      properties: {
        bvid: { type: 'string', description: 'BV 号 / av 号 / 视频链接' },
        keyword: { type: 'string', description: '可选：只返回包含该关键词的弹幕' },
        limit: { type: 'number', description: '返回条数上限，默认 200，最大 1000' },
        page: { type: 'number', description: '多 P 视频的分 P 序号，默认 1' },
      },
      required: ['bvid'],
      additionalProperties: false,
    },
    handler: async (a) => ({ text: JSON.stringify(await getDanmaku(a.bvid, a), null, 2) }),
  },
  {
    name: 'subtitles',
    description:
      '获取 B 站视频字幕：先列出可用语言；提供 lang 或 download=true 时下载并返回字幕全文（时间轴+文本）。登录态（SESSDATA）可解锁更多字幕。',
    inputSchema: {
      type: 'object',
      properties: {
        bvid: { type: 'string', description: 'BV 号 / av 号 / 视频链接' },
        lang: { type: 'string', description: '字幕语言，如 zh-CN、en-US；省略时仅列出可用语言' },
        download: { type: 'boolean', description: '为 true 时用 yt-dlp 下载字幕（含 AI 字幕）' },
        maxLines: { type: 'number', description: '字幕文本最大返回行数，默认 500' },
      },
      required: ['bvid'],
      additionalProperties: false,
    },
    handler: async (a) => ({ text: JSON.stringify(await getSubtitles(a.bvid, a), null, 2) }),
  },
  {
    name: 'comments',
    description:
      '获取 B 站视频评论区（需要 B 站登录态 SESSDATA）。支持热评/最新/点赞排序、分页、关键词过滤。',
    inputSchema: {
      type: 'object',
      properties: {
        bvid: { type: 'string', description: 'BV 号 / av 号 / 视频链接' },
        page: { type: 'number', description: '页码，默认 1' },
        mode: { type: 'string', enum: ['hot', 'new', 'like'], description: '排序：hot 热评 / new 最新 / like 最多点赞' },
        keyword: { type: 'string', description: '可选：只返回包含该关键词的评论' },
        limit: { type: 'number', description: '每页条数，默认 20，最大 50' },
      },
      required: ['bvid'],
      additionalProperties: false,
    },
    handler: async (a) => ({ text: JSON.stringify(await getComments(a.bvid, a), null, 2) }),
  },
  {
    name: 'transcribe',
    description:
      '转录 B 站视频的语音内容：下载音频 → 16kHz wav → whisper.cpp 转录，返回带时间轴的文稿预览和全文文件路径。学习场景用法：先用本工具拿语音全文，再配合 keyframes 工具的画面做内容总结。长视频转录需要几分钟。',
    inputSchema: {
      type: 'object',
      properties: {
        bvid: { type: 'string', description: 'BV 号 / av 号 / 视频链接（链接可带 ?p=N 指定分 P）' },
        page: { type: 'number', description: '多 P 视频的分 P 序号；省略时取链接中的 ?p=N，默认 1' },
        lang: { type: 'string', description: '语音语言，默认 zh；其他语言传对应代码（en/ja 等）或 auto' },
        prompt: { type: 'string', description: 'whisper 领域词偏置（提准），如学科术语表；省略则不偏置' },
        threads: { type: 'number', description: 'whisper 线程数；省略自动按 CPU 分配' },
        model: { type: 'string', enum: ['small', 'base', 'medium'], description: '模型规格，默认 small（中文效果与速度平衡）；medium=质量路线默认（Q3②，慢~2.3×，自动禁双进程，繁→简源级内置）' },
        keepMedia: { type: 'boolean', description: '保留中间音频文件，默认 false（成功后删除）' },
      },
      required: ['bvid'],
      additionalProperties: false,
    },
    handler: async (a) => ({ text: JSON.stringify(await transcribe(a.bvid, a), null, 2) }),
  },
  {
    name: 'keyframes',
    description:
      '抽取 B 站视频关键帧画面（场景切换检测或等间隔），返回带时间戳的 PNG 文件路径列表。配合 read_image 工具逐帧查看画面（板书/PPT/代码演示），用于视觉内容分析。',
    inputSchema: {
      type: 'object',
      properties: {
        bvid: { type: 'string', description: 'BV 号 / av 号 / 视频链接（链接可带 ?p=N 指定分 P）' },
        page: { type: 'number', description: '多 P 视频的分 P 序号；省略时取链接中的 ?p=N，默认 1' },
        maxFrames: { type: 'number', description: '最多抽取帧数，默认 16，上限 60' },
        gapSec: { type: 'number', description: '自适应模式的采样间隔秒数；省略按时长自动（约取 300 候选）' },
        scene: { type: 'number', description: '保留参数（旧场景检测阈值）；默认模式已改为自适应去重抽帧' },
        timestamps: { type: 'array', items: { type: 'number' }, description: '提供后改为按时间戳精确抽帧（秒），跳过自适应；上限 60 个' },
        everySec: { type: 'number', description: '设置后改为等间隔抽帧（每 N 秒 1 帧）' },
        keepMedia: { type: 'boolean', description: '保留下载的视频文件，默认 false' },
      },
      required: ['bvid'],
      additionalProperties: false,
    },
    handler: async (a) => ({ text: JSON.stringify(await extractKeyframes(a.bvid, a), null, 2) }),
  },
  {
    name: 'analyze',
    description:
      '一键编排视频理解：单次下载媒体（音频+视频流并行下载，音频就绪即转录）→ whisper 转录（领域词偏置 + VAD 静音跳过 + 幻觉抑制）→ 转录驱动抽帧+关键时刻补抽 → 弹幕信号 → 生成 bundle.json。返回紧凑摘要，完整数据（带时间戳转录/关键时刻配帧/弹幕）在 bundle 文件中；渲染笔记前用 read_image 阅读关键帧。type=lecture 课程 / general 普通视频；route=balanced 默认 / fast 快速（定点快取抽帧）。超过 30 分钟的长视频自动转后台进程（返回 pid 与日志路径，稍后用 scripts/analyze-status.mjs 查进度），bg 参数可强制前台/后台。',
    inputSchema: {
      type: 'object',
      properties: {
        bvid: { type: 'string', description: 'BV 号 / av 号 / 视频链接（可带 ?p=N）' },
        type: { type: 'string', enum: ['lecture', 'general'], description: 'lecture=课程（学科词表偏置+课程关键词）；general=普通视频' },
        route: { type: 'string', enum: ['balanced', 'fast'], description: '总结路线：balanced=默认（全片比对抽帧）；fast=快速（转录驱动定点快取，帧上限12，总耗时约省30-40%）' },
        page: { type: 'number', description: '分 P 序号；省略取链接 ?p=N，默认 1' },
        lang: { type: 'string', description: '语音语言，默认 zh' },
        model: { type: 'string', enum: ['small', 'base', 'medium'], description: '转录模型，默认 small；medium=质量路线默认（Q3② 拍板：慢~2.3×，自动禁双进程防 OOM，繁→简源级内置）' },
        prompt: { type: 'string', description: '自定义 whisper 领域词偏置；省略时 lecture 用内置学科词表' },
        maxFrames: { type: 'number', description: 'smart 抽帧上限，默认 20' },
        vad: { type: 'boolean', description: 'VAD 静音检测（跳过静音/BGM 段，省时且消除幻觉），默认 true' },
        dual: { type: 'boolean', description: 'whisper 双进程分块并行转录（≥6分钟视频自动启用，需找到静音切点否则自动回退单进程；实测提速39%质量无损）：true=强制开启；false=关闭；省略=自动' },
        bg: { type: 'boolean', description: 'true=强制后台进程；false=强制前台同步；省略=按时长自动（>30min 后台）' },
        keepMedia: { type: 'boolean', description: '保留中间音视频文件，默认 false' },
      },
      required: ['bvid'],
      additionalProperties: false,
    },
    handler: async (a) => ({ text: JSON.stringify(await analyzeOrBackground(a.bvid, a), null, 2) }),
  },
  {
    name: 'status',
    description: '检查 B 站 MCP 服务器自身状态：yt-dlp/ffmpeg/whisper/模型可用性、登录 Cookie、数据根路径（安装自检）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const diag = await hostDiag();
      const cookie = await getCookie();
      return {
        text: JSON.stringify(
          {
            server: SERVER_INFO,
            ...diag,
            ytdlp: { available: !!diag.ytdlp, version: diag.ytdlp || null, path: YTDLP },
            pipeline: { ffmpeg: !!diag.ffmpeg, whisper: !!diag.whisperCli, model: diag.model },
            paths: { pkgRoot: PKG_ROOT, dataRoot: DATA_ROOT, outputDir: OUTPUT_DIR, toolsDir: TOOLS_DIR, isolatedDataRoot: DATA_ROOT !== PKG_ROOT },
            cookieConfigured: !!cookie,
            cookieSource: cookie ? (process.env.BILI_SESSDATA || process.env.BILI_COOKIE ? 'env' : 'file') : null,
          },
          null,
          2
        ),
      };
    },
  },
];

function send(obj) {
  try { process.stdout.write(JSON.stringify(obj) + '\n'); } catch { /* stdout 已关闭 */ }
}

async function dispatch(msg) {
  const { method, params } = msg;
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        serverInfo: SERVER_INFO,
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) };
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) {
        const e = new Error(`未知工具: ${params?.name}`);
        e.code = -32602;
        throw e;
      }
      const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      try {
        const out = await tool.handler(args);
        return { content: [{ type: 'text', text: out.text }], ...(out.isError ? { isError: true } : {}) };
      } catch (err) {
        log('tool error:', err);
        return { content: [{ type: 'text', text: String(err?.message || err) }], isError: true };
      }
    }
    case 'resources/list':
      hostDiag().catch(() => {}); // 顺带写宿主环境诊断文件（bin/tmp/host-diag.json）
      return { resources: [] };
    case 'resources/templates/list':
      return { resourceTemplates: [] };
    case 'prompts/list':
      return { prompts: [] };
    default: {
      const e = new Error(`方法不存在: ${method}`);
      e.code = -32601;
      throw e;
    }
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
let pending = 0;
let stdinClosed = false;
function maybeExit() { if (stdinClosed && pending === 0) process.exit(0); }

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch { log('bad json:', trimmed.slice(0, 120)); return; }
  if (!msg || typeof msg !== 'object') return;
  if (msg.method && msg.method.startsWith('notifications/')) { log('notification:', msg.method); return; }
  if (msg.id === undefined || msg.id === null) { log('id-less request ignored:', msg.method); return; }
  pending++;
  Promise.resolve()
    .then(() => dispatch(msg))
    .then((result) => send({ jsonrpc: '2.0', id: msg.id, result }))
    .catch((err) => {
      log('dispatch error:', err);
      send({ jsonrpc: '2.0', id: msg.id, error: { code: err?.code ?? -32603, message: String(err?.message || err) } });
    })
    .finally(() => { pending--; maybeExit(); });
});
rl.on('close', () => { log('stdin closed'); stdinClosed = true; maybeExit(); });

process.stderr.write('[bilibili-mcp] ready\n');
