// paths.js — 路径解析单一事实源（插件化公共工程，2026-10-04）
// PKG_ROOT  = 代码资产（templates/scripts，随包分发，只读）
// DATA_ROOT = 运行时数据（output / tools / bin / cookie，可写）
// BILI_DATA_ROOT 由 dsh 插件 cordis.patch.yml 经 !!js 注入（如 ~/.dsh/bili-sum）；
// 未设置时回退包目录——本机老布局（cookie/tools/output 与代码同目录）完全兼容。
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PKG_ROOT = dirname(fileURLToPath(import.meta.url));
export const DATA_ROOT = process.env.BILI_DATA_ROOT ? resolve(process.env.BILI_DATA_ROOT) : PKG_ROOT;
export const OUTPUT_DIR = join(DATA_ROOT, 'output');
export const TOOLS_DIR = join(DATA_ROOT, 'tools');
export const BIN_DIR = join(DATA_ROOT, 'bin');
export const YTDLP_TMP = join(BIN_DIR, 'tmp');
export const TEMPLATES_DIR = join(PKG_ROOT, 'templates');

// cookie 候选：数据根优先，包目录回退（bili-cookie.txt 曾与 server.js 同目录的老布局）
export function cookieFileCandidates() {
  const inData = join(DATA_ROOT, 'bili-cookie.txt');
  const inPkg = join(PKG_ROOT, 'bili-cookie.txt');
  return inData === inPkg ? [inData] : [inData, inPkg];
}
