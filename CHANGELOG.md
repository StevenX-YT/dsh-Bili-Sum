# CHANGELOG — bilibili-mcp 版本历史

> 版本规则（三轨）：
> 1. **项目整体**（本文件主版本线，未来 DSH 插件对外版）：semver——feature=minor、fix/docs=patch、破坏性调整=major
> 2. **tsGal runtime**（templates/gallery-runtime.js）：组件独立版本（v1画廊→v2空降→v3小窗→v3.4字幕→v3.6去字幕），只在本文件附注，不与项目版本绑定
> 3. **里程碑名**（三期提速/A-D期）：changelog 条目分组用，不是版本号

## [3.3.0] — 2026-10-05

新会话流畅性轮（「让新用户流畅使用插件」专项；v3.2.1 配方可见性之后的第二层修复）。**实证驱动**：解剖问题会话 `session-7be58aa2`（新会话「平衡，总结BV…」，16:39 视频跑了 38.5 分钟、119k 输出 token），根因三条全部坐实——

**会话法证结论（session.v4.jsonl.zstd 分帧解码，101 帧→1.9MB）：**
- ✅ v3.2.1 配方本身生效了：agent 第 59 秒就读了 usage 资源、analyze 参数正确
- ❌ **根因①**：mcp-client 默认 `toolCallTimeoutMs=60s`，analyze 机器耗时 283s → 调用被掐断但服务器继续跑 → agent 误判失败进入恐慌排查（查进程/读脚本源码/挂监控 job/重读 bundle）
- ❌ **根因②**：配方只写了「产出什么」没写「过程纪律」——agent 把 debug 模式的帧核验（7 次 read_image）、web_search 校名、逐行错别字校对全部带进了快速交付模式
- ❌ **根因③**：思考无节制——单个 reasoning 块 72,954 字符（逐行校对转录+全文规划），烧光回合预算导致用户被迫输入「继续」

### Added
- **`initialize.instructions` 系统提示词注入（根治层）**：server.js 响应 MCP initialize 时携带 992 字符过程契约，harness 经 `systemPrompt.section(mcp:bilibili)` 注入每个会话（官方通道，32KB 预算）——标准流程四步 + 过程纪律五条反模式（禁查进程/禁读源码/禁复述转录/禁播报/禁 web_search 校名/balanced 档不帧核验）+ 边界声明（只约束过程，不改输出标准）。配方随插件连接走，不依赖 agent 主动读资源
- **analyze 返回体 `next` 字段**：决策点即时指令——前台结果带五步下一步+纪律摘要；后台结果带 analyze-status 查 state 指引。读完 brief 的那一刻是注意力最高点，指令在此处落位
- 描述/手册补【过程纪律】反模式清单（analyze 描述一行版 + usage 手册完整版含实证引用）

### Fixed
- **`toolCallTimeoutMs: 900000`（cordis.patch.yml）**：mcp-client 默认 60s 掐断分钟级 analyze 是恐慌排查连锁的直接触发器；15 分钟覆盖 30 分钟内视频最坏前台耗时（>30min 本就自动转后台即时返回）。注释中记录实证依据
- 重装源从 `%TEMP%` 改为持久路径 `~\.dsh\artifacts\`（TEMP 清理会断档 lockfile 引用——v3.2.1 遗留隐患顺手修掉）

### 验证
- 四套回归全绿：server-usage **20**（+6 项锁定 instructions/纪律/超时）+ media **43** + tsGal **31** + render **47**
- 装机副本冒烟：v3.3.0 / initialize.instructions 992ch 含纪律段 / resources 正常 / patch 含 timeout
- 输出标准零改动：条数区间/硬保底/归因/静默校正全部原样（用户红线）

### 备查
- 备份三重：工作区 `bilibili-mcp-backup-v3.2.1-20261005-pristine` + 装机副本与 tarball 在 `~\.dsh\bili-sum\backups\` + GitHub `6bbbb33`
- 会话解码工具：`_decode-session.mjs`（zstd 帧魔数扫描逐帧解码）——DSH 会话取证可复用

## [3.2.1] — 2026-10-05

修复「新会话配方缺失」bug（HANDOFF 待办 #1，方案 A+B）：新会话 agent 只拿到旧版 analyze 描述（仅「渲染前用 read_image」），无任何交付方法 → 绕过插件管线手写 HTML，成品无模板/tsGal/静默校正。

### Fixed
- **analyze 工具描述内联标准作业（方案 A）**：交付流程（brief.md → content.json → render-notes → present）、判型信号与回显、五模板 content.json 字段全名（通用+lecture/tutorial/share/info）、硬保底（例题 steps/步骤 verify/5W1H/敏感三件套）、Q4 条数口诀（时长四档+1.2×触顶+F2 稀疏）、开关与后台进度——agent 不读工作区文档也能走对管线
- **transcribe 工具描述补防绕过指针**：仅转录稿场景单独用；笔记交付改走 analyze + usage 资源（原描述引导「配合 keyframes 自行总结」正是绕管线入口之一）

### Added
- **MCP resources（方案 B）**：`resources/list`/`resources/read` 实现（capabilities 此前已声明未实现）——`usage://dsh-bili-sum` 返回精简版标准作业手册（流程/判型/五模板 schema/硬保底/Q4/交付检查表）；未知 URI 报 -32002
- **回归测试 `scripts/test-server-usage.mjs`（14 项）**：锁定 analyze/transcribe 描述关键标记与 resources 读写（配方可见性回归——改描述漏标记即红）；server.js 导出 TOOLS/dispatch/USAGE_* 并加 isMain 主模块守卫（与 render-notes.mjs 同模式，import 不再启动 stdio）；npm test 变为四套串跑
- SERVER_INFO/package.json 版本 3.2.0→3.2.1（semver fix=patch）

### 验证
- 四套回归全绿：server-usage **14** + media **43** + tsGal **31** + render **47**
- JSON-RPC stdio 冒烟：initialize(v3.2.1, resources cap) / resources/list / resources/read(2711B markdown) / tools/list(analyze 描述 1877 字含流程) 全通过

## [3.2.0] — 2026-10-04

Q4/Q5/Q6 三轮功能完善 + 后台任务终态改进（实战问题驱动、用户逐轮拍板；3.1.1→3.2.0 按 semver feature=minor）。

### Added
- **Q4 条数与时长感知**：亮点/关键点条数改为**时长分档区间**（<3min / 3-10 / 10-30 / >30min 四档 × 三路线）+ 密度突破条款（触顶 **1.2×**，独立要点三判定、同义必合并）+ 稀疏压缩条款（F2 缺口区块整块省略）；章节改结构自然分段
- **Q4 区块命名模板化**：digest 默认「关键点」、share 默认「时间线亮点」；`content.highlightsTitle` 逐视频自定义；允许跨模板重名
- **Q5 时间锚点统一**：info 时间线时间列修复为可点 `.ts` 徽章（原为裸文本不可跳转——真 bug）；日期类文本不冒充时间戳；info 兼容 `t/ts`、`e/text` 字段名
- **Q5 帧能力扩展**：share/info 时间线行、tutorial 步骤卡支持可选 `frame` 行内缩略图（点击放大）
- **Q5/Q6 图片点击放大（lightbox）**：正文一切配图（框架表缩略图/配图区/画廊/时间线帧/步骤截图）统一点击放大；Q6 修为**铺满视口**（width:96vw，小图接近全屏）；阻止画廊锚点默认跳转（原会新开标签页）
- **Q6 画廊挂载点扩展**（仅三处，模板其余一律不动）：share 语录摘录后、lecture 知识点精讲卡后与例题精解卡后；判定抽为纯函数 `galleryAnchorAllowed`（7 项单测含 4 项反例锁定：老师总结/步骤卡/时间线/无标题全部拒绝）
- **后台任务终态**：analyze 子进程成功/失败回写 `analyze-bg.json`（state/completedAt/failedAt/wallSec/error）；analyze-status 输出终态 **state: running / completed / failed**（显式回写优先，旧任务按「新鲜 bundle+pid」推断——修掉 pidAlive 把已完成误判为死亡的问题）

### Changed
- **zh-conv 繁→简升级为 OpenCC 全表**：人工挑选 ~530 对 → 审计补 66 对 → 实战暴露缺口（憲/過/議/謂等）→ **TSCharacters 全表生成（3221 对，`scripts/gen-zhconv.mjs` 固化为工具）**；解析取字段首码点（兼容变体注记行）；toSimplified 改逐码点映射（规避生僻补充平面字污染正则字符类）
- OUTPUT-STANDARDS：新增 §6.8 时间锚点统一规范、§6.9 帧利用纪律；§7 变更记录 Q4/Q5/Q6 依拍板逐条在案
- 测试基线：media **43** / tsGal 24→**31** / render 37→**47**（Q4 命名 2 + Q5 六项 + Q6 白名单与注入）

### 实战验证
- 7 场景全面实战（3 路线 × 5 模板 × Q4 四档时长 × medium 三域 × 敏感/稀疏/极短/超长边界）：评分报告 `reports/2026-10-04-field-test.md`（内部）
- 4 场景 Q5/Q6 自检（资讯/教程/vlog/短课）：五项修复全部按设计工作、零新 bug；过程中抓修 3 个（繁简缺口、lightbox 尺寸、画廊锚点跳转）
- 长视频后台流（95min 课）：自动后台 + 双进程静音切分（接缝零丢段）+ 终态回写全链路实证

## [3.1.1] — 2026-10-04

全面审计轮（内容/功能/流程/质量路线隐患；用户委托重点=medium 新模型问题排查）：抓修 2 个真 bug + 2 项防呆加固，全部经实测复验。

### Fixed
- **serve-notes 插件布局失效**（真 bug）：静态根与笔记列表写死包目录 `output/`——数据根布局下列表为空、笔记 HTML/配图全部 404 → 改为 `/output/*` 映射数据根 `OUTPUT_DIR`（老布局行为不变），实测数据根笔记 200 直出
- **zh-conv 映射缺口**（真隐患）：OpenCC TSCharacters 差集扫描发现 66 个常用繁字未入表（含真实语料实缺 9 字：問確繼辦進選錄間關）→ 补齐 66 对（全部经 OpenCC 值校验，冲突 0）

### Added
- **modelFallback 防呆**（质量路线隐患加固）：analyze/transcribe 请求的模型文件缺失而回退时，bundle/返回体显式记录 `requested X -> actual Y`——防质量档静默降级为 small
- **doctor 增补 medium 检查项**（可选级）：ggml-medium.bin 缺失时给出下载指引（质量路线就绪度一眼可见）
- 回归用例 +1（补缺字抽查），media 套件 42→43

### 验证（审计实录）
- 三方一致性：已装包 vs 工作区 vs GitHub——10 关键文件 SHA256 全同、语法 0 错、文件清单零差异
- 质量路线端到端（19:37 高数课 BV1CAxaeHEeH?p=8，model=medium）：451s 单进程完成（**dual 门控运行时实证**：19:37≥6min 但 dual=null）、繁简转换覆盖 course 产物（残留 0）、462 段/22 帧/11 关键时刻、成品 lecture-notes.html 53.6KB 全区块渲染
- OpenCC 对照：映射值冲突 0；serve-notes 修复后数据根笔记/配图实测 200
- 三套回归 43+24+37 全绿

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
