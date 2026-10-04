# B站视频内容理解流水线 · 技术调研笔记

> 环境：Windows 11 / Node 24 / whisper.cpp v1.9.2 BLAS (whisper-cli.exe) / ggml-small.bin / i9-14900HX (24C32T) / 16GB RAM / CPU-only
> 调研日期：2026-10-02 ｜ 约束：仅调研与文档，未下载/安装/改配置

---

## A. whisper.cpp 提准 / 提速最佳实践

### A1. `--prompt` 领域词偏置

- **机制**：`--prompt` 是 initial prompt，作为文本上下文 token 注入解码器，最多占 `n_text_ctx/2`（默认 224 tokens，约 112 个中文字）。默认只影响开头若干段；`--carry-initial-prompt` 可让 bias 全程携带（v1.8+ 新增，v1.9.2 可用）。[README](https://github.com/ggml-org/whisper.cpp/blob/master/README.md) [cli.cpp 源码](https://github.com/ggml-org/whisper.cpp/blob/master/examples/cli/cli.cpp)
- **中文效果**：有真实收益但不如英文显著。主要纠正：同音字、术语、专有名词、数字格式；对口音/杂音效果有限。[openai/whisper #1595 同音字讨论](https://github.com/openai/whisper/discussions/1595)
- **词表写法建议**（按收益排序）：
  1. **视频标题+简介中的关键词**（免费来源，效果稳定）：如视频讲 RISC-V，就写「RISC-V 流水线 分支预测 缓存 一致性」
  2. **UP主惯用术语/中英混用习惯**：ASR 常把英文术语写成中文同音词，prompt 提供正确写法可显著改善
  3. **从已转录文稿中提取的高频实体**（二次 pass）：先跑一遍 small，统计词频，把高频专名喂回 prompt 再跑一遍
  4. **正确的数字/单位/标点样式**：如「百分之三」「3%」「第 3 章」
- **写法**：prompt 写成自然语句而非纯词表（"本视频讲解 RISC-V 处理器设计，涉及流水线、分支预测、缓存一致性、TLB 等术语"），比纯列表 bias 效果更好；控制在 50~100 字，避免占用过多 context 挤压音频 token。
- ⚠️ **Windows 中文参数坑**：PR [#3610](https://github.com/ggml-org/whisper.cpp/pull/3610)（v1.9.x）为 Windows CLI 增加了 UTF-8 manifest，v1.9.2 一般已含此修复；但若 prompt 中文乱码/截断，先确认该 PR 已合入（或用 `@response-file` 参数文件方式传参，规避命令行编码问题——v1.9.2 的 cli.cpp 支持 `@file` 逐行参数）。PR [#3592](https://github.com/ggml-org/whisper.cpp/pull/3592) 修了 UTF-8 分段截断问题。
- **建议**：把领域词偏置做成流水线自动环节——从 B站 meta.json（标题/简介/分区）自动生成 prompt，无需人工维护词表。

### A2. `-t/--threads` 与 BLAS 后端

- **关键点**：BLAS 后端（你环境有 `ggml-blas.dll` + `libopenblas.dll`）只加速 **encoder**（mel→encoder 矩阵乘）；decoder 的逐 token 采样走 whisper 自己的 ggml 线程池，受 `-t` 控制。`-t` 过大时 decoder 线程同步开销增大，**可能出现性能下降甚至结果不稳定**（ggml-org/whisper.cpp#1282 [奇怪性能行为](https://github.com/ggml-org/whisper.cpp/issues/1282)）。
- **合理取值**：i9-14900HX = 8 P核 + 16 E核（24C32T）。建议 `-t 8~12` 作为起点；`-t` 超过物理核数（尤其超线程数）无益。P核全速跑 8 线程是甜点；E核更适合后台并行处理多个视频（用 `-p` 多进程分视频并行，每个进程 `-t 8`，不要单进程 24 线程）。
- **BLAS 与线程数关系**：OpenBLAS 自己有线程池（`OPENBLAS_NUM_THREADS`，Windows 上随 libopenblas.dll 环境变量控制），与 whisper 的 `-t` 线程池是两套。建议显式设置 `OPENBLAS_NUM_THREADS=8`、whisper `-t 8`，避免线程超订导致 thrashing。README 明确 BLAS 编译仅加速 encoder。
- **实测优于理论**：用 `whisper-bench.exe -m ggml-medium.bin -t 4,8,12,16` 快速扫一遍 encoder 耗时，成本极低（本地、无下载）。README 提供 [`scripts/bench.py`](https://github.com/ggml-org/whisper.cpp/blob/master/scripts/bench.py) 做参数扫描。
- **Windows 线程节流**：ggml 会尝试给计算线程 `THREAD_PRIORITY_HIGHEST`/`THREAD_MODE_BACKGROUND` 以避免 Windows 节流（[ggml-cpu.c](https://github.com/ggml-org/whisper.cpp/blob/master/ggml/src/ggml-cpu/ggml-cpu.c)），保证进程不被电源管理降频即可；笔记本需接电源+高性能电源计划。

### A3. VAD 参数

- **参数清单**（v1.9.2，cli.cpp 默认值）：`--vad` 开启；`--vad-model`/`-vm` Silero ggml 模型路径（约 864KB，如 `ggml-silero-v6.2.0.bin`）；`-vt` 语音概率阈值（默认 0.5）；`-vspd` 最短语音 250ms；`-vsd` 最短静音 100ms（低于此时长不切段）；`-vmsd` 单段最长（默认无限）；`-vp` 段首尾 padding 30ms；`-vo` 段间重叠 0.1s。
- **对错词率的影响**：VAD 最大收益是**消除非语音段幻觉**——B站视频片头 BGM、转场黑屏、讲师停顿时 whisper 会编造文字或复读训练数据片段；VAD 过滤静音/BGM 后这类幻觉大幅减少。段边界裁剪可能导致吞字/句首尾错词，`-vp 200`（padding 提到 200ms）可缓解，代价是少量静音混入。
- **对分段的影响**：VAD 决定送入 whisper 的音频段落，进而影响时间戳分段粒度；`-vsd 100~300ms`（提高到 300ms 可合并短停顿，减少碎段）；`-vmsd 20~30s` 可防超长段（默认不限长，长段会降低时间戳精度）。
- **对流水线的意义**：长视频（>30min）建议开 VAD：处理时长可下降 20~50%（BGM/静音占比越高收益越大），且消除幻觉对后续总结质量是纯收益。
- 模型获取：`models/download-vad-model.sh silero-v6.2.0`（[README VAD 节](https://github.com/ggml-org/whisper.cpp/blob/master/README)）；约 864KB，属于"小文件"，符合本项目约束。

### A4. ggml-medium 中文相对 small 的提升

- **公开基准有限**：whisper 官方 Common Voice/CV11 数据集上 medium 多语言 WER 相对 small 平均降低 20~30%（具体比例依语言而异）；中文（zh）在 Common Voice 等数据集上 medium 相对 small CER 通常下降 10~20%（量级），**不存在广为引用的"中文标准基准表"**。[OpenAI Whisper 论文](https://github.com/openai/whisper) / [Hugging Face whisper.cpp 模型仓](https://huggingface.co/ggerganov/whisper.cpp)
- **实测建议**：medium（1.5GB 磁盘 / ~2.1GB RAM）在你 16GB RAM + CPU BLAS 环境可跑，但速度约为 small 的 1/3~1/4。折中方案：**long transcript 分段后按段落用 medium 复检错误率高的段**，或对关键章节（开头、结论）用 medium。`whisper-bench.exe` 只测 encoder，不反映 WER；需拿一段真实 B站视频人工抽检。
- **量化提速**：可先跑 `whisper-quantize`（如 q5_0）再跑 medium，CPU 上提速明显、对中文精度影响通常 <1%~3%（依模型/音频而异）。
- **另一个选项**：large-v3-turbo（参数少于 large-v3，速度接近 medium，精度接近 large），但模型文件约 1.6GB，需下载（本任务约束下仅记录，不下载）。

### A5. 中文常见错误模式与缓解手段

| 错误模式 | 表现 | 缓解 |
|---|---|---|
| 同音字 | 技术术语/人名被写成同音字（如"卷积"→"捐计"） | `--prompt` 注入正确写法 + 标题关键词 |
| 中英混杂 | 英文术语被转写为中文（"transformer"→"穿斯佛默"） | prompt 提供英文原文（whisper 对英文 token 更敏感） |
| 数字/单位 | 百分比、型号、日期出错 | prompt 给出正确格式样例；后处理正则校正 |
| 幻觉 | 静音/BGM 段编造文字、复读 | `--vad` 开启 + `--suppress-nst`（抑制非语音 token） |
| 口语重复 | "然后然后""就是就是" 不分 | 后处理去重（流水线 LLM 总结时会自然吸收） |
| 标点缺失/全角半角混乱 | 中文标点缺失或中英标点混用 | `-l zh` + prompt 样例；HTML 总结层重新排版，不必纠结转录标点 |
| 分段截断 | 中文 UTF-8 字符在段边界被切开 | 升级到 v1.9.2+（含 #3592 修复），或后处理合并段落 |

- 其他有效手段：`--language zh`（强制，避免 auto 误判）；`--best-of 5`（greedy 采样多个候选，CPU 上开销可控）；`--temperature 0` + 默认 fallback；`--print-confidence` 观察低置信段落。

### A6. 可直接落地的建议清单（A 节）

- [ ] prompt 自动生成：从 `meta.json` 的 `title/desc` 提取 3~8 个关键词 + 1 句自然语描述，加 `--carry-initial-prompt`。[README](https://github.com/ggml-org/whisper.cpp/blob/master/README.md)
- [ ] 线程基线：`-t 8` + `OPENBLAS_NUM_THREADS=8`；用 `whisper-bench.exe` 实测 6/8/10/12 线程，选最优值写入流水线配置。[bench 说明](https://github.com/ggml-org/whisper.cpp/blob/master/scripts/bench.py) [#1282 线程异常](https://github.com/ggml-org/whisper.cpp/issues/1282)
- [ ] 多视频并行用 `-p 1` 多进程 × 每进程 `-t 8`（避免单进程 24 线程超订）；E 核跑低优先级批处理。
- [ ] 下载 Silero VAD 模型（~864KB，小文件）接入 `--vad -vm ... -vp 200 -vmsd 25`，BGM/静音多的视频默认开启。[VAD README](https://github.com/ggml-org/whisper.cpp/blob/master/README) [silero-vad](https://github.com/snakers4/silero-vad)
- [ ] 错误抽检机制：转录后用 `--print-confidence` 标记低置信段落，交由总结阶段二次人工/LLM 复核。[#3592 UTF-8 截断修复](https://github.com/ggml-org/whisper.cpp/pull/3592) [#3610 Windows UTF-8 manifest](https://github.com/ggml-org/whisper.cpp/pull/3610)
- [ ] medium 模型仅对"高价值段落"（结论/摘要段）二次转录，或量化（q5_0）后再跑；全片跑 medium 在 CPU 上性价比低。
- [ ] 中英混杂场景优先保证 prompt 中术语英文原文写法；参考 [faster-whisper-GUI Prompt/Hotwords 文档](https://github.com/CheshireCC/faster-whisper-GUI/releases/tag/0.8.0)（faster-whisper hotwords 机制与 whisper.cpp prompt 类似，可对照）。

---

## B. 视频内容总结的输出形态设计

### B1. 课程/讲座类笔记结构

- **Cornell Notes（康奈尔笔记法）**：三区结构——右侧主笔记区（要点+板书）、左侧提示栏（关键词/问题）、底部总结栏（2~3 句）。经典出处：[UNCW Cornell Note System](https://people.uncw.edu/kozloffm/CornellNoteSystem.pdf)、[RRC 图书馆 Cornell System](https://library.rrc.ca/ld.php?content_id=36110370)。适合逐段有讲解的课程视频。
- **段落大纲 + 关键板书截图组合**：按时间戳分章节（H2/H3），每章节下：① 讲解要点列表 ② 关键板书/幻灯片截图（锚定该段时间戳）③ 原话摘录（高亮）。这是 B站学习区笔记的主流形态。
- **时间轴导航**：HTML 侧边或顶部目录，每项带时间戳锚点，点击 seek 到视频对应位置（B站播放器 `?t=` 参数或本地播放器协议）。
- 推荐结构层级：`视频元信息 → 一句话主旨 → 章节大纲（含时间戳）→ 每章节：板书截图 + 要点 + 原文引用 → 全文转录（折叠/可展开）→ 术语表 → 相关视频`。

### B2. 视频速览/资讯类总结结构

- **论点-论据-时间线**三件套：① 核心论点（UP主主张什么）② 论据（数据/案例/引用来源）③ 时间线（事件发生顺序，带时间戳）。
- B站资讯/杂谈类视频常配**关键帧画廊**：抽取 8~20 张关键帧做缩略图网格，标注时间戳，配合段落文字说明。
- 另一种常见形态是**「一句话结论 + 分点速览卡片」**：每张卡片 = 论点一句话 + 依据一句 + 时间戳链接，适合快速消费。
- 双栏/卡片式 HTML 排版：左栏文字要点、右栏对应画面截图；移动端降为单栏。

### B3. 转录文稿驱动的关键帧选择（现成做法）

- **确实有成熟做法**：核心思路 = "转录文稿分段 → 段落语义相似度聚类 → 每簇取代表段落 → 在该段落时间区间内做视觉场景检测/取帧"，而非纯等间隔抽帧。
- 相关项目/论文：
  - **slidecap**（PyPI）：讲座视频幻灯片捕获/去重工具，按幻灯片变化抽帧并去除重复幻灯片。[pypi.org/project/slidecap](https://pypi.org/project/slidecap/)
  - **Prerak-Sanghvi/Video-Summarizer**：场景切分（PySceneDetect）+ Whisper 转录 + 关键帧抽取 + LLM 总结，输出结构化 HTML 报告，CPU 可跑。[GitHub](https://github.com/Prerak-Sanghvi/Video-Summarizer)
  - **ethnn-b/vidmcp**：MCP 服务器，用 FFmpeg 抽帧 + Whisper 转录，供下游消费。[GitHub](https://github.com/ethnn-b/vidmcp)
  - **lezhdz98/Video-Analyzer-AI**：视频分析（帧抽取+转录+摘要）参考实现。[GitHub](https://github.com/lezhdz98/Video-Analyzer-AI)
  - **Making Short-Form Videos Accessible with Hierarchical Video Summaries**（arXiv 2402.10382）：分层视频摘要，转录驱动分段后为每段配关键帧，学术上验证了"文稿驱动选帧"路线。[ar5iv](https://ar5iv.labs.arxiv.org/html/2402.10382)
- 落地启发：本流水线已产出 `transcript.json`（带时间戳分段）+ `frames/`（等间隔 kf_*.png），可升级为「段落聚类 → 段落时间区间内重抽帧（scene detection 或固定间隔 2~3s）→ 取该区间视觉熵最高/最清晰的一帧」。当前的等间隔抽帧是可用的基线。

### B4. HTML 图文笔记常见排版要素

- 顶部元信息区：封面、标题、UP主、时长、发布日期、分区标签。
- 目录/大纲（带时间戳锚点，可展开/收起）；章节正文 = 要点列表 + 嵌入截图（`<figure>` + figcaption 带时间戳说明）。
- 可折叠全文转录（`<details>` 默认收起）；术语表；转录置信度可视化（低置信段落黄色/红色底纹，`--print-confidence` 输出直接映射）。
- 链接回源：B站视频链接、参考文献；响应式：图片自适应宽度，侧边目录移动端折叠为顶部下拉。

### B5. 可直接落地的建议清单（B 节）

- [ ] 课程类默认 Cornell 变体：三栏 HTML（提示栏 | 主笔记 | 摘要），主笔记内嵌 `kf_*.png` 截图与时间戳。[Cornell 参考](https://people.uncw.edu/kozloffm/CornellNoteSystem.pdf)
- [ ] 资讯/速览类默认「论点-论据-时间线」：`meta.json` 的 title/desc 供论点生成，`transcript.json` 分段供时间线。
- [ ] 关键帧策略升级：转录段落聚类 → 在段落时间区间内重抽帧（ffmpeg 场景检测）→ 取代表帧替代纯等间隔；参考 [slidecap](https://pypi.org/project/slidecap/)、[Video-Summarizer](https://github.com/Prerak-Sanghvi/Video-Summarizer)、[arXiv 2402.10382](https://ar5iv.labs.arxiv.org/html/2402.10382)。
- [ ] HTML 模板要素：元信息头、时间戳目录、章节图文块、折叠转录、术语表、置信度底纹、B站回链。
- [ ] 复用已有资产：`output/<BV>/frames/frames-gallery` 可直接作为 HTML 笔记图库区，无需重复抽帧。

---

## C. B站相关开源工具

### C1. 值得借鉴的 B站总结/笔记开源项目

- **ViNote**（zrt-ai-lab/ViNote）：DeepSeek Harness SDK 驱动的开源视频知识 Agent，串联 YouTube/Bilibili 检索、下载、转写与笔记生成，支持视频问答、知识卡片、思维导图；FastAPI + React，SQLite 会话恢复。**与本流水线架构最接近，参考价值最高**。[GitHub](https://github.com/zrt-ai-lab/ViNote)
- **bilinote**（baisiyi/bilinote）：Go 实现的 Bilibili 视频笔记工具。[pkg.go.dev](https://pkg.go.dev/github.com/baisiyi/bilinote)
- **bilibili-summary-android**（wzn99）：Android 应用，BV 号输入 → 字幕提取/音频转录 → 章节时间线 → 稍后再看批量总结，流程设计可借鉴。[GitHub](https://github.com/wzn99/bilibili-summary-android)
- **caption-fetcher-mcp**（JorkeyLiu）：MCP 服务器，专门获取 YouTube/Bilibili 字幕，可作为本 MCP 字幕能力的参考实现。[GitHub](https://github.com/JorkeyLiu/caption-fetcher-mcp)
- **bilibili-sub-cli**（avldya）：B站视频字幕提取 CLI，与 skills 搭配。[GitHub](https://github.com/avldya/bilibili-sub-cli)
- **bilibili-video-summary**（bfftp0502）：B站视频总结 skill，含完整的 **B站 API 调试参考文档**（本调研 C2 节的主要来源）。[GitHub](https://github.com/bfftp0502/bilibili-video-summary)
- **bilibili-summary-skill**（baikemark）：B站视频总结 skill（SKILL.md 形式）。[GitHub](https://github.com/baikemark/bilibili-summary-skill)
- **vidmcp / Video-Summarizer / Video-Analyzer-AI**：见 B3 节，通用视频理解流水线参考。[vidmcp](https://github.com/ethnn-b/vidmcp) [Video-Summarizer](https://github.com/Prerak-Sanghvi/Video-Summarizer) [Video-Analyzer-AI](https://github.com/lezhdz98/Video-Analyzer-AI)
- **bilibili-game-review-analyzer**（PyPI）：B站游戏评论区分析工具（弹幕/评论向，补充视角）。[pypi](https://pypi.org/project/bilibili-game-review-analyzer/)

### C2. B站 AI 字幕接口现状（能否无登录拿到）

- **核心结论：匿名/无登录拿不到 AI 字幕**。B站 API 接口 `api.bilibili.com` 的字幕相关接口需要登录 Cookie 或 WBI 签名；无登录时通常返回空或被风控（-412/-403）。[bilibili-video-summary API 参考](https://github.com/bfftp0502/bilibili-video-summary/blob/main/bilibili-video-summary/references/api.md)
- 关键接口（需登录/WBI）：
  - `GET /x/web-interface/view?bvid=` 视频信息（**无需登录**，返回 aid/cid/title/duration 等 meta.json 数据源）
  - `GET /x/player/wbi/v2?bvid=&cid=` 字幕轨列表（**需 WBI 签名**，返回 `data.subtitle.subtitles[]`，字段 `lan`（如 zh-CN / ai-zh）、`subtitle_url`、`ai_status`（0=无 AI 字幕，1=有，2=生成中））
  - `GET /x/player/v2?bvid=&cid=` 旧端点（部分情况可用，无需 WBI）
  - AI 字幕专用 CDN：`aisubtitle.hdslb.com/bfs/ai_subtitle/...`，**auth_key 限时有效（分钟级）**，URL 不能截断，需 Referer + UA 头下载
- **WBI 签名机制**（v2 接口必需）：从 `GET /x/web-interface/nav` 取 `wbi_img.img_url/sub_url`，按 MIXIN_KEY_ENC_TAB 重排拼接取前 32 字符得 mixin_key，对参数做字典序 urlencode 后计算 `w_rid=md5(query+mixin_key)`。[API 参考文档](https://github.com/bfftp0502/bilibili-video-summary/blob/main/bilibili-video-summary/references/api.md)
- **登录态获取路径**（按侵入性排序）：① 匿名（meta.json 够用）② Netscape 格式 cookies.txt（浏览器扩展导出）③ yt-dlp `--cookies-from-browser chrome`（Chrome 登录态，可静默提取不开浏览器）④ Chrome 9222 调试端口 CDP 抓页面加载的字幕 CDN URL。
- **对本流水线的意义**：当前 `bilibili-mcp` 的 `status` 显示 `cookieConfigured: false`（无登录态），AI 字幕链路不可用；**当前设计是正确的降级路径**——用 yt-dlp 提取音频 + whisper.cpp 本地转录，不依赖登录态，完全符合"无登录可用"的约束。若未来接入 Cookie，可将 AI 字幕（成本近零、准确率通常高于 whisper small）作为优先数据源，whisper 转录作为兜底。
- ⚠️ API 稳定性提示：B站字幕接口为非公开/非稳定接口，参数与鉴权方式（WBI）会随时间变化；建议将字幕获取封装为可切换的数据源适配器（AI 字幕 → yt-dlp+whisper），避免硬编码。

### C3. 可直接落地的建议清单（C 节）

- [ ] **短期**：维持现状——yt-dlp 提取音频 + whisper.cpp 转录，不依赖 B站登录态；`cookieConfigured: false` 时走此路径是设计正确。
- [ ] **中期**：读取 [bilibili-video-summary API 参考文档](https://github.com/bfftp0502/bilibili-video-summary/blob/main/bilibili-video-summary/references/api.md)，实现 WBI 签名 + 字幕轨探测接口，若 `ai_status=1` 且 Cookie 可用，则直接取 AI 字幕（body 数组：`{"from":41.16,"to":42.9,"content":"..."}`），与 whisper 转录对比后择优。
- [ ] **字幕获取适配器抽象**：数据源优先级 = AI 字幕（登录态）> 投稿字幕（登录态）> yt-dlp+whisper（无登录，当前）；任一源失败降级到下一源。
- [ ] 借鉴 [ViNote](https://github.com/zrt-ai-lab/ViNote) 的笔记生成环节（知识卡片/思维导图/问答）与 [caption-fetcher-mcp](https://github.com/JorkeyLiu/caption-fetcher-mcp) 的字幕获取接口设计。
- [ ] 关注 API 风控（-412/-403/-352）：无 Cookie 避免高频请求，优先走 `view` 接口；弹幕/评论作为辅助信号（本 MCP 已有 `danmaku-peek.mjs`），补充转录未覆盖的观众热点作为总结旁证。
