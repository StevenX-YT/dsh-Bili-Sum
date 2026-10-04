# dsh-Bili-Sum — B站视频理解流水线（DeepSeek Harness 插件）

> 当前版本：**v3.2.0**（版本历史见 `CHANGELOG.md`；tsGal 交互层 v3.6 独立版本）
> 许可证：Apache-2.0（第三方组件归属见 `NOTICE`）｜仓库：https://github.com/StevenX-YT/dsh-Bili-Sum

**一句话**：给 DeepSeek Harness 装上"B站视频理解"能力——对 agent 说一个 BV 号，它就把视频**听懂、看懂、整理成带时间戳的图文笔记**交付给你；点笔记里的蓝色时间戳，右下角小窗直接播 B 站原视频的对应片段。

**目录**：[1 简介](#1-简介) · [2 能力一览](#2-能力一览) · [3 安装](#3-安装) · [4 使用](#4-使用通俗向) · [5 配置进阶](#5-配置进阶) · [6 故障排查](#6-故障排查) · [7 实现要点](#7-实现要点用户相关) · [8 安全与免责](#8-安全与免责) · [9 开发](#9-开发)

## 1. 简介

你是否有过这样的时刻：B站收藏了一个 1 小时的课/教程/长视频，一直没时间看；或者想快速判断一个视频值不值得看；又或者看完想留一份**能复习的笔记**而不是一堆收藏夹链接。

dsh-Bili-Sum 就是干这个的：它把视频**转成文字稿 + 关键画面截图 + 弹幕情绪信号**，再按视频类型自动整理成结构化笔记网页——摘要、亮点（带原话和时间戳）、问答、术语表、章节、课程还有例题完整解法。全程自动，几分钟出成品。

## 2. 能力一览

### 2.1 MCP 工具（8 个）

插件装好后 agent 会多出 8 个"B站工具"，日常你不用直接碰它们，agent 会自己调用；这里列出来让你知道它**能做什么、哪些功能需要登录 Cookie**：

| 工具 | 干什么（通俗版） | 需要 Cookie |
|---|---|---|
| `video-info` | 查视频"身份证"：标题、UP主、播放量、分几P、有无字幕 | 不用 |
| `analyze` | **一键全包（推荐入口）**：听录音转文字＋抽关键画面＋抓弹幕信号，产出完整分析包 | 不用 |
| `transcribe` | 只要文字稿：带时间戳的完整转录 | 不用 |
| `keyframes` | 只要画面：板书/PPT/演示的关键帧截图 | 不用 |
| `danmaku` | 捞弹幕（带时间点），支持关键词过滤 | 不用 |
| `subtitles` | 要字幕（仅部分视频有 AI 字幕轨） | 大部分要 |
| `comments` | 看评论区（热评/最新/按点赞） | **要**（怎么配见 [§5.1](#51-配置登录-cookie解锁评论高清字幕)） |
| `status` | 自检：工具齐不齐、路径对不对、Cookie 状态 | — |

支持的输入：`BV号` / `av号` / 完整视频链接（可带 `?p=N` 选分P）/ b23.tv 短链。

### 2.2 三条路线（深度不同，准确度同样有保障）

通俗版：**快速=先尝后买，平衡=标准套餐，质量=精读版**。三条路线"写出来的内容都必须准确"这条底线完全一样，区别只是**覆盖多少、写多厚、花多长时间**。

| 路线 | 通俗定位 | 分析侧做什么 | 输出多深 | 什么时候用 |
|---|---|---|---|---|
| **快速 fast** | 先尝后买：一杯咖啡时间知道这视频讲什么 | 定点截图（≤12 张）+ 完整文字稿 | 1 段摘要 + 5~6 个亮点 + 2 个问答 | 挑视频、追热点、时间紧 |
| **平衡 balanced**（默认） | 标准套餐：不漏重点的完整笔记 | 全片扫描截图（20 张）+ 关键时刻补抽 + 弹幕信号 | 2 段摘要 + 10~14 亮点 + 4~5 问答 + 章节 + 术语 + 归因表 | 日常默认：学习引用、工作参考 |
| **质量 quality** | 精读版：可以当学习资料反复看 | 截图上限 40 + **medium 转录** + 关键段落对照画面交叉核验 | 15~20 亮点（带子要点）+ 6~8 问答（含反例）+ 例题完整变式 | 课程精学、高价值内容存档 |

> 条数为参考区间——随视频时长与信息密度浮动（Q4）：密度极高可突破上限（触顶 **1.2×**，同义必合并）；稀疏视频从简（不足区块整块省略）。区块名称随模板走（如"关键点"），`content.highlightsTitle` 可自定义。详见 OUTPUT-STANDARDS §2.2。

**质量档 × medium 模型装/不装的差异**（模型按需自装，见 [§5.3](#53-质量路线medium-模型可选)）：

| 维度 | 未装 medium（默认） | 已装 medium（1.43GB） |
|---|---|---|
| 转录模型 | small——快，日常够用 | medium——准 |
| 专有名词 | 偶有同音字错误（如"律师函"听成"律师喊"），渲染时自动校正大部分 | **实测：11 处已知错误修对 7.5 处**，课程数学术语显著更稳 |
| 标点/分段 | 无标点、句子碎 | 自带标点、分段连贯可读 |
| 速度 | 基准（1 分 40 秒音频约 26 秒转完） | 约 2.3 倍耗时 |
| 输出字形 | 简体 | 繁体 → 插件落盘前**自动转简体**（对你无感） |
| 忘装会怎样 | — | 用质量档会**自动回退 small 并在结果里明确标注** `modelFallback`，绝不静默降级 |
| 你要做什么 | 什么都不用做 | 三步启用（§5.3） |

### 2.3 五个模板（类型不同，长得不同）

通俗版：视频是**什么类型**决定笔记**长什么样**——不用记模板名，说人话即可，agent 自动判断并回显（说"用XX模板"可覆盖）：

| 模板 | 通俗说明 | 典型视频 | 核心区块 | 硬保底（必须有） |
|---|---|---|---|---|
| **讲解** digest | 帮你看懂"别人在讲什么观点" | 事件评论、科普、测评 | 摘要＋**关键点**（默认名可自定义）＋Q&A＋术语＋**观点归因表**（谁说的、哪些是事实） | 敏感话题必带归因表 |
| **课程** lecture | 像助教把一节课整理成讲义 | 网课、讲座、考研课 | 知识框架表（带板书图）＋知识点精讲＋**例题完整解法**＋复习清单 | 例题缺完整步骤直接渲染报错 |
| **教程** tutorial | 照着做的操作手册 | 安装、配置、部署视频 | 前置检查＋步骤卡（做什么/为什么/怎么验证）＋常见报错 | 每步必须写"怎么算成功" |
| **分享** share | 抓重点和金句的轻量速览 | vlog、日常、旅行 | TL;DR＋时间线亮点＋语录＋有用信息 | 不硬凑：没语录整块不显示 |
| **资讯** info | 一分钟看懂一条热点 | 新闻速报、热点事件 | 一句话快讯＋**5W1H 表**＋关键数据＋各方反应 | 5W1H（谁/何时/何地/何事/为何/如何）必填 |

## 3. 安装

### 3.1 前置条件

Windows ＋ DeepSeek Harness ＋ **Node.js ≥ 18**（在 PATH 上；不在也有办法，见 §5.2）。若用 git 方式安装还需本机 git 正常（损坏也有兜底，见 §6）。

### 3.2 一句话安装

在 Harness 里对 agent 说：**「安装 dsh-Bili-Sum 插件」**。agent 会执行 `install_bundle`，`target` 三选一：

| 方式 | target 填什么 | 适合 |
|---|---|---|
| **git 安装**（首选） | `github:StevenX-YT/dsh-Bili-Sum` | 本机 git 正常时最顺 |
| **本地 tarball**（兜底，实测稳） | 先 `curl -L https://github.com/StevenX-YT/dsh-Bili-Sum/archive/refs/heads/main.tar.gz -o dsh-bili-sum.tar.gz`，target 填该文件路径 | git 装失败/网络走代理时 |
| 目录安装 | 克隆本仓库后的本地路径 | 想改代码的开发者 |

### 3.3 装完三步

```powershell
# ① 自检（在插件目录 scripts\ 下；让 agent 跑也行，status 工具同效）
node scripts\doctor.mjs        # exit 0 = 就绪，缺什么会打印修复指引
# ② 媒体工具链（约 700MB，国内镜像，重复跑自动跳过已有）
Set-ExecutionPolicy -Scope Process Bypass -Force
& scripts\setup-media.ps1      # ffmpeg + whisper + 中文模型(small) + VAD + yt-dlp
# ③ 登录 Cookie（可选，解锁评论/高清；步骤见 §5.1）
```

### 3.4 数据根布局

插件代码和运行数据**分离**（数据在 `<dsh家目录>\bili-sum\`，Windows 通常 `%USERPROFILE%\.dsh\bili-sum`，由插件自动注入，你不用管）：

| 目录 | 放什么 | 谁产生 |
|---|---|---|
| `output\<视频ID>\` | 笔记网页、关键帧截图、文字稿、分析包 | 每次分析 |
| `tools\` | ffmpeg / whisper / 模型（small、medium、VAD） | setup-media 或手动 |
| `bin\` | yt-dlp | setup-media |
| `bili-cookie.txt` | 登录凭据（可选） | 你 |

好处：卸载/升级插件不影响数据；反过来数据放哪也不影响插件。

### 3.5 卸载

Harness 插件管理里移除 `dsh-bili-sum` 即可；数据根目录想留想删随意。

## 4. 使用（通俗向）

### 4.1 对 agent 说人话

把 BVxxxx 换成视频号，复制即用：

> 帮我总结 BVxxxx，快速路线
> 帮我总结 BVxxxx，平衡路线
> 帮我总结 BVxxxx，质量路线（需先装 medium，见 §5.3）
> 用教程模板总结 BVxxxx

也可以**只甩关键词**：「快速了解 BVxxxx」「BVxxxx 质量档」「BVxxxx 课程笔记」——agent 会自动补全；模板判错也不怕，换一个重渲是秒级操作。

说完什么都不用管：agent 分析视频（转文字＋截图＋弹幕）→ 自动判断类型和深度 → **在聊天里交付网页笔记卡片**，点开就是成品。

### 4.2 笔记怎么打开

| 方式 | 怎么做 | 特点 |
|---|---|---|
| present 卡片 | 聊天里直接点 | 最常用 |
| 双击 HTML 文件 | 产物目录里找 `*-notes.html` | 直接看没问题；小窗播放会退化成B站播放器 |
| **本地小窗播放模式**（看课推荐） | `node scripts\serve-notes.mjs` → 浏览器开 `http://127.0.0.1:8930/` → 点开笔记 | **所有蓝色时间戳可点**，右下角小窗直接播 B 站原视频对应段落（本地代理自动带 Referer，不被B站拒绝）；视频在线流式播放，不下载本地 |

### 4.3 命令行方式（不用 agent 时）

```powershell
node scripts\analyze.mjs <BV链接> --type lecture|general [--route fast] [--model medium]   # 分析
node scripts\render-notes.mjs <目录名> --template lecture                                   # 渲染
node scripts\analyze-status.mjs <BV链接>                                                     # 长视频后台进度
```

## 5. 配置进阶

### 5.1 配置登录 Cookie（解锁评论、高清、字幕）

1. 浏览器登录 bilibili.com → F12 开发者工具 → Application → Cookies
2. 复制 `SESSDATA` 的值（只要值，不要 `SESSDATA=` 前缀也行）
3. 写入**数据根**的 `bili-cookie.txt`，一行即可：`SESSDATA=你的值`（粘贴完整 Cookie 字符串也支持）
4. 重启 Harness（或重载插件）生效；验证：`node scripts\check-cookie.mjs`

> Cookie 等价于你的登录态：只存本机数据根该文件、只用于请求B站官方 API；勿提交仓库、勿发给别人。

### 5.2 node 不在 PATH

给 MCP 连接设环境变量 `BILI_NODE_PATH=<node.exe 绝对路径>`；或把 node 加进系统 PATH。

### 5.3 质量路线（medium 模型，可选）

**收益（实测）**：专有名词错误明显减少（11 处修 7.5 处）、输出自带标点、课程术语更稳——代价是转录约慢 2.3 倍、多占 1.43GB 磁盘。平衡/快速档永远用 small，只有质量档用它。

**三步启用**：

```powershell
# ① 下载（约 1.43GB，hf-mirror 国内源）
curl -L https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin -o "%USERPROFILE%\.dsh\bili-sum\tools\models\ggml-medium.bin"
# ② 确认
node scripts\doctor.mjs     # 看 "medium model (quality route)" 变 OK
# ③ 用：对 agent 说「用质量档总结 BVxxxx」即可
```

**不用配置的内置防护**（插件已处理）：长视频自动单进程防内存爆；繁体输出落盘前自动转简体；忘装模型时自动回退并标注。

### 5.4 环境变量速查

| 变量 | 默认 | 何时改 |
|---|---|---|
| `BILI_DATA_ROOT` | `<dsh家>\bili-sum` | 插件自动注入，一般不动 |
| `BILI_NODE_PATH` | — | node 不在 PATH 时（§5.2） |
| `BILI_SESSDATA` / `BILI_COOKIE` | — | 想用环境变量代替 cookie 文件 |
| `BILI_WHISPER_VAD` | 开 | 配乐盖人声的视频（混剪/vlog）设 `0` 关掉，人声更完整 |
| `BILI_WHISPER_DUAL` | 自动 | ≥6 分钟视频自动双进程提速；设 `0` 强制关（内存紧张时）；medium 本来就单进程 |
| `BILI_WHISPER_THREADS` | 8 | 一般不动（实测加线程无收益） |
| `BILI_LONG_VIDEO_BG_SEC` | 1800 | 超过 N 秒自动转后台跑，一般不动 |
| `BILI_PARALLEL_DOWNLOAD` | 开 | 下载/转录错峰并行；设 `0` 关 |
| `MCP_DEBUG` | — | 设 `1` 看 MCP 服务器日志 |

### 5.5 更新工具链 / yt-dlp

```powershell
& scripts\setup-media.ps1    # 重跑即更新（已有文件自动跳过）
node scripts\fetch-ytdlp.mjs # 只更新 yt-dlp
```

## 6. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 安装报 `git: 'remote-https' is not a git command` | 本机 git 损坏 | 重装 Git for Windows，或改用本地 tarball 装法（§3.2） |
| 安装报 `ERR_PNPM_MISSING_TARBALL_INTEGRITY` | URL 安装走网络缓存出错 | 用 `curl` 下载 tarball 后 target 填**本地文件**路径 |
| 装完 MCP 工具不出现 | 连接未启动 | 看 Harness 插件面板 `dsh-bili-sum` 有无报错；重启 Harness；`doctor` 复检 |
| 转录很慢/内存不足 | 长视频双进程吃内存 | 设 `BILI_WHISPER_DUAL=0`（medium 本来就是单进程） |
| 笔记里视频不能小窗播放 | `file://` 无法带 Referer | 用本地小窗播放模式（§4.2 serve-notes） |
| 笔记里视频变成B站 iframe | CDN 直链临时限流 | 正常现象，稍后重跑一次渲染即恢复 |
| 评论工具报"需要登录" | 未配置 Cookie | 按 §5.1 配置 |
| 安装时出现 `dsh-at-file` 警告 | 与本插件无关的其他插件问题 | 忽略，不影响本插件 |

## 7. 实现要点（用户相关）

- **VAD 静音检测默认开**：跳过静音/BGM 段，转录省 20~50% 时间且防"无人声幻觉"；配乐视频建议关（§5.4）
- **快速 vs 平衡怎么选**：快速=定点截图省一半时间；板书类课程必须平衡（逐帧书写要全片比对）
- **双进程提速**：≥6 分钟的视频自动把音频切两半并行转录（约省 40%）；找不到安全切点自动退回单进程，不用管
- **线程数 8** 是实测最优（混合架构 CPU 加线程反而更慢），别乱动
- **同音字**：ASR 偶有同音错误，渲染流程会按上下文自动校正，成品引语直接正确；关键处用画面截图交叉核实
- **弹幕**：接口给的是热门池（约数百~三千条）不是全量；笔记里的弹幕精选只放"梗刷屏/观点反驳/实用指引/高赞神评"四类
- **AI 字幕**：不是每个视频都有、且需登录 Cookie；没有就靠 whisper 转录兜底
- **大文件不入库**：模型/工具链/产物全在数据根（§3.4），仓库只含代码与模板

## 8. 安全与免责

- 本项目使用 bilibili **非官方 API** 接口，仅供个人学习研究，与 bilibili 官方无关联；请遵守用户协议、勿高频请求
- `bili-cookie.txt` 已被 .gitignore 排除且位于数据根（仓库外）；请勿提交或外传
- 第三方组件均由 setup-media 引导你自行下载：whisper.cpp / Silero VAD（MIT）、ffmpeg（LGPL/GPL）、yt-dlp（Unlicense）——归属与许可见 `NOTICE`

## 9. 开发

```
server.js / media.js / bili.js     # MCP 服务器 + 媒体流水线 + B站 API（零 npm 依赖）
paths.js / zh-conv.js              # 数据根解析 / 繁→简转换
scripts\                           # doctor、setup-media、analyze、render-notes、serve-notes、测试…
templates\                         # 五模板骨架 + tsGal 运行时
OUTPUT-STANDARDS.md                # 输出规格（路线/模板/深度，Q1–Q11 定稿）
PRACTICE-NOTES.md                  # 作业手册（判型规则/标准作业/踩坑清单）
```

- 测试：`npm test`（三套回归：media 纯函数 / tsGal / 渲染器）
- 三文档分工：**OUTPUT-STANDARDS=规格**（输出应该是什么）｜**PRACTICE-NOTES=作业**（怎么干）｜**CHANGELOG=版本史**（含验证记录）
- 版本规则：semver——feature=minor、fix/docs=patch、破坏性调整=major
