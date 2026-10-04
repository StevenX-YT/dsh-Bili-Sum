#!/usr/bin/env node
/**
 * bilibili-mcp — B 站数据 MCP 服务器（stdio，换行分隔 JSON-RPC 2.0）
 * 工具：video-info / danmaku / subtitles / comments / transcribe / keyframes / analyze / status
 * 资源：usage://dsh-bili-sum（标准作业手册精简版——新会话 agent 不读工作区文档也能走对管线）
 * 零依赖；日志只写 stderr，stdout 仅输出 JSON-RPC 消息。
 */
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  videoInfo, getDanmaku, getSubtitles, getComments,
  ytdlpVersion, getCookie, YTDLP,
} from './bili.js';
import { transcribe, extractKeyframes, analyze, analyzeOrBackground, hostDiag } from './media.js';
import { PKG_ROOT, DATA_ROOT, OUTPUT_DIR, TOOLS_DIR } from './paths.js';

const SERVER_INFO = { name: 'bilibili', version: '3.2.1' };
const DEBUG = !!process.env.MCP_DEBUG;

function log(...args) {
  if (!DEBUG) return;
  process.stderr.write(
    '[bilibili-mcp] ' + args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ') + '\n'
  );
}

// ---------- 方案 B：MCP resources——usage://dsh-bili-sum 标准作业手册（精简版） ----------
// 修复「新会话配方缺失」：正确配方原先只在工作区文档（PRACTICE-NOTES/OUTPUT-STANDARDS）里，
// 新会话 agent 不可见 → 手写 HTML 绕过插件管线。analyze 工具描述内联核心方法（方案 A），
// 本资源提供同一配方的完整精简版，供 MCP client resources/read 获取。
export const USAGE_URI = 'usage://dsh-bili-sum';
export const USAGE_MANUAL = `# dsh-Bili-Sum 标准作业手册（精简版）

B 站视频图文笔记流水线。完整规格在插件目录：PRACTICE-NOTES.md（作业）/ OUTPUT-STANDARDS.md（规格 Q1–Q11）/ HANDOFF.md（状态）。

## 标准流程（analyze → brief → content.json → render → present）
1. analyze(bvid, type=lecture|general, route=balanced|fast) → 返回 files.workDir 与 files.brief
2. 读 workDir/brief.md（元信息+关键时刻+配帧+弹幕信号+完整转录）；不必逐帧 read_image
3. 判型并回显「识别为：XX 模板（可说 YY 覆盖）」：
   - lecture 课程：标题含 讲/课程/第X课/学科词；开场「今天这节课」；弹幕「听不懂/懂了」刷屏
   - tutorial 教程：标题含 教程/安装/配置/部署/使用；简介给工具链接/网盘/提取码
   - digest 讲解/评论：观点句式或事件评论；转录论证词「我认为/其实/关键是」
   - share 分享：vlog/日常/碎碎念/旅行；生活化短句密集、无知识结构
   - info 资讯：标题「速递/快讯/热点/速报」；时长≤5min；新闻句式
4. 写 workDir/content.json（唯一智力产出；勿手写 HTML 样板；字段见下）
5. node scripts/render-notes.mjs <workDir> --template digest|lecture|tutorial|share|info
6. present 成品 HTML（单文件自包含；时间戳渲染为可点 .ts 徽章）

## content.json 字段（字段全名；空区块整块省略 F2，不硬凑占位）
通用：out、attr、summary[]、highlightsTitle、frames[{file,cap}]（内容驱动默认省略）、gridNote、dm[{cat:刷屏|反驳|指引|神评,ts,text}]
digest 讲解/评论：warn（敏感必填）、highlights[{emoji,title,ts,quote}]、thesis、chain[{role,text,ts}]（存在时替换关键点区）、tags[]、qa[{q,ts,src,ext}]、terms[{t,d,ts}]、chapters[{range,title,text}]、attribution{author,mentioned,facts,other,external}、credibility
lecture 课程：course{subject,topic,level,prereq,audience}、framework[{no,name,core,ts,frame}]、knowledge[{no,name,definition,points,emphasis,usage,ts}]、examples[{no,title,question,approach,steps[],answer,pitfalls,ts}]、authorSummary[{ts,quote}]、difficulty[{point,evidence,advice}]、prereq{before[],after[]}、review[]、signals{warnings,turning,resources,memes}
tutorial 教程：task{what,prereq,time,output}、quickPath、prereqCheck[]、steps[{no,title,op,frame,purpose,verify,tip,ts}]、errors[{raw,cause,fix,ts}]、verify[]、tools[{name,note}]
share 分享：tldr、timeline[{ts,text,frame}]、quotes[{ts,text}]、useful[{label,value,ts}]
info 资讯：flash、wh{when,where,who,what,why,how}、data[{k,v,ts}]、timeline[{ts|t,e|text,frame}]、react[{side,text}]、background

## 硬保底（缺=渲染报错或成品违规）
- lecture 例题 examples[].steps 必填：完整解题过程（题目→思路→逐步→答案）
- tutorial 每步 steps[].verify 必填：该步怎么算成功
- info 5W1H 表必含（wh 字段）
- 敏感争议三件套：warn 阅读提示 + 全程归因 + attribution 四栏（对方立场缺失写「本视频未呈现」）
- 「」=逐字引用；渲染前静默校正（同音字/繁体→简体），不输出勘误表
- 弹幕四类（刷屏/反驳/指引/神评）；课程笔记不引弹幕疑问/打卡；人身攻击不照录放大

## 条数口诀（Q4；balanced 档要点数按视频时长）
<3min≈6-14｜3-10min≈8-14｜10-30min≈10-16｜>30min≈12-20
- 密度突破：独立要点≥上限×1.2 才可超出（独立主张+独立时间戳+同义必合并）
- 稀疏压缩：可列要点<下限按实数写，缺口区块整块省略（F2）
- 命名随模板：digest=关键点、share=时间线亮点；highlightsTitle 可自定义

## 深度档与开关
- 默认深度=平衡标准档（Q7②）；快速档仅显式指令触发
- route=balanced 默认（板书课必须）/fast 快速了解（帧上限 12）
- >30min 自动后台：node scripts/analyze-status.mjs <BV>，看输出 state 字段（running|completed|failed）
- 质量档/medium 模型等细节见插件目录 OUTPUT-STANDARDS.md §2

## 交付前检查
元信息无省略（缺失写「未提供」）｜要点条数合规｜时间戳齐全可点｜敏感三件套齐｜弹幕四类合规、无攻击性放大｜含板书/界面/演示的视频已用帧能力｜present 卡片交付（目录路径聊天里打不开）
`;

export const TOOLS = [
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
      '转录 B 站视频语音内容：下载音频 → 16kHz wav → whisper.cpp 转录，返回带时间轴的文稿预览和全文文件路径。仅当用户只要转录/文稿时单独使用；要交付图文笔记请改用 analyze（含 brief.md+content.json+render-notes 标准流程，完整方法见其描述或 MCP 资源 usage://dsh-bili-sum）。长视频转录需要几分钟。',
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
    description: [
      '一键编排视频理解：下载媒体→whisper转录（领域词偏置+VAD+幻觉抑制）→转录驱动抽帧+关键时刻补抽→弹幕信号→bundle.json。返回 workDir 与 brief.md。type=lecture课程/general普通；route=balanced默认/fast快速；>30min自动后台（analyze-status.mjs 查进度，看state字段）。',
      '',
      '【标准交付流程——禁止手写HTML样板，成品必须经渲染器】',
      '1) 用返回的 workDir 读 brief.md（元信息+关键时刻+配帧+弹幕信号+完整转录），不必逐帧 read_image；',
      '2) 判型并回显「识别为：XX模板（可说YY覆盖）」。信号一行：标题含讲/课程/第X课/学科词或开场「今天这节课」=lecture；含教程/安装/配置/部署/使用=tutorial；观点句式/事件评论=digest；vlog/日常/旅行=share；速递/快讯/热点且≤5min=info；',
      '3) 在 workDir 写 content.json（唯一智力产出）：通用 summary[]、highlights[{emoji,title,ts,quote}]、highlightsTitle、tags[]、qa[{q,ts,src,ext}]、terms[{t,d,ts}]、chapters[{range,title,text}]、attribution{author,mentioned,facts,other,external}、dm[{cat:刷屏|反驳|指引|神评,ts,text}]、frames[{file,cap}]（内容驱动默认省略）；lecture 另加 course{subject,topic,level,prereq,audience}/framework[{no,name,core,ts,frame}]/knowledge[{no,name,definition,points,emphasis,usage,ts}]/examples[{no,title,question,approach,steps[],answer,pitfalls,ts}]/authorSummary[{ts,quote}]/difficulty[{point,evidence,advice}]/prereq{before,after}/review[]/signals{warnings,turning,resources,memes}；tutorial 另加 task{what,prereq,time,output}/quickPath/prereqCheck[]/steps[{no,title,op,frame,purpose,verify,tip,ts}]/errors[{raw,cause,fix,ts}]/verify[]/tools[{name,note}]；share 另加 tldr/timeline[{ts,text,frame}]/quotes[{ts,text}]/useful[{label,value,ts}]；info 另加 flash/wh{when,where,who,what,why,how}/data[{k,v,ts}]/timeline[{ts|t,e|text,frame}]/react[{side,text}]/background；',
      '4) 渲染：node scripts/render-notes.mjs <workDir> --template digest|lecture|tutorial|share|info；',
      '5) present 成品 HTML。完整字段表与检查清单读 MCP 资源 usage://dsh-bili-sum。',
      '【条数口诀Q4】balanced档要点条数按视频时长：<3min≈6-14、3-10min≈8-14、10-30min≈10-16、>30min≈12-20；独立要点≥上限×1.2才可突破（独立主张+独立时间戳+同义必合并）；稀疏按实数写、缺的区块整块省略。命名按模板默认（digest=关键点/share=时间线亮点）或highlightsTitle指定。',
      '【硬保底】lecture例题steps必填完整解法；tutorial每步verify必填；info 5W1H必含；敏感争议三件套=warn阅读提示+全程归因+attribution四栏（对方立场缺失写「本视频未呈现」）。',
    ].join('\n'),
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

export async function dispatch(msg) {
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
      return {
        resources: [{
          uri: USAGE_URI,
          name: 'dsh-Bili-Sum 标准作业手册',
          description: 'B站视频图文笔记标准交付流程（判型/content.json 字段/渲染命令/硬保底/Q4 条数口诀）——新会话无工作区文档时的完整配方',
          mimeType: 'text/markdown',
        }],
      };
    case 'resources/read': {
      if (params?.uri !== USAGE_URI) {
        const e = new Error(`未知资源: ${params?.uri}（本服务器仅提供 ${USAGE_URI}）`);
        e.code = -32002; // MCP: resource not found
        throw e;
      }
      return { contents: [{ uri: USAGE_URI, mimeType: 'text/markdown', text: USAGE_MANUAL }] };
    }
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

// 主模块守卫（与 render-notes.mjs 同模式）：被测试/工具 import 时不启动 stdio 服务
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
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
}
