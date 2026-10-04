// scripts/probe-assets.mjs — 列出 whisper.cpp 最近多个 release 及其 Windows 资源
const url = 'https://gh-proxy.com/https://api.github.com/repos/ggml-org/whisper.cpp/releases?per_page=15';
const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
const j = await r.json();
if (!Array.isArray(j)) { console.log('unexpected:', JSON.stringify(j).slice(0, 300)); process.exit(1); }
for (const rel of j) {
  const wins = (rel.assets || []).filter((a) => /win|x64|zip/i.test(a.name));
  console.log(`${rel.tag_name}  prerelease=${rel.prerelease}  assets=${(rel.assets || []).length}`);
  for (const a of wins.slice(0, 8)) {
    console.log(`   - ${a.name} (${Math.round(a.size / 1048576)}MB)`);
  }
}
