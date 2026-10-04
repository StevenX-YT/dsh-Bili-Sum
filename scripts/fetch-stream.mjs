// fetch-stream.mjs — fetch bilibili direct stream URL (durl single-file MP4, fnval=1) for native <video> playback.
// The <video> element streams online from bilibili CDN — nothing is downloaded to disk.
// Uses media.js getPlayUrlDurl; reads bili-cookie.txt automatically for higher quality when present.
// Usage: node scripts/fetch-stream.mjs <bvid|url> [page]
// Output: single-line JSON {url, quality, exp, page, segments} on success (exit 0); stderr + exit 1 on failure.
import { getPlayUrlDurl } from '../media.js';

const bvid = process.argv[2];
const page = process.argv[3] ? Number(process.argv[3]) : undefined;
if (!bvid) { console.error('usage: fetch-stream.mjs <bvid|url> [page]'); process.exit(2); }

try {
  // Retry: bilibili playurl occasionally rate-limits after heavy usage (observed 2026-10-03);
  // 3 attempts with growing backoff, then give up -> inject falls back to iframe as before.
  let s = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      s = await getPlayUrlDurl(bvid, { qn: 80, page });
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  if (!s) throw lastErr;
  // Only single-segment durl is playable in one <video> element; multi-segment → reject (iframe fallback)
  if (s.segments !== 1) { console.error('multi-segment durl (' + s.segments + '), not usable for <video>'); process.exit(1); }
  console.log(JSON.stringify({ url: s.url, quality: s.quality, exp: s.exp, page: s.page || 1, segments: s.segments }));
  process.exit(0);
} catch (e) {
  console.error(String((e && e.message) || e));
  process.exit(1);
}
