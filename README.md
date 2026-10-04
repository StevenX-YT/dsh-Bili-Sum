# dsh-Bili-Sum（B站视频理解流水线）

> 当前版本：**v3.0.0**（版本历史见 `CHANGELOG.md`；内部组件 tsGal runtime v3.6 独立版本）
> 许可证：Apache-2.0（见 `LICENSE`；第三方组件归属见 `NOTICE`）

给 DeepSeek Harness 提供的 B 站数据 MCP 服务器：把「BV 号 → 视频元数据 / 弹幕 / 字幕 / 评论 / **语音转录 / 关键帧画面**」封装成标准 MCP 工具，并通过五套模板（讲解/课程/教程/分享/资讯）渲染成图文笔记。

## 安装（DeepSeek Harness 插件，一句话）

仓库：**https://github.com/StevenX-YT/dsh-Bili-Sum**

在 Harness 里对 agent 说：**「安装 dsh-Bili-Sum 插件」**——agent 会执行 `plugin_manager` 的 `install_bundle`，`target` 填 `github:StevenX-YT/dsh-Bili-Sum`（也支持本地目录与 npm 包名）。安装完成后：

1. **自检**：`node scripts/doctor.mjs`（脚本位于 profile 的 `node_modules\dsh-bili-sum\scripts\`；也可让 agent 跑，`mcp__bilibili__status` 工具同样输出就绪状态与路径）
2. **媒体工具链**：`scripts\setup-media.ps1` 下载 ffmpeg / whisper.cpp / 中文模型 / Silero VAD / yt-dlp（约 700MB，国内镜像；均不随仓库分发）
3. **登录 Cookie（可选）**：见下文「配置登录 Cookie」

**数据根**：运行时数据（`output/` 产物、`tools/` 工具链、`bin/`、`bili-cookie.txt`）默认在 `<dsh家目录>\bili-sum\`（Windows 通常 `%USERPROFILE%\.dsh\bili-sum`），由插件 patch 自动注入 `BILI_DATA_ROOT`——**与插件代码目录分离**，卸载/升级插件不影响数据。未设置该变量时（如直接跑仓库源码）数据回落到代码同目录（老布局兼容）。

- **卸载**：Harness 插件管理里移除 `dsh-bili-sum` bundle 即可；数据根目录可自行保留或删除
- **node 不在 PATH 时**：给 MCP 连接设环境变量 `BILI_NODE_PATH=<node绝对路径>`（或在系统 PATH 里加入 node）
- **安装失败排查**：报 `git: 'remote-https' is not a git command` → 本机 git 安装损坏，重装 Git for Windows（或确保 PATH 上有可用 git）；报 `ERR_PNPM_MISSING_TARBALL_INTEGRITY`（URL tarball 安装）→ 先下载再本地安装：`curl -L https://github.com/StevenX-YT/dsh-Bili-Sum/archive/refs/heads/main.tar.gz -o dsh-bili-sum.tar.gz`，然后 `target` 填该本地文件路径；装完自检 `node scripts/doctor.mjs`

## 免责与安全

- **免责声明**：本项目使用 bilibili 非官方 API 接口，仅供个人学习研究使用，与 bilibili 官方无关联；请遵守 bilibili 用户协议，勿高频请求
- **安全**：`bili-cookie.txt`（登录凭据）已被 .gitignore 排除且位于数据根（仓库外）；请勿将你的 Cookie 提交到任何仓库或发送给他人
- **第三方组件**：whisper.cpp / Silero VAD（MIT）、ffmpeg（LGPL/GPL）、yt-dlp（Unlicense）——均由 `setup-media.ps1` 引导用户自行下载，归属与许可见 `NOTICE`

## 工具列表

| 工具 | 作用 | 登录 Cookie |
|---|---|---|
| `video-info` | 视频元数据：标题、简介、UP主、播放/点赞数据、分P、字幕语言列表 | 不需要 |
| `danmaku` | 弹幕（带时间轴），支持关键词过滤、分P（链接 `?p=N` 自动识别） | 不需要 |
| `subtitles` | 字幕：列出可用语言；`lang` 或 `download=true` 时返回字幕全文 | 部分需要 |
| `comments` | 评论区：热评/最新/点赞排序、分页、关键词过滤 | **需要** |
| `analyze` | **一键编排（推荐入口）**：音视频流**并行下载**（音频就绪即转录）→ whisper 转录（学科词偏置 + **VAD 静音跳过 + 幻觉抑制**）→ 转录驱动抽帧+关键时刻补抽 → 弹幕信号 → `bundle.json`；`route=fast` 快速路线；**>30 分钟长视频自动转后台进程**（`scripts/analyze-status.mjs` 查进度） | 不需要 |
| `transcribe` | 语音转录：可传 `prompt`（领域词偏置）/ `threads`（默认按 CPU 自动）/ `page` | 不需要 |
| `keyframes` | 关键帧：默认**自适应去重**（低帧率采样全片→字节差异去重，捕捉板书重写）；支持 `timestamps[]` 精抽、`everySec` 等间隔 | 不需要 |
| `status` | 服务器自检：yt-dlp / ffmpeg / whisper / 模型 / Cookie 状态 | — |

支持的输入格式：`BV1GJ411x7h7`、`av80433022`、`https://www.bilibili.com/video/BV...`（可带 `?p=N` 分P）、`https://b23.tv/...` 短链。

## 分析与渲染工作流（v2 推荐）

用户只要说「**帮我总结 BVxxx（?p=N），用于学习/快速了解**」，agent 执行：

1. `analyze`（type=lecture 课程 / general 普通视频）→ 一次跑完转录+抽帧+弹幕信号，产出 `output/<bv>_pN/bundle.json`（含带时间戳转录、关键时刻+配帧、弹幕学习信号）
2. `read_image` 阅读 bundle 中关键时刻对应的帧（**转录驱动选帧**：先读文稿理解结构，再看画面校正术语/公式）
3. 渲染成品 HTML——**日常用快速交付模式**：把智力内容写成 `output/<dir>/content.json`（schema 见 `scripts/render-notes.mjs` 头注释，完整样例 `output/BV1YaeN6xEWR/content.json`），然后 `node scripts\render-notes.mjs <dir>`——模板填充+直链获取+tsGal 注入一步完成（秒级，选帧可自动）；**调试/精修用手工模式**：从 `templates/note-skeleton.html`（token 版）起步按规范改（`PRACTICE-NOTES.md` 有双模式作业法与踩坑清单）：
   - 课程 → `templates/lecture-notes.md`（知识框架表/分段精讲配板书/易错易混难点解答/复习清单；不输出勘误表，正文直接正确；弹幕仅作内部难点线索）
   - 普通视频 → `templates/video-digest.md`（三层信息密度：TL;DR→亮点+Q&A+术语→章节时间轴；观点归因；广告位标注）
   - 只要全文 → `templates/transcript-pretty.md`（图文转录，误写括号标注）
4. **注入时间戳画廊 + B站小窗播放（tsGal v3.6）**：`& scripts\inject-gallery.ps1 -HtmlPath <笔记.html>`——所有 `.ts` 蓝色时间戳可点击，
   **左键在页内右下角悬浮小窗播放**。视频源双通道：**本地服务器模式（推荐）** `node scripts\serve-notes.mjs` 后经
   `http://127.0.0.1:8930/` 打开笔记 → 小窗走 `/proxy` 代理（自动补B站 Referer，实测解决 CDN 403）→
   原生 `<video>` 完整支持 **空降/点击暂停**；
   视频由B站 CDN 在线流式传输，不下载本地。file:// 直开则回退B站播放器 iframe（登录态下空降可能被观看历史续播干扰）；
   右键仍可在B站新标签页空降；小窗可拖动/缩放记忆/双击复位/ESC关闭；每个时间段旁另有折叠画廊。规范见 templates/lecture-notes.md「tsGal v3.6」（v3.6 起页面内字幕系统已移除，留档 `archive-subtitles/`）
5. 用 `present` 交付 HTML 文件卡片

CLI 等价入口（不经过 MCP 时）：`node scripts\analyze.mjs <链接> --type lecture|general [--route balanced|fast] [--page N] [--frames N] [--keep] [--no-vad] [--dual|--no-dual] [--bg]`

成品示例（均已注入 tsGal 画廊）：
- `output/BV1CAxaeHEeH_p8/lecture-notes.html`（宋浩高数 P8 课程笔记，19:37，21 帧覆盖全片板书）
- `output/BV1jChb6sEeK/calligraphy-notes.html`（胆巴碑楷书课第1节，65 分钟，32 帧）
- `output/BV1FtaJ6BEsd/video-digest.html`（章北海official 视频速览，与用户提供的标杆导出同源对比）

产物目录：`output/<bvid>_pN/`（bundle.json / transcript.txt / transcript.json / kf_*.png / kf_at_*.png）。
中间音视频默认删除（`keepMedia: true` 保留）。

## 目录结构

```
dsh-Bili-Sum/
├── package.json          # bundle 清单（dsh-bili-sum；files 白名单控制安装内容）
├── cordis.patch.yml      # Harness 插件补丁：注册 MCP stdio 连接（!!js 零绝对路径）
├── server.js             # MCP 服务器（stdio JSON-RPC，零依赖）
├── bili.js               # B 站数据 API（元数据/弹幕/字幕/评论）
├── media.js              # 媒体流水线（playurl 直连/wbi 签名/ffmpeg/whisper/抽帧）
├── paths.js              # 路径解析单一事实源（PKG_ROOT=代码资产 / DATA_ROOT=运行时数据）
├── scripts/
│   ├── doctor.mjs        # 安装自检（数据根/工具链/模型/Cookie；exit 0=就绪）
│   ├── analyze.mjs       # 一键编排 CLI（与 MCP analyze 工具同逻辑）
│   ├── render-notes.mjs  # 渲染器（content.json→HTML+tsGal注入，五模板）
│   ├── analyze-status.mjs# 后台分析进度查询
│   ├── serve-notes.mjs   # 本地笔记服务器 + CDN Referer 代理
│   ├── setup-media.ps1   # 媒体工具链安装器（下载至数据根 tools/）
│   ├── fetch-ytdlp.mjs / dl.mjs   # yt-dlp 下载 / 通用下载器
│   ├── check-cookie.mjs  # 登录态验证
│   ├── inject-gallery.ps1# tsGal 注入（幂等）
│   ├── fetch-stream.mjs  # 注入时在线取B站直链（3次重试）
│   ├── test-*.mjs        # 回归测试（media纯函数/tsGal/渲染器 26+24+37 项）
│   └── peek.mjs / danmaku-peek.mjs / probe-*.mjs / A/B 工具
├── templates/            # 五模板骨架 + tsGal 运行时 + 渲染规范
│   ├── note-skeleton*.html / gallery-runtime.js
│   └── lecture-notes.md / video-digest.md / transcript-pretty.md / ...
├── LICENSE / NOTICE / README.md / CHANGELOG.md
├── OUTPUT-STANDARDS.md   # 输出质量规格书（Q1–Q11 拍板定稿）
└── PRACTICE-NOTES.md     # 实战经验手册（判型规则/标准作业/踩坑清单）
# 运行时数据（插件布局，不入库）：<dsh家目录>\bili-sum\{output,tools,bin,bili-cookie.txt}
```

## 媒体工具链安装 / 更新

```powershell
# 安装或更新 ffmpeg + whisper.cpp + 中文模型（国内镜像，已自动处理）
Set-ExecutionPolicy -Scope Process Bypass -Force
& scripts\setup-media.ps1
```

下载源：gyan.dev / GitHub(经 ghfast.top 镜像) / 模型走 hf-mirror.com。
已装好则自动跳过；模型可换更大的 `ggml-medium.bin`（放进 `tools/models/` 即可）。

## 配置登录 Cookie（解锁评论 + 更多字幕）

1. 浏览器登录 bilibili.com → F12 开发者工具 → Application → Cookies
2. 复制 `SESSDATA` 的值（只要值，不要 `SESSDATA=` 前缀也行）
3. 写入 `bili-cookie.txt`（数据根目录，未设置 `BILI_DATA_ROOT` 时为源码目录），一行即可：
   ```
   SESSDATA=xxxxxx（你的值）
   ```
   或者直接粘贴完整的 Cookie 字符串也支持。
4. 重启 Harness（或重载插件）让 MCP 服务器重新读取。

> 安全提示：Cookie 等价于你的登录态，只保存在本机该文件中，仅用于请求 B 站官方 API。不要提交到仓库、不要发给别人。删除文件即失效。

## 安装 / 卸载（历史说明，v3 起见文首「安装」节）

- v3.0.0 起为标准 dsh bundle：patch 零绝对路径（挂载时经 `!!js` 从 profile 上下文解析），数据走 `BILI_DATA_ROOT`，安装/卸载见文首
- 旧版（v2.x）本地安装型：`install_bundle` 指向源码目录 + 手改 patch 绝对路径——已被 v3 方案取代

## 已知限制与实现要点（v2）

- **VAD 静音检测默认开启（v3.7 流水线，2026-10-03）**：Silero v6.2.0 模型（`tools/models/ggml-silero-v6.2.0.bin`，约 864KB）先扫音频标出语音区间，只把说话部分送 whisper——省 20~50% 转录时间并消除片头 BGM/静音段幻觉。安全参数：`-vp 200`（段首尾 padding 防吞字）、`-vmsd 25`（防超长段时间戳漂移）。配乐盖人声的视频（混剪/vlog）建议 `--no-vad` 或 `BILI_WHISPER_VAD=0`。`--suppress-nst`（非语音 token 抑制）恒开。
- **快速路线 route=fast**：放弃全片自适应比对，改为转录驱动定点快取（语音时间点均匀取样+片尾帧，`-ss` 跳跃抽取不解码全片，帧上限 12）——总耗时约省 30~40%，适合快速了解/资讯速览；板书逐帧推演的课程仍用默认 balanced。
- **下载/转录并行（v3.8，错峰版）**：**任何时刻只保持一条B站CDN连接**（实测双流并发会被CDN掐死音频流）——音频单连接先下→立即转录→视频流在转录期间（CPU 忙、无网络请求）下载，下载耗时被转录时间掩盖。`BILI_PARALLEL_DOWNLOAD=0` 禁用（回退串行）；无 yt-dlp 环境自动走 playurl 串行回退。
- **长视频后台化（v3.8）**：分 P 时长 >30 分钟（`BILI_LONG_VIDEO_BG_SEC` 可调）时，MCP analyze 自动把任务转为 detached 后台进程（立即返回 pid/日志/bundle 路径），避免长转录撞工具调用超时被中断；`node scripts/analyze-status.mjs <BV号>` 查进度。CLI 加 `--bg` 强制后台。
- **whisper 双进程分块并行（v3.9，质量门槛 A/B 全过后集成默认）**：≥8 分钟的视频自动把音频在静音点（silencedetect）切两半，两个 whisper 进程各 8 线程同时转录后拼接——19 分钟课程实测转录 206s→**126s（-39%）**，接缝零损伤、时间戳漂移 0.03s、内容字符级无损（+0.08%）。找不到静音切点（重配乐视频硬切风险高）自动回退单进程；`--no-dual` / `BILI_WHISPER_DUAL=0` 关闭，`--dual` / `=1` 强制（含硬切）。
- **whisper `-p` 参数崩溃（已规避）**：v1.9.2 BLAS 版直接传 `-p` 会崩溃（中英文皆然，exit 0xC0000135）。实现改为把提示词写入 UTF-8 文件并用 ggml 的 `@response-file` 语法传入，再加 `--carry-initial-prompt` 全程携带偏置——中段术语正确率显著提升（如「函数几线」→「函数极限」），首尾仍可能有同音字残留。
- **线程策略**：混合架构 CPU（如 i9-14900HX）上线程过大反而变慢（whisper.cpp #1282）。默认 `-t 8`（≥16 线程 CPU 时）+ `OPENBLAS_NUM_THREADS=8`；可用环境变量 `BILI_WHISPER_THREADS` 覆盖。
- **课程抽帧不用相邻帧场景检测**：板书是逐帧渐进书写，相邻帧差值低于任何阈值，场景检测必然漏检。自适应模式改为：低帧率采样全片（约 300 候选）→ 与上一保留帧做字节差异比对 → 只保留画面真正变化的帧（每次板书重写都被捕捉）→ 均匀取样到上限。
- **ASR 精度**：默认 `ggml-small.bin`。口播偶有同音字误写——工作流用板书画面交叉校正（勘误表）。追求更准可放 `ggml-medium.bin` 进 `tools/models/`（CPU 上速度约 1/3~1/4，建议仅高价值内容）。
- **yt-dlp**：完全访问模式实测可用（2026.08.19，自动走 yt-dlp 下载+ffmpeg 合并）；受限沙箱内 PyInstaller 无法自建临时目录时自动回退 playurl 直连。
- 弹幕接口单次最多约 1000~1200 条（热门池），不是全量弹幕。
- 评论接口需要有效 SESSDATA；过期或风控（-352）时会返回明确错误。
- B 站 AI 字幕匿名拿不到（需登录 Cookie）；无 Cookie 时字幕正文不可得，靠 whisper 转录兜底。
- 安装时 profile 里有一个与本包无关的既有警告：`dsh-at-file: ctx.settings.register is not a function`，不影响本 MCP 连接。

## 验证记录

**v1（2026-10-02）**：bundle 安装 applied；7 工具注册；宿主诊断 yt-dlp/ffmpeg/whisper/模型全通；恐惧症视频端到端转录（3:05→62s）+ 抽帧画面与语音精确对应。

**v2（2026-10-03 过夜优化）**：
- 宋浩高数 P8（19:37）analyze 全链路：yt-dlp 下载合并 → whisper small 8线程+中文偏置 432 段（转录纯耗时 269s，含下载/帧/弹幕总 428s）→ 自适应抽帧 294 候选→20+1 帧（覆盖 00:00–19:32 全部板书重写，含最终完整板书）→ 成品 `lecture-notes.html`（29.9KB，图文内嵌+折叠全转录）
- 章北海official《官媒点名批判…》（10:52，用户标杆导出的源视频）analyze：276 段/16 帧/360s → 成品 `video-digest.html`（三层信息密度/16条亮点带原话时间戳/5组Q&A/9条术语/13章节含广告位标注/3张核验配图），结构对齐标杆并修复其元信息缺失、时间戳不全、观点无归因三缺陷
- `-p` 崩溃根因定位与 `@response-file` 规避实测（6 组对照实验）；假提速 bug（旧 transcript.json 复用）修复；`--carry-initial-prompt` + 学科词偏置实测生效

## 更新 yt-dlp

```powershell
node scripts\fetch-ytdlp.mjs
```
