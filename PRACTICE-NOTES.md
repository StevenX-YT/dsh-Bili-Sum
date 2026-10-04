# PRACTICE-NOTES — 实战经验手册（流水线标准作业 + 踩坑速查）

> 来源：2026-10-03 三期提速 + 两次实战（BV1rcar6vExx 评论视频 / BV1YaeN6xEWR 当事人声明）。
> 定位：跨会话开工速查。**三文档分工：HANDOFF=状态（干到哪）、OUTPUT-STANDARDS=规格（输出应该是什么，Q1–Q11 拍板定稿）、本手册=作业（怎么干、有什么坑）**——深度档/模板/路线标准一律以 OUTPUT-STANDARDS.md 为准，本手册只引用不复述。

## 〇、插件布局速查（v3.0.0 起，dsh-Bili-Sum 插件装机后的作业要点）

| 项 | 说明 |
|---|---|
| 数据根 | 运行时数据全在 `<dsh家目录>\bili-sum\`（output/tools/bin/bili-cookie.txt），与插件代码分离；patch 自动注入 `BILI_DATA_ROOT` |
| 安装自检 | `node scripts/doctor.mjs`（exit 0=核心就绪）；MCP `status` 工具输出 paths 同款信息 |
| 工具链安装 | `Set-ExecutionPolicy -Scope Process Bypass -Force; & scripts\setup-media.ps1`（数据根 tools/；已存在自动跳过） |
| 代码位置 | 插件装在 `<profile>\node_modules\dsh-bili-sum\`（junction 或 pnpm store）；模板/脚本走 PKG_ROOT，勿往包目录写数据 |
| 老布局兼容 | 不设 `BILI_DATA_ROOT` 时数据回退代码同目录（源码直跑照旧）；cookie 双候选自动回退 |
| 新踩坑 | ① Silero VAD 模型在 `ggml-org/whisper-vad` 仓库（旧 ggerganov 路径全 404）② dl.mjs 错误路径禁用硬 `process.exit`（libuv 断言崩溃+输出丢失）③ ps1 脚本跑前必须先 `Set-ExecutionPolicy -Scope Process Bypass -Force` |

## 一、双模式作业法（2026-10-03 渲染器化整理）

### 模板速查（v2.1，五模板体系——区块规格以 OUTPUT-STANDARDS §4 为准）

| 模板 | 骨架文件 | content 要点 | 硬保底 |
|---|---|---|---|
| 讲解/评论 digest | note-skeleton.html | thesis/chain/credibility 可选（C4）；框架=摘要+亮点或论证链+QA+术语+章节+归因 | 归因表（敏感必放） |
| 课程 lecture | note-skeleton-lecture.html | framework 可带 frame 缩略图（F1）；knowledge/examples/authorSummary/difficulty/signals/review | 例题 steps 缺失即报错 |
| 教程 tutorial | note-skeleton-tutorial.html | task/quickPath/prereqCheck/steps/errors/tools/signals | 步骤 verify 缺失即报错 |
| 分享 share | note-skeleton-share.html | tldr/timeline/quotes/useful/dm（轻量，Q&A/归因不适用） | — |
| 资讯 info | note-skeleton-info.html | flash/wh/data/timeline/react/background/dm | 5W1H 必含 |

**空区块纪律（F2）**：所有内容驱动区块 token 化——空则整块消失（含 h2），不硬凑「无」占位；有内容才出现。
**例外（F2 批准时约定）**：课程难点地图的「无强证据」说明是**内容**不是占位——弹幕信号不构成难点证据时，照样写 difficulty 条目（evidence 字段说明「听不懂刷屏属开场调侃/无密集信号」等），照常渲染进表格；只有 difficulty 数组完全为空才整块消失。
**配图纪律（F1/Q9）**：digest/share/info 内容驱动默认不出；lecture 框架表行写 frame 字段即出板书缩略图。

### 判型规则（C期，Q8①——自动判断+回显+可覆盖）

| 模板 | 判型信号（标题/简介/转录开场/弹幕） |
|---|---|
| 课程精讲（lecture） | 标题含「讲/课程/第X课/衔接」或学科词；简介「系统讲一下」；转录开场「今天这节课」；弹幕「听不懂/懂了」刷屏 |
| 教程（tutorial） | 标题含「教程/安装/配置/部署/使用」；简介给工具链接/网盘/提取码；转录多操作命令词 |
| 讲解/评论（digest） | 标题观点句式或事件评论；简介一句评论；转录论证词「我认为/其实/关键是」 |
| 分享/杂谈（share） | 标题 vlog/日常/碎碎念/旅行；转录生活化短句密集、无知识结构 |
| 资讯（info） | 标题「速递/快讯/热点/速报」；时长≤5min；转录新闻句式 |

**纪律**：判型后必须向用户回显「识别为：XX 模板（可说 YY 覆盖）」；判错的代价=换模板重渲染（秒级），故默认自动判不询问。

### 快速交付模式（日常默认）

**深度默认=平衡标准档**（Q7②）：条目数按 OUTPUT-STANDARDS §2.2 执行；快速档仅显式指令触发；课程模板默认平衡标准版、例题完整解法为硬保底（Q1①）。

```
1. node scripts\analyze.mjs <链接> --type general [--route fast]     # 分析（几十秒~几分钟）
2. 读 brief.md 一页简报（元信息+关键时刻+弹幕信号+完整转录，一个文件；Q10①）
   课程/教程可先跑预填：node scripts\render-notes.mjs <dir> --prefill course|tutorial|share
   → 拿 _prefill-draft.md 章节草稿改写（Q11③）
3. 写 output/<dir>/content.json（唯一智力产出；schema 见 render-notes.mjs 头注释；
   frames 默认省略=不出配图区（Q9①），有真信息画面才显式给出）
4. node scripts\render-notes.mjs <dir>        # 模板填充+直链获取+tsGal注入，秒级
5. present <dir>/<输出>.html
```

- 与旧流程对比：不逐帧 read_image、不手写 HTML 样板——兔娘视频实测交付链路由 ~9 分钟压缩到 ~3 分钟量级
- 直链限流时渲染器自动 iframe 回退；重跑一次 render-notes 即恢复原生小窗
- 长视频（>30min）analyze 自动后台；查进度 `node scripts/analyze-status.mjs <BV>`
- 双进程阈值 360s（Q6①）：≥6 分钟视频自动启用（静音切点缺失自动回退单进程）

### 调试模式（联调功能/画质争议时用——保留旧全流程）

```
1. analyze 同上
2. read_image 逐帧审查（选帧、校对术语、核实画面证据）
3. 从 templates/note-skeleton.html 手写/改渲染（或直接手写 HTML）
4. & scripts\inject-gallery.ps1 -HtmlPath <笔记.html>（独立注入，便于反复调 runtime）
5. present
```

适用：调试 tsGal/runtime、渲染规范变更、敏感内容需要逐帧核实、用户点名要精修。

## 二、路线与开关速查

| 开关 | 位置 | 作用 |
|---|---|---|
| `--route balanced\|fast` | CLI/MCP | balanced=全片比对抽帧（板书课必须）；fast=定点快取（快速了解） |
| `--no-vad` / `BILI_WHISPER_VAD=0` | CLI/env | 关 VAD（配乐盖人声的混剪/vlog 建议关） |
| `--dual\|--no-dual` / `BILI_WHISPER_DUAL=0\|1` / MCP `dual` | CLI/env/MCP | 双进程分块并行：≥8min 自动、静音切点缺失自动回退单进程；=1 强制（含硬切） |
| `--bg` / MCP `bg` / `BILI_LONG_VIDEO_BG_SEC` | CLI/MCP/env | 后台进程；>1800s 自动 |
| `BILI_PARALLEL_DOWNLOAD=0` | env | 关错峰并行下载（默认开） |
| `BILI_WHISPER_THREADS` | env | 覆盖线程（默认 8，**实测加线程无收益勿乱动**） |
| `model=medium`（MCP/CLI 参数） | quality 档默认转录模型（Q3② 拍板） | 实体词更准+自带标点；实测 ~2.3× 耗时；**强制单进程**（shouldUseDual 按模型门控，防 8GB 机器 OOM）；繁→简已源级内置（zh-conv.js）；模型 1.43GB 自放数据根 `tools/models/` |

三期能力叠层（默认全开）：VAD(-29%) + 错峰并行下载 + 双进程(-39%转录,≥8min) + 长视频后台化。
19:37 课程转录 269s→126s（累计-53%）；**单次运行波动可达 ~30%，报数据用区间不用单点**。

## 三、渲染硬性约定（违反=成品坏）

1. **`.ts` 蓝底徽章样式必须在页面 CSS 里**（骨架/渲染器已带）——tsGal 转链后强制白字，缺蓝底=时间戳隐形（实战踩坑）
2. **`<pre id="transcript">` 必须保留**，行格式 `[MM:SS] 文本`——画廊帧标注取材于此
3. 单文件自包含（file:// 直开），不外链 CSS/JS
4. 敏感争议内容三件套：⚠️阅读提示（content.json 的 `warn`）+ 全程归因 + 归因表（`attribution.other` 写明"对方立场：本视频未呈现"）
5. 不输出勘误表：ASR 错误渲染前**静默校正**，显示结果直接正确
6. **快速模式写 content.json 即可**——样式/结构/注入由 render-notes.mjs 保证，勿手写 HTML 样板；需要偏离模板时才走调试模式

## 四、ASR 静默校正经验（实战样例）

- 同音字：造黃搖→造黄谣 / 戰戰→转转 / 律師喊→律师函 / 慢展→漫展 / 网报→网暴 / 历史函→律师函 / 好奇→（一步）棋 / 大幕→弹幕 / 微根我→vivo没跟我 / 恰谈→洽谈 / 诚述→陈述
- 繁体输出→简体：**v3.1.0 起源级内置**（zh-conv.js，转录落盘前转简；medium 场景 A/B 实测）；表外生僻字仍按本节纪律在渲染侧静默校正
- **画面交叉校正**：视频里的硬字幕/聊天截图是最佳校对源（实战用 kf_009 截图确认"新机上市买不到的是真的"，纠正了"新机上是买不到是真的"）
- 拿不准的断句：按上下文最小改动，不臆造（如"不再再用任何公众支援"→"不再通过任何公众平台"）

## 五、踩坑清单（修过的坑，勿重蹈）

| 坑 | 症状 | 状态 |
|---|---|---|
| 双流并发下载 | 音频流被B站CDN掐死（26KB/s后断连） | ✅ 错峰并行已修；**勿改回同时下载** |
| 直链注入限流 | inject 时 stream fetch failed→iframe回退 | ✅ fetch-stream 3次重试；再不行稍后重注入 |
| analyze 引用未定义变量 | 语法检查过、运行 ReferenceError | ✅ 已修+抽出 shouldUseDual+纯函数测试 test-media-pure.mjs |
| `.ts` 徽章缺蓝底 | 时间戳白字隐形、悬停才显形 | ✅ 骨架自带+模板规范条款 |
| whisper `-p` 直传崩溃 | exit 0xC0000135 | ✅ @response-file 规避（历史） |
| 加线程提速 | 合成基准吹20%，真实音频≤2% | ✅ 维持 -t 8；bench 数据仅参考 |
| 旧转录残留假成功 | whisper 崩溃后复用旧 json | ✅ 先删后跑（历史） |
| 同音字幻觉 | 静音/BGM 段编造文字 | ✅ VAD+suppress-nst（历史） |

## 六、弹幕精选实操（四类，≥3 条才放）

- 梗与刷屏：找密集重复的无害梗（如结尾"懂你意思"连刷）——标注刷屏语境
- 观点反驳：对视频主张的直接质疑（"那不是应该一起打击抵制么"）
- 实用指引：教观众怎么做的（"但凡懂得在闲鱼上卖手机…"）
- 高赞神评：一针见血/反讽名场面（"甲方反手把人卖了"）
- **不放**：打卡、单字复读、人身攻击（攻击性内容在归因表注明"存在质疑声音"即可，不照录放大）
- 争议视频弹幕价值最高：反驳类弹幕是归因表"反方观点"的天然素材

## 七、交付前检查清单

- [ ] 元信息块无省略（缺失写"未提供"）
- [ ] 亮点≥10条且引用逐字、时间戳齐全
- [ ] Q&A 问题行带时间戳，回答区分"视频中提到/延伸思考"
- [ ] 章节区间覆盖全片；广告位单独标注（如有）
- [ ] 敏感内容：阅读提示 + 归因表四栏 + 对方立场明示
- [ ] 配图≤6张、相对路径、竖屏帧网格 minmax(150px)
- [ ] 弹幕精选四类合规、无攻击性放大
- [ ] 折叠转录为简体+静默校正后文本
- [ ] 注入成功（stream 或 iframe fallback 均可交付）
- [ ] present 卡片交付（目录路径聊天里打不开）

## 八、本手册关联文件

- 渲染器：`scripts/render-notes.mjs`（快速模式核心：content.json→HTML+注入，schema 见其头注释）
- 渲染骨架：`templates/note-skeleton.html`（token 版，渲染器的数据源；手工渲染参考）
- 渲染规范：`templates/video-digest.md` / `lecture-notes.md` / `transcript-pretty.md`
- 三期报告：`reports/2026-10-03-phase1-speedup-report.md` / `phase2` / `phase3-dual-whisper`
- 回归测试：`node scripts\test-render.mjs`（渲染器13项）+ `test-tsgal-v2.mjs`（24项）+ `test-media-pure.mjs`（25项）
- 工具：`analyze-status.mjs`（后台进度）/ `check-cookie.mjs`（登录态）/ `vad-ab-compare.mjs` / `dual-compare.mjs` / `thread-bench-real.ps1`
- 样例：`output/BV1YaeN6xEWR/content.json`（快速模式 content 完整样例）
