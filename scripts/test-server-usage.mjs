// scripts/test-server-usage.mjs — 「新会话配方缺失」修复回归（HANDOFF 待办 #1，方案 A+B+C）
// 锁定：① analyze/transcribe 工具描述内联标准作业（brief→content.json→render→present、判型、
// 五模板字段全名、硬保底、Q4 条数口诀）② MCP resources usage://dsh-bili-sum list/read 实现
// ③ v3.3.0 流畅性轮：initialize.instructions 过程契约注入 + 过程纪律反模式 + 超时配置。
// 断言的是「配方可见性与过程纪律」——改 server.js/patch 时漏掉关键标记即红。
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { TOOLS, USAGE_URI, USAGE_MANUAL, SERVER_INSTRUCTIONS, dispatch } from '../server.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0; let fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log(`  ok ${name}`); } catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); } };
const ta = async (name, fn) => { try { await fn(); pass++; console.log(`  ok ${name}`); } catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); } };
const has = (s, keys, label) => { for (const k of keys) assert.ok(String(s).includes(k), `${label} 缺标记「${k}」`); };

console.log('test-server-usage: 新会话配方缺失修复回归（方案 A+B）');

const analyze = TOOLS.find((x) => x.name === 'analyze');
const transcribe = TOOLS.find((x) => x.name === 'transcribe');
const A = () => analyze.description;   // analyze 工具描述（方案 A 主载体）

t('TOOLS 含 8 工具且 analyze/transcribe 在列', () => {
  assert.equal(TOOLS.length, 8);
  assert.ok(analyze && transcribe);
});

t('analyze 描述含交付流程步骤（brief→content.json→render→present）', () => {
  has(A(), ['brief.md', 'content.json', 'render-notes.mjs', '--template', 'digest|lecture|tutorial|share|info', 'present', '标准交付流程'], 'analyze');
});

t('analyze 描述含判型信号与回显要求', () => {
  has(A(), ['识别为', 'lecture', 'tutorial', 'digest', 'share', 'info', '判型'], 'analyze');
});

t('analyze 描述内联通用 content.json 字段', () => {
  has(A(), ['summary[', 'highlights[', 'highlightsTitle', 'qa[', 'terms[', 'chapters[', 'attribution', 'dm[{', 'frames['], 'analyze');
});

t('analyze 描述内联 lecture 字段（含 steps 必填）', () => {
  has(A(), ['course{', 'framework[', 'knowledge[', 'examples[', 'steps[]', 'authorSummary[', 'difficulty[', 'prereq{', 'review[', 'signals{'], 'analyze');
});

t('analyze 描述内联 tutorial 字段（含 verify 必填）', () => {
  has(A(), ['task{', 'quickPath', 'prereqCheck[', 'steps[{', 'errors[', 'verify[', 'tools['], 'analyze');
});

t('analyze 描述内联 share/info 字段', () => {
  has(A(), ['tldr', 'timeline[', 'quotes[', 'useful[', 'flash', 'wh{', 'data[', 'react[', 'background'], 'analyze');
});

t('analyze 描述含 Q4 条数口诀（时长四档+1.2×触顶）', () => {
  has(A(), ['6-14', '8-14', '10-16', '12-20', '1.2'], 'analyze');
});

t('analyze 描述含硬保底（例题 steps/步骤 verify/5W1H/敏感三件套）', () => {
  has(A(), ['steps必填', 'verify必填', '5W1H', 'warn', 'attribution四栏'], 'analyze');
});

t('analyze 描述指向 MCP 资源 usage://dsh-bili-sum', () => {
  assert.ok(A().includes(USAGE_URI), `analyze 缺 ${USAGE_URI}`);
});

t('transcribe 描述指向 analyze 与 usage 资源（防绕过管线）', () => {
  has(transcribe.description, ['analyze', USAGE_URI], 'transcribe');
});

await ta('resources/list 返回 usage://dsh-bili-sum 资源', async () => {
  const r = await dispatch({ method: 'resources/list', params: {} });
  assert.equal(r.resources.length, 1);
  assert.equal(r.resources[0].uri, USAGE_URI);
  assert.ok(r.resources[0].mimeType === 'text/markdown');
});

await ta('resources/read 返回标准作业手册全文', async () => {
  const r = await dispatch({ method: 'resources/read', params: { uri: USAGE_URI } });
  assert.equal(r.contents[0].uri, USAGE_URI);
  assert.equal(r.contents[0].text, USAGE_MANUAL);
  has(USAGE_MANUAL, ['标准流程', 'brief.md', 'content.json', 'render-notes.mjs', '判型', 'digest', 'lecture', 'tutorial', 'share', 'info', 'steps', 'verify', '5W1H', '1.2', '硬保底'], 'USAGE_MANUAL');
});

await ta('resources/read 未知 URI 报 -32002', async () => {
  await assert.rejects(
    () => dispatch({ method: 'resources/read', params: { uri: 'usage://nope' } }),
    (e) => e.code === -32002
  );
});

// ---- v3.3.0 流畅性轮（session-7be58aa2 实证驱动）----

await ta('initialize 响应含 instructions 字段（systemPrompt 注入通道）', async () => {
  const r = await dispatch({ method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  assert.equal(typeof r.instructions, 'string');
  assert.ok(r.instructions.includes('标准流程'), 'instructions 缺标准流程');
});

t('SERVER_INSTRUCTIONS 含流程+过程纪律+边界三段', () => {
  has(SERVER_INSTRUCTIONS, ['标准流程', 'analyze', 'brief.md', 'content.json', 'render-notes.mjs', 'present'], 'INSTRUCTIONS');
  has(SERVER_INSTRUCTIONS, ['过程纪律', '查进程', '播报', 'web_search', '帧级核验', 'analyze-status'], 'INSTRUCTIONS');
  has(SERVER_INSTRUCTIONS, ['不改任何输出标准', 'usage://dsh-bili-sum'], 'INSTRUCTIONS');
});

t('SERVER_INSTRUCTIONS 含 v3.4.0 文件优先/恢复陷阱/goal 保险/草稿流', () => {
  has(SERVER_INSTRUCTIONS, ['文件优先', '_draft-content.json', '禁止调用工具', 'create_goal', 'update_goal'], 'INSTRUCTIONS');
});

t('SERVER_INSTRUCTIONS 保持精简（<6000 字符，32KB 字节预算内）', () => {
  assert.ok(SERVER_INSTRUCTIONS.length < 6000, `实际 ${SERVER_INSTRUCTIONS.length} 字符`);
  assert.ok(Buffer.byteLength(SERVER_INSTRUCTIONS, 'utf8') < 12000, 'UTF-8 字节数超预算');
});

t('analyze 描述含过程纪律反模式清单（v3.4.0）', () => {
  has(A(), ['过程纪律', '不复述转录', '不播报', '不 web_search', '帧核验', '_draft-content.json', '聊天正文', 'create_goal'], 'analyze');
});

t('usage 手册含过程纪律节（双实证引用）', () => {
  has(USAGE_MANUAL, ['过程纪律', 'session-7be58aa2', 'session-ee6408ef', '查进程', '文件优先', '_draft-content.json', '禁止调用工具', 'create_goal', 'web_search'], 'USAGE_MANUAL');
});

t('cordis.patch.yml 配置 toolCallTimeoutMs=900000（默认60s会掐断analyze）', () => {
  const yml = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8');
  assert.ok(yml.includes('toolCallTimeoutMs: 900000'), 'patch 缺 toolCallTimeoutMs');
});

console.log(`server-usage: ${pass} 通过, ${fail} 失败`);
if (fail) process.exit(1);
