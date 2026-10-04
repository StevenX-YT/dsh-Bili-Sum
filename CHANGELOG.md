# CHANGELOG — bilibili-mcp 版本历史

> 版本规则（三轨）：
> 1. **项目整体**（本文件主版本线，未来 DSH 插件对外版）：semver——feature=minor、fix/docs=patch、破坏性调整=major
> 2. **tsGal runtime**（templates/gallery-runtime.js）：组件独立版本（v1画廊→v2空降→v3小窗→v3.4字幕→v3.6去字幕），只在本文件附注，不与项目版本绑定
> 3. **里程碑名**（三期提速/A-D期）：changelog 条目分组用，不是版本号

## [3.1.0] — 2026-10-04

Q3② 质量路线接入 medium（用户拍板：**条件接入**；A/B 依据 `reports/2026-10-04-medium-ab-report.md`——实体词修复 7.5/11、耗时仅 2.27×、标点/分段跃升）。

### Added
- **zh-conv.js 源级繁→简**：常用字映射表，transcribe/analyze 转录落盘前统一转简（medium/large 繁体输出场景；简体幂等；表外生僻字仍由 agent 渲染侧静默校正兜底）
- 回归测试 +16 项（双进程模型门控 7 项 + toSimplified 9 项），media 套件 26→42 全绿

### Changed
- **shouldUseDual 按模型门控**：非 small/base 一律单进程（medium/large 单进程峰值 ~2GB，双进程在 8GB 级机器必 OOM——A/B 报告 §四工程发现；env/显式参数也不例外）
- **质量档 medium 默认**（OUTPUT-STANDARDS §2.1/§5/§7 已修订并记变更）：analyze/transcribe `model=medium` 即走质量路线；模型 1.43GB 需自放数据根 `tools/models/`（setup-media 默认不下载）
- server.js 工具描述同步（model 参数质量档说明）；package.json files 白名单补 zh-conv.js

### 验证
- 三套回归 42+24+37 全绿；medium A/B 全量数据与逐项对照见报告；繁→简转换以 A/B medium 实测输出句为用例锁定

## [3.0.0] — 2026-10-04

插件化轮：dsh-Bili-Sum 正式插件包（GitHub 发布）。semver major=数据根迁移+包名+patch 重写（破坏性调整）。

### Added
- **paths.js 路径解析单一事实源**：`PKG_ROOT`（代码资产，只读）/ `DATA_ROOT`（运行时数据，可写）分离；`BILI_DATA_ROOT` 由 dsh 插件 patch 经 `!!js` 自动注入（`<dsh家目录>\bili-sum`）；未设置时回退包目录——老布局完全兼容
- **doctor.mjs 安装自检**：node/数据根可写/ffmpeg/whisper/模型/yt-dlp/silero/cookie 八项检查，exit 0=核心就绪；MCP `status` 工具同步输出 paths（pkgRoot/dataRoot/isolatedDataRoot）
- **setup-media.ps1 数据根化**：去除硬编码本机绝对路径（发布残留）；新增 Silero VAD 段与 yt-dlp 段；已有文件自动跳过
- **cordis.patch.yml `!!js` 零绝对路径版**：挂载时从 profile 上下文运行时解析（`profileContext.dir` 定位包、`dshHomePath('bili-sum')` 定位数据根）——发布文件零本机路径，任何机器一句安装
- **package.json → `dsh-bili-sum@3.0.0`**：`files` 白名单控制安装内容（output/tools/bin/archive-subtitles/reports/HANDOFF 不入包）；`npm test` 串跑三套回归
- README 安装节重写（一句安装/数据根说明/安全与免责）；.gitignore 增补内部文档排除（HANDOFF.md / reports/ / archive-subtitles/）

### Fixed
- **dl.mjs 硬退出崩溃**：HTTP 错误路径 `process.exit()` 触发 libuv 断言（`uv async.c:94`，进程 0xC0000409 且 stdout 丢失）→ 改为仅设 `process.exitCode` 自然退出
- **Silero VAD 下载源失效**：ggerganov/whisper.cpp 仓库路径全部 404（VAD 模型已迁出）→ 改用 canonical 仓库 `ggml-org/whisper-vad`（上游 `download-vad-model.sh` 实证；实测 885,098 字节与存量一致）
- doctor 显示 bug：whisper model 存在时 detail 误显「未找到」（`diag.model` 已是路径字符串却再取 `.path`）

### Changed
- 路径解耦落点：media.js（TOOLS_DIR/OUTPUT_DIR/YTDLP_TMP/host-diag）、bili.js（YTDLP/cookie 双候选回退）、render-notes.mjs（目录解析先查数据根 output）、test-render.mjs、fetch-ytdlp.mjs、check-cookie.mjs
- server.js：`SERVER_INFO` → 3.0.0；status 描述与输出更新
- bundle 注册名 `@local/bilibili-mcp` → `dsh-bili-sum`（MCP `serverName` 保持 `bilibili`，工具名 `mcp__bilibili__*` 不变）
- 安装机制实证（P0 报告 `reports/2026-10-04-P0-dsh-install-mechanism.md`）：install 支持 registry/path/git/tarball 四源，`github:owner/repo` 简写原生可用

### 验证记录（本条目时点）
- 三套回归 26+24+37 全绿；doctor 老布局/插件布局双测通过（插件布局 fresh 正确报缺+fix 指引）
- 本地 path 安装实测：remove 旧 bundle → install_bundle → junction → `!!js` patch 挂载成功（MCP v3.0.0 启动，`dataRoot=~\.dsh\bili-sum`，`isolatedDataRoot=true`）→ analyze 33s（1:40 视频，VAD 生效）→ render 41.7KB → present 交付
- 发布文件零本机路径：全库 grep，机器路径仅存在于 gitignore 排除的内部文档
- P5 结果（2026-10-04）：仓库 **https://github.com/StevenX-YT/dsh-Bili-Sum**（public，main，作者 StevenX-YT）已发布；**「一句安装」验收通过**：`install_bundle` tarball spec → `application: applied` → MCP 从 `profile\node_modules\dsh-bili-sum`（发布包，非工作区）启动 v3.0.0，数据根/工具链/登录态全通；最终安装态全链路复验 analyze 39s→render 42.4KB（stream:true）→present；三套回归 87 项全绿；SESSDATA 真值与机器路径扫描双 0 命中。过程排障记录：①`github:` 简写受阻于本机宿主 PATH 指向的损坏 E:\Git（缺 git-remote-https.exe）——已装用户域 MinGit 2.56 修复会话环境，重启 Harness 后 host 侧生效；②pnpm 对 URL tarball 存可复现的缓存污染（MISSING_TARBALL_INTEGRITY），本地 tarball spec 为等效绕行（README 安装节已录排查法）；③残留 junction 挡 rename 用 `rmdir`（只删链接）清除

## [2.1.2] — 2026-10-04

上线自检（S1–S3）：修复 2 个真 bug + 发布安全资产齐备（含一次备份恢复演练，见 Fixed 第三条）。

### Fixed
- **BUG-1**：README 版本号残留 2.0.0 → 对齐 2.1.2（S1.4 版本一致性扫描发现）
- **BUG-2**：content.json/bundle.json 带 UTF-8 BOM（Windows 生态常见）时渲染器 JSON.parse 崩溃 → 三处读取点加 BOM 剥离防御（S2.3 错误路径测试发现，复测 exit=0）
- **自伤修复**：自检期间 PowerShell 未指定 UTF-8 编码导致 4 文件中文乱码——从 S0 全量备份（bilibili-mcp-backup-v2.1.1-full）恢复并以显式 UTF-8 重放本轮改动；教训：**含中文文件禁用 PS 默认编码读写，一律用 edit 工具或 [IO.File] 显式 UTF-8**

### Added
- `.gitignore`：排除 bili-cookie.txt / models / ffmpeg / whisper / yt-dlp / output / 日志——发布仓库干净
- `LICENSE`（Apache-2.0 全文，用户拍板）+ `NOTICE`（第三方归属：whisper.cpp MIT / Silero VAD MIT 已核实 / ffmpeg / yt-dlp / B站免责声明）
- README 发布说明章节（插件代号 dsh-Bili-Sum、本地安装型声明、安全与免责）

### 自检记录
- S1 静态：26 文件语法 0 失败；测试 24+26+37 全绿；成品 token 0 残留；SESSDATA 值零泄漏；22 项文档引用全部存在
- S2 联调：Cookie 有效；全新素材端到端通过（判型→bg→brief→render→F2 区块消失验证）；错误路径优雅（坏 BV 可读报错/缺字段降级/BOM 防御）；注入幂等；serve-notes 正常；后台链路正常

## [2.1.1] — 2026-10-04

D 期收官：F1/F2 对齐修正 + 文档体系收口。

### Fixed
- **F1：课程框架表补「板书帧」列**（OUTPUT-STANDARDS §4.1 实装遗漏）——schema 增 framework[].frame，表内渲染可点击缩略图；两份课程成品补图重渲染（等比数列 8 帧/根的分布 7 帧入表）
- **F2：空区块统一整块消失**（对齐规格 §6.5「区块可整块省略不硬凑」）——digest/lecture/tutorial/share/info 全部内容驱动区块 token 化（含 h2 同生同灭），消灭「标题挂着一个『无』」的观感；有内容的区块（如教程资源指引）照常显示

### Changed
- F3 裁决：名片/TL;DR/快讯维持卡片式不加标题（轻量模板哲学，Q 区用户拍板 a）
- PRACTICE-NOTES 增补模板速查表（五模板骨架/schema/硬保底一览）与 F1/F2 经验

## [2.1.0] — 2026-10-04

C 期：多模板体系补全（每模板一真实素材实战验证）。

### Added
- **教程模板**（note-skeleton-tutorial.html + --template tutorial）：任务名片/一句话速查/前置检查清单/分步操作卡（操作+目的+**验证 verify 硬保底**）/常见报错/完成验证/工具清单/学习信号；实战：Windows 自动部署 P2（9:57，10 步操作卡）
- **分享/杂谈模板**（note-skeleton-share.html + --template share）：TL;DR/时间线亮点/语录摘录/有用信息卡/轻量弹幕——Q&A/术语/归因表不适用整块省略；实战：上饶演唱会 vlog（30:24）
- **资讯快报模板**（note-skeleton-info.html + --template info）：一句话快讯/5W1H 表/关键数据面板/事件时间线/各方反应/背景一页；实战：美伊谅解备忘录速报（1:02）
- **讲解模板 C4 升级**（向后兼容）：核心论点置顶（content.thesis）/论证链（content.chain：论点|依据|时间戳按逻辑排序，存在时替换亮点区）/归因表可信度提示行（content.credibility）；实战对照：太子爷评论重渲染
- **判型规则**入 PRACTICE-NOTES（五模板信号映射+回显纪律，Q8①）

### Fixed
- **双进程 OOM 崩溃回退**：并发负载下双 whisper 内存分配失败（~487MB×2）会拖死整个 analyze——runWhisperDual 增加失败回退单进程（dual-failed-fallback-single），实测 30:24 vlog 重跑成功（93s）

### Changed
- render-notes.mjs --template 扩展：digest|lecture|tutorial|share|info；骨架选择按模板映射

## [2.0.0] — 2026-10-03

今日全量交付（A0–B期已完成；C期模板补全将记为 2.1.0，D期文档报告记为 2.1.x）。

### Added
- **提速第一期**：VAD 静音检测默认开（全链路 -29%）+ 幻觉抑制恒开；快速路线 route=fast（定点快取抽帧）；线程基准定论维持 -t 8
- **提速第二期**：下载/转录错峰并行（-25%；实测双流并发被B站CDN掐音频流，必须错峰）；长视频 >30min 自动后台化 + analyze-status.mjs 查进度；SESSDATA 登录态配置并验证（评论可读）
- **提速第三期**：whisper 双进程分块并行（质量门槛 A/B 全过：接缝零损伤/漂移 0.03s/内容+0.08%无损/提速39%）→ 集成默认（≥6min 自动，静音切点缺失自动回退单进程）
- **渲染器化**（治交付慢）：render-notes.mjs——content.json（~60行智力产出）→ 模板填充+直链获取+tsGal注入秒级完成；brief.md 一页简报（analyze 自动生成）；预填引擎（停顿+关键时刻双信号切章，--prefill course|tutorial|share）
- **输出质量规格书 OUTPUT-STANDARDS.md**：三路线定义（快速/平衡/质量，准确度恒定深度分档）+ 模板×路线矩阵 + Q1–Q11 用户拍板定稿
- **课程精讲模板**（note-skeleton-lecture.html + --template lecture）：知识框架表/知识点精讲卡/例题卡（完整解法 steps 硬保底）/老师原话/难点地图（弹幕证据）/学习信号面板；双素材实战验证（24min 快检 + 30:44 全链路）
- 工具：check-cookie.mjs / vad-ab-compare.mjs / dual-compare.mjs / thread-bench-real.ps1 / test-media-pure.mjs（26项）/ test-render.mjs（19项）；Silero VAD 模型（ggml-silero-v6.2.0）
- fetch-stream.mjs 直链获取 3 次重试（治CDN限流抖动）

### Changed
- 双进程自动阈值 480s→360s（7:48 视频实测 -29%）；MCP analyze 增加 route/vad/dual/bg 参数（重启加载）
- 配图策略：内容驱动默认不出图（Q9①，--auto-frames 调试用）
- 交付默认深度=平衡标准档（Q7②）；快速档仅显式指令

### Removed
- **字幕系统整体移除**（用户决定：反复改进无改善）——代码/规范拆出留档 archive-subtitles/（v3.5 完整回退点+拆解代码+测试用例）；附注：tsGal runtime v3.6 即去字幕版

### Fixed
- analyze 引用未定义变量（opts.dual）——语法检查查不出、运行才炸；抽出 shouldUseDual 纯函数+回归测试
- parseWhisperSegments(null) 空值防御
- .ts 徽章缺蓝底致时间戳白字隐形（渲染骨架+模板规范条款防复发）

## [1.0.0] — 2026-10-02

初版：MCP 服务器 8 工具（video-info/danmaku/subtitles/comments/transcribe/keyframes/analyze/status）+ 媒体流水线（yt-dlp/playurl 双通道、whisper 转录、自适应抽帧、弹幕信号）+ tsGal 注入（画廊/空降/小窗）+ 三套渲染规范；宋浩高数/胆巴碑/章北海三份成品实测交付。
