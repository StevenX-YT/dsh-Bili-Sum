// scripts/gen-zhconv.mjs — 从 OpenCC TSCharacters 全表生成 zh-conv.js（零缺口策略，Q4 实战后升级）
// 用法：node scripts/gen-zhconv.mjs [tsCharacters.txt 路径]（缺省读 %TEMP%\OpenCC-TS.txt）
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2] || join(process.env.TEMP || '.', 'OpenCC-TS.txt');
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'zh-conv.js');
const text = readFileSync(src, 'utf8');
const map = {};
for (const line of text.split('\n')) {
  const parts = line.split('\t');
  // OpenCC 字段可能带变体/注记（如 "買\t买 𧹒"）——各取首个码点，避免整行被丢
  const t = [...(parts[0] || '')][0];
  const s = [...(parts[1] || '')][0];
  if (t && s && t !== s && t.charCodeAt(0) >= 0x3400) map[t] = s; // 仅保留 CJK 键，排除标点/符号混入
}
const keys = Object.keys(map).sort();
let body = '';
let row = '  ';
for (const k of keys) {
  const entry = `${k}: ${JSON.stringify(map[k])}, `;
  if (row.length + entry.length > 110) { body += row + '\n'; row = '  '; }
  row += entry;
}
body += row + '\n';
const content = `// zh-conv.js — 繁体→简体全量映射（OpenCC TSCharacters 标准全表生成，${keys.length} 对，2026-10-04）
// 策略沿革：v3.1.0 人工挑选 ~530 对 → v3.1.1 补 66 对 → 实战（时事评论素材）仍暴露缺口（憲/過/議/謂等）
// → 现为 OpenCC 标准全表生成（scripts/gen-zhconv.mjs），零缺口；简体输入天然幂等（键集仅繁体字）。
// 应用点：media.js transcribe/analyze 转录落盘前统一转简（medium/large 繁体输出场景）。
export const ZH_T2S = {
${body}};

const KEYS = Object.keys(ZH_T2S);
export function toSimplified(text) {
  if (text === null || text === undefined) return text;
  // 逐码点映射（勿用字符类正则：表内含生僻补充平面字，surrogate 拆分会污染字符类）
  let out = '';
  for (const ch of String(text)) out += ZH_T2S[ch] ?? ch;
  return out;
}
`;
writeFileSync(out, content, 'utf8');
console.log(`zh-conv.js generated: ${keys.length} pairs, ${content.length} bytes -> ${out}`);
