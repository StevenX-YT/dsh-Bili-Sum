/* tsGal-runtime v3.6 — 时间戳折叠画廊 + B站空降直达 + 悬浮小窗播放（视频源双通道）
 * 实测结论（v3.4.2 取证）：B站 CDN 对视频直链强制校验 Referer——
 *   带B站 Referer：200 + Accept-Ranges + Range 206（完全可 seek）
 *   无 Referer（file:// 页面的 <video> 只能发 null）：403 ——
 * 这就是 file:// 直开时"空降失效、延续上次播放"的根因：原生播放器根本加载不了直链，
 * 实际一直落到 B站播放器 iframe，而 iframe 在登录态下会按观看历史自动续播、忽略 t= 参数。
 *
 * 视频源双通道：
 *   A. 本地服务器模式（推荐）：node scripts/serve-notes.mjs 启动后通过
 *      http://127.0.0.1:PORT/output/... 打开笔记 → 原生 <video> 走 /proxy 代理播放B站直链
 *      （代理自动补 Referer，透传 Range）→ 完整 seek/空降/点击暂停；
 *      视频仍由B站 CDN 在线流式传输，不下载到本地。
 *   B. file:// 直开模式：自动回退B站播放器 iframe（sandbox 防跳转；登录态下 t= 空降可能被
 *      观看历史续播干扰——B站播放器行为）。页脚会提示用本地服务器解锁完整能力。
 *
 * v3.6 变更：字幕系统（中间行高亮/设置面板/timeupdate 联动/±5s 微调）已整体移除——
 *  相关代码与规范拆出留档于 archive-subtitles/（gallery-runtime-v3.5-with-subtitles.js 为完整回退点）。
 * 保留机制：折叠画廊 v1 / 空降链接 v2 / 小窗 v3.x / 画廊帧转录标注 / 点击暂停 / 直链失效回退。
 * 纯前端零依赖；数据内联；播放需联网。
 */
(function () {
  'use strict';

  var MAX_PER_GALLERY = 6;
  var DATA = (typeof window !== 'undefined' && window.__TSGAL__) || { frames: [], video: null, stream: null };
  var LINES = []; // 全文转录（main 中从 <pre id="transcript"> 解析；画廊帧标注用）
  var MODE = '';                // 'native' | 'iframe'
  var TG_SEQ = 0;               // 原生重载 cache-busting 序号（fragment 计数）

  // ---------- 纯函数 ----------
  function toSec(s) {
    var p = String(s).split(':').map(Number);
    if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
    return p[0] * 60 + p[1];
  }

  function parseBadge(text) {
    var t = String(text || '').replace(/\s+/g, '');
    var m = t.match(/((?:\d{1,3}:)?\d{1,2}:\d{2})[–\-—]((?:\d{1,3}:)?\d{1,2}:\d{2})/);
    if (m) {
      var a = toSec(m[1]), b = toSec(m[2]);
      if (b >= a) return { start: a, end: b };
    }
    var m2 = t.match(/((?:\d{1,3}:)?\d{1,2}:\d{2})/);
    if (m2) { var v = toSec(m2[1]); return { start: v, end: v }; }
    return null;
  }

  function parseTranscriptText(text) {
    var out = [];
    String(text || '').split('\n').forEach(function (ln) {
      var m = ln.match(/^\[([0-9:]+)\]\s*(.*)$/);
      if (m && m[2]) out.push({ t: toSec(m[1]), text: m[2] });
    });
    return out;
  }

  function pickFrames(frames, start, end, maxN) {
    maxN = maxN || MAX_PER_GALLERY;
    var isRange = end - start > 8;
    var lo = start - (isRange ? 15 : 35);
    var hi = end + (isRange ? 15 : 35);
    var inWin = frames.filter(function (f) { return f.t >= lo && f.t <= hi; })
                      .sort(function (a, b) { return a.t - b.t; });
    if (inWin.length > maxN) {
      var picked = [], step = (inWin.length - 1) / (maxN - 1);
      for (var i = 0; i < maxN; i++) picked.push(inWin[Math.round(i * step)]);
      var seen = {}; inWin = picked.filter(function (f) { if (seen[f.f]) return false; seen[f.f] = 1; return true; });
    }
    if (inWin.length === 0) {
      var mid = (start + end) / 2;
      inWin = frames.slice()
        .sort(function (a, b) { return Math.abs(a.t - mid) - Math.abs(b.t - mid); })
        .slice(0, 3)
        .sort(function (a, b) { return a.t - b.t; });
    }
    return inWin;
  }

  function captionFor(lines, t) {
    var best = null, bd = 1e9;
    for (var i = 0; i < lines.length; i++) {
      var d = Math.abs(lines[i].t - t);
      if (d < bd) { bd = d; best = lines[i]; }
    }
    if (best && bd <= 30) return best.text;
    return '（此画面附近无语音转录）';
  }

  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    return (h > 0 ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
  }

  // B站 qn → 画质标签
  function qualityLabel(q) {
    var m = { 6: '240P', 16: '360P', 32: '480P', 64: '720P', 80: '1080P', 112: '1080P+', 116: '1080P60', 120: '4K', 125: '4K', 126: '8K', 127: '8K' };
    return m[Number(q)] || (q ? q + 'P' : '未知');
  }

  function jumpUrl(sec) {
    var v = DATA.video;
    if (!v || !v.bvid) return null;
    var q = [];
    if (v.page && Number(v.page) > 1) q.push('p=' + Number(v.page));
    q.push('t=' + Math.max(0, Math.round(Number(sec) || 0)));
    return 'https://www.bilibili.com/video/' + v.bvid + '?' + q.join('&');
  }

  // B站官方外链播放器（悬浮小窗回退用）
  // high_quality=1 + as_wide=1：默认高清宽屏；r= 随机参数：规避按 URL 缓存的续播决策
  // 注意：浏览器登录B站后，该播放器可能按观看历史自动续播而非跳到 t 指定秒（B站播放器行为，无法完全绕过）
  function embedUrl(sec) {
    var v = DATA.video;
    if (!v || !v.bvid) return null;
    var q = ['bvid=' + encodeURIComponent(v.bvid)];
    if (v.page && Number(v.page) > 1) q.push('p=' + Number(v.page));
    q.push('t=' + Math.max(0, Math.round(Number(sec) || 0)));
    q.push('autoplay=1');
    q.push('as_wide=1');
    q.push('high_quality=1');
    q.push('r=' + Math.floor(Math.random() * 1e9));
    return 'https://player.bilibili.com/player.html?' + q.join('&');
  }

  function videoLabel() {
    var v = DATA.video || {};
    var t = v.title || v.bvid || '视频';
    if (v.page && Number(v.page) > 1) t += ' · P' + Number(v.page) + (v.part ? ' ' + v.part : '');
    return t;
  }

  function streamReady() {
    var s = DATA.stream;
    if (!s || !s.url) return false;
    if (s.exp && Date.now() / 1000 > Number(s.exp)) return false; // 直链过期
    return true;
  }

  // 本地服务器模式检测：file:// 页面的 <video> 无法伪造B站 Referer（实测403），
  // 只有经 serve-notes.mjs 的 /proxy 代理（补 Referer + 透传 Range）原生播放才可用
  function isLocalServer() {
    if (typeof location === 'undefined') return false;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return false;
    return location.hostname === '127.0.0.1' || location.hostname === 'localhost';
  }

  function proxiedUrl(rawUrl) {
    return location.origin + '/proxy?url=' + encodeURIComponent(rawUrl);
  }

  // 原生 <video> 实际加载地址：本地服务器模式经 /proxy（补Referer），file:// 直开时=裸直链（CDN会403）
  function nativeSrcUrl() {
    return isLocalServer() ? proxiedUrl(DATA.stream.url) : DATA.stream.url;
  }

  // file:// 直开且有直链时的一次性提示：本地服务器可解锁完整空降
  var _tipShown = false;
  function showServerTip() {
    if (_tipShown || typeof document === 'undefined') return;
    _tipShown = true;
    try { if (window.localStorage.getItem('tsf-tip') === '1') return; } catch (e) { /* ignore */ }
    try { window.localStorage.setItem('tsf-tip', '1'); } catch (e) { /* ignore */ }
    var t = document.createElement('div');
    t.textContent = '提示：运行 node scripts/serve-notes.mjs 后用 http://127.0.0.1 打开本页，可解锁完整空降';
    t.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:16px;z-index:100000;background:#0054a6;color:#fff;padding:8px 16px;border-radius:8px;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:92vw;text-align:center';
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 9000);
  }

  function linkifyBadge(doc, badge, range) {
    if (!badge || badge.tagName === 'A') return badge;
    var url = jumpUrl(range.start);
    if (!url) return badge;
    var a = doc.createElement('a');
    a.className = badge.className + ' ts-jump';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('data-tsec', String(range.start));
    a.title = '点击小窗播放 ' + badge.textContent.trim() + '（右键可在B站新标签页打开）';
    a.textContent = badge.textContent;
    badge.parentNode.replaceChild(a, badge);
    return a;
  }

  // ---------- CSS ----------
  var CSS = [
    'details.tsGal{margin:8px 0 14px}',
    'details.tsGal>summary{display:inline-block;background:#eaf3fd;border:1px solid #cfe3f7;border-radius:16px;padding:2px 14px;font-size:13px;color:#0054a6;cursor:pointer;user-select:none}',
    'details.tsGal>summary::before{content:"▸ "}',
    'details.tsGal[open]>summary::before{content:"▾ "}',
    'details.tsGal>summary:hover{background:#dcecfc}',
    'details.tsGal .strip{display:flex;gap:10px;overflow-x:auto;padding:10px;background:#fff;border:1px solid #e3e5e8;border-radius:10px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch}',
    'details.tsGal .strip::-webkit-scrollbar{height:8px}',
    'details.tsGal .strip::-webkit-scrollbar-thumb{background:#c9d3dd;border-radius:4px}',
    'details.tsGal .strip figure{flex:0 0 min(78vw,330px);margin:0;scroll-snap-align:start}',
    'details.tsGal .strip img{width:100%;display:block;border:1px solid #eee;border-radius:6px;cursor:zoom-in}',
    'details.tsGal .strip figcaption{font-size:12px;line-height:1.55;color:#666;padding:6px 2px 0}',
    'details.tsGal .strip .hint{flex:0 0 auto;align-self:center;color:#999;font-size:12px;writing-mode:vertical-rl;padding:0 4px}',
    'a.ts-jump{color:#fff !important;text-decoration:none;cursor:pointer}',
    'a.ts-jump:hover{background:#003d7a !important}',
    'a.ts-jump::after{content:" ▶";font-size:10px;opacity:.85}',
    '#tsFloat{position:fixed;right:18px;bottom:18px;width:min(430px,94vw);z-index:99999;background:#0b0b0c;border:1px solid #2a2a2e;border-radius:12px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.45);display:none}',
    '#tsFloat.show{display:block}',
    '#tsFloat .hd{display:flex;align-items:center;gap:8px;padding:7px 10px;background:#0054a6;color:#fff;font-size:12.5px;cursor:move;user-select:none}',
    '#tsFloat .hd .tt{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#tsFloat .hd button{background:rgba(255,255,255,.15);border:0;color:#fff;border-radius:6px;font-size:12px;padding:2px 8px;cursor:pointer;white-space:nowrap}',
    '#tsFloat .hd button:hover{background:rgba(255,255,255,.3)}',
    '#tsFloat .bd{position:relative;background:#000;aspect-ratio:16/9}',
    '#tsFloat .bd iframe,#tsFloat .bd video{position:absolute;inset:0;width:100%;height:100%;border:0;background:#000}',
    '#tsFloat .bd video{object-fit:contain}',
    '#tsFloat .ft{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:4px 10px;background:#111;color:#bbb;font-size:11.5px}',
    '#tsFloat .ft .pos{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#tsFloat .ft button{background:rgba(255,255,255,.12);border:0;color:#ddd;border-radius:6px;font-size:11.5px;padding:2px 8px;cursor:pointer;white-space:nowrap}',
    '#tsFloat .ft button:hover{background:rgba(255,255,255,.28)}',
    '#tsFloat .ft button.on{background:#0054a6;color:#fff}',
    '#tsFloat .rs{position:absolute;right:0;bottom:0;width:28px;height:28px;cursor:nwse-resize;z-index:6;border-bottom-right-radius:12px;touch-action:none;background:linear-gradient(135deg,transparent 0 50%,rgba(255,255,255,.7) 50% 62%,rgba(255,255,255,.95) 62% 74%,rgba(255,255,255,.5) 74% 86%,rgba(255,255,255,.9) 86%)}',
    '#tsFloat .rs::before{content:"";position:absolute;right:-8px;bottom:-8px;width:44px;height:44px}',
    '#tsFloat .rs:hover{filter:brightness(1.25)}',
    '#tsFloat.dragging, #tsFloat.dragging *{user-select:none !important}',
    '@media (max-width:720px){details.tsGal .strip figure{flex-basis:86vw}#tsFloat{right:8px;bottom:8px}}',
    // Q5 图片点击放大：光标承诺必须兑现（框架表缩略图/配图区/画廊图/时间线帧/步骤截图统一 lightbox）
    '#tsGalZoom{position:fixed;inset:0;z-index:100000;background:rgba(12,15,19,.93);display:none;align-items:center;justify-content:center;cursor:zoom-out}',
    '#tsGalZoom.on{display:flex}',
    '#tsGalZoom img{width:96vw;height:auto;max-height:91vh;object-fit:contain;border-radius:8px;box-shadow:0 10px 48px rgba(0,0,0,.55);background:#fff}',
    '#tsGalZoom .zhint{position:fixed;bottom:16px;left:0;right:0;text-align:center;color:#c9d2db;font-size:12px;pointer-events:none}'
  ].join('\n');

  // ---------- 当前时间（「B站全页」按钮跳转用） ----------
  function currentSec(w) {
    if (MODE === 'native') {
      var v = w.querySelector('.bd video');
      return (v && Number.isFinite(v.currentTime)) ? v.currentTime : 0;
    }
    return Number(w.getAttribute('data-sec') || 0);
  }

  // ---------- 小窗 ----------
  function ensureStyle(doc) {
    if (doc.getElementById('tsgal-css')) return;
    var st = doc.createElement('style');
    st.id = 'tsgal-css';
    st.textContent = CSS;
    doc.head.appendChild(st);
  }

  function ensureFloatPlayer(doc) {
    var w = doc.getElementById('tsFloat');
    if (w) return w;
    w = doc.createElement('div');
    w.id = 'tsFloat';
    w.setAttribute('role', 'dialog');
    w.setAttribute('aria-label', 'B站小窗播放');
    var hd = doc.createElement('div');
    hd.className = 'hd';
    var tt = doc.createElement('span');
    tt.className = 'tt';
    tt.textContent = videoLabel();
    var btnFull = doc.createElement('button');
    btnFull.type = 'button';
    btnFull.title = '在B站新标签页打开当前时间点';
    btnFull.textContent = 'B站全页';
    var btnClose = doc.createElement('button');
    btnClose.type = 'button';
    btnClose.title = '关闭小窗（ESC）';
    btnClose.textContent = '关闭';
    hd.appendChild(tt);
    hd.appendChild(btnFull);
    hd.appendChild(btnClose);
    var bd = doc.createElement('div');
    bd.className = 'bd';
    var fr = doc.createElement('iframe');
    fr.setAttribute('allow', 'autoplay; fullscreen');
    fr.setAttribute('allowfullscreen', 'true');
    fr.setAttribute('frameborder', '0');
    fr.setAttribute('title', 'B站视频小窗');
    // 防跳转 sandbox（回退模式用）：无 allow-popups / allow-top-navigation
    fr.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    bd.appendChild(fr);
    var ft = doc.createElement('div');
    ft.className = 'ft';
    var pos = doc.createElement('span');
    pos.className = 'pos';
    pos.textContent = '点击任意蓝色时间戳即在此小窗播放';
    ft.appendChild(pos);
    var rs = doc.createElement('div');
    rs.className = 'rs';
    rs.title = '拖动调整小窗大小';
    w.appendChild(hd);
    w.appendChild(bd);
    w.appendChild(ft);
    w.appendChild(rs);
    doc.body.appendChild(w);

    // 恢复宽度记忆
    var savedW = 0;
    try { savedW = Number(window.localStorage.getItem('tsf-w')) || 0; } catch (err) { savedW = 0; }
    if (savedW >= 240) {
      var maxW0 = Math.min(window.innerWidth - 24, 1600);
      w.style.width = Math.min(savedW, maxW0) + 'px';
    }
    // ---- 按钮行为 ----
    btnClose.addEventListener('click', function () { hideFloat(doc); });
    btnFull.addEventListener('click', function () {
      var sec = currentSec(w);
      var url = jumpUrl(sec);
      if (url) window.open(url, '_blank', 'noopener');
    });
    // ESC 关闭
    doc.addEventListener('keydown', function (ev) {
      if (ev && (ev.key === 'Escape' || ev.keyCode === 27)) hideFloat(doc);
    });

    // 直链失效/被拒 → 自动回退 B站播放器
    bd.addEventListener('error', function (ev) {
      if (MODE !== 'native') return;
      if (ev.target && ev.target.tagName === 'VIDEO') {
        // 直链失效/被拒 → 自动回退 B站播放器
        var secNow = 0;
        try { secNow = Math.round(ev.target.currentTime || 0); } catch (e2) { secNow = 0; }
        switchToIframe(w, secNow);
      }
    }, true);

    // 点击视频画面 = 暂停/继续（v3.4.1）：原生 video 控件条之外的区域点击切换播放
    bd.addEventListener('click', function (ev) {
      if (MODE !== 'native') return;
      var vd = ev.target;
      if (!vd || vd.tagName !== 'VIDEO') return;
      var rect = vd.getBoundingClientRect();
      if (ev.clientY > rect.bottom - 48) return; // 底部控件条区域交给原生处理，避免双触发
      if (vd.paused) {
        var p = vd.play();
        if (p && p.catch) p.catch(function () { /* ignore */ });
      } else {
        vd.pause();
      }
    });

    // ---- 标题栏拖动 ----
    hd.addEventListener('mousedown', function (ev) {
      if (ev.target && ev.target.tagName === 'BUTTON') return;
      ev.preventDefault();
      w.classList.add('dragging');
      var r = w.getBoundingClientRect();
      w.style.left = r.left + 'px';
      w.style.top = r.top + 'px';
      w.style.right = 'auto';
      w.style.bottom = 'auto';
      var sx = ev.clientX - r.left, sy = ev.clientY - r.top;
      function mv(e2) {
        var nx = Math.min(Math.max(0, e2.clientX - sx), window.innerWidth - 120);
        var ny = Math.min(Math.max(0, e2.clientY - sy), window.innerHeight - 60);
        w.style.left = nx + 'px';
        w.style.top = ny + 'px';
      }
      function up() {
        w.classList.remove('dragging');
        doc.removeEventListener('mousemove', mv);
        doc.removeEventListener('mouseup', up);
      }
      doc.addEventListener('mousemove', mv);
      doc.addEventListener('mouseup', up);
    });

    // ---- 右下角拖拽调宽（pointer capture 防粘连）----
    function startResize(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      w.classList.add('dragging');
      var pid = ev.pointerId;
      try { rs.setPointerCapture(pid); } catch (err) { /* ignore */ }
      var r0 = w.getBoundingClientRect();
      var sx0 = ev.clientX, w0 = r0.width;
      var maxW = Math.min(window.innerWidth - 24, 1600);
      var minW = Math.min(240, maxW);
      function mv(e2) {
        var nw = Math.round(Math.min(maxW, Math.max(minW, w0 + (e2.clientX - sx0))));
        w.style.width = nw + 'px';
      }
      function up() {
        rs.removeEventListener('pointermove', mv);
        rs.removeEventListener('pointerup', up);
        rs.removeEventListener('pointercancel', up);
        window.removeEventListener('blur', up);
        w.classList.remove('dragging');
        try { rs.releasePointerCapture(pid); } catch (err) { /* ignore */ }
        try { window.localStorage.setItem('tsf-w', String(Math.round(w.getBoundingClientRect().width))); } catch (err) { /* ignore */ }
      }
      rs.addEventListener('pointermove', mv);
      rs.addEventListener('pointerup', up);
      rs.addEventListener('pointercancel', up);
      window.addEventListener('blur', up);
    }
    rs.addEventListener('pointerdown', startResize);
    hd.addEventListener('dblclick', function (ev) {
      if (ev.target && ev.target.tagName === 'BUTTON') return;
      w.style.width = '';
      try { window.localStorage.removeItem('tsf-w'); } catch (err) { /* ignore */ }
    });

    return w;
  }

  function updatePos(w, sec) {
    var pos = w.querySelector('.pos');
    if (!pos) return;
    var st = DATA.stream;
    if (MODE === 'native' && st && st.quality) {
      pos.textContent = '本地代理 · ' + qualityLabel(st.quality) + ' · 空降 ' + fmt(sec);
      pos.title = '经 serve-notes.mjs 代理播放B站直链（完整 seek / 暂停）';
    } else if (MODE === 'iframe' && streamReady()) {
      pos.textContent = 'B站播放器(回退) · 空降 ' + fmt(sec);
      pos.title = 'file:// 直开时B站 CDN 拒绝无 Referer 的直链（403）；运行 scripts/serve-notes.mjs 后经 http://127.0.0.1 打开本页，即可解锁完整空降';
    } else {
      pos.textContent = 'B站播放器 · 空降 ' + fmt(sec);
      pos.title = '';
    }
  }

  function startNative(w, sec) {
    var bd = w.querySelector('.bd');
    var fr = bd.querySelector('iframe');
    if (fr) { fr.removeAttribute('src'); fr.style.display = 'none'; }
    var vd = bd.querySelector('video');
    if (!vd) {
      vd = doc0(w).createElement('video');
      vd.setAttribute('controls', '');
      vd.setAttribute('playsinline', '');
      vd.setAttribute('preload', 'auto');
      bd.insertBefore(vd, bd.firstChild);
    }
    vd.style.display = '';
    MODE = 'native';
    w._pendingSeek = sec;

    // 就绪后：seek 到目标 + 播放。
    // v3.4.2：不再用 Number.isFinite(vd.duration) 做门槛——流式 MP4 的 duration 可能长时间为 Infinity，
    // 旧逻辑会因此跳过 seek、直接从当前位置继续播（"空降失效、延续上一次播放"的根因之一）。
    var onReady = function () {
      if (w._pendingSeek == null) return;
      var target = w._pendingSeek;
      w._pendingSeek = null;
      try { vd.currentTime = target; } catch (e) { /* ignore */ }
      var pr = vd.play();
      if (pr && pr.catch) pr.catch(function () { /* ignore */ });
      // 校验 seek 是否真正生效：1.2s 后仍偏差 >3s → 带 fragment 强制完整重载兜底
      if (w._seekChk) clearTimeout(w._seekChk);
      w._seekChk = setTimeout(function () {
        if (MODE !== 'native') return;
        var cur = 0;
        try { cur = vd.currentTime; } catch (e) { cur = 0; }
        if (Math.abs(cur - target) > 3) {
          w._pendingSeek = target;
          loadNative(w);
        }
      }, 1200);
    };

    // 单例监听：先移除旧监听，避免重复注册造成竞态
    if (vd._tsReady) {
      vd.removeEventListener('loadedmetadata', vd._tsReady);
      vd.removeEventListener('canplay', vd._tsReady);
    }
    vd._tsReady = onReady;

    var sameSrc = vd.getAttribute('data-src') === nativeSrcUrl();
    if (sameSrc && vd.readyState >= 2) {
      onReady();
      return;
    }
    loadNative(w);
  }

  function loadNative(w) {
    var vd = w.querySelector('.bd video');
    if (!vd) return;
    // v3.5：src 走 nativeSrcUrl()——本地服务器模式=经 /proxy 补Referer（CDN 200+可seek），
    // file:// 模式=裸直链（CDN 403，由 openFloat 的入口拦截，一般到不了这里）
    // fragment 仅存在于客户端（不发送到服务器），用于强制浏览器走完整加载周期
    var loadUrl = nativeSrcUrl();
    var src = loadUrl + '#tsgal=' + (++TG_SEQ);
    vd.setAttribute('data-src', loadUrl);
    vd.setAttribute('src', src);
    if (vd._tsReady) {
      vd.addEventListener('loadedmetadata', vd._tsReady);
      vd.addEventListener('canplay', vd._tsReady);
    }
    vd.load();
  }

  function doc0(w) { return w.ownerDocument; }

  function switchToIframe(w, sec) {
    var bd = w.querySelector('.bd');
    var vd = bd.querySelector('video');
    if (vd) {
      try { vd.pause(); } catch (e) { /* ignore */ }
      vd.removeAttribute('src');
      vd.load();
      vd.style.display = 'none';
    }
    startIframe(w, sec);
  }

  function startIframe(w, sec) {
    var url = embedUrl(sec);
    if (!url) return;
    var bd = w.querySelector('.bd');
    var vd = bd.querySelector('video');
    if (vd) vd.style.display = 'none';
    var fr = bd.querySelector('iframe');
    MODE = 'iframe';
    fr.style.display = '';
    fr.setAttribute('src', url);
  }

  function hideFloat(doc) {
    var w = doc.getElementById('tsFloat');
    if (!w) return;
    w.classList.remove('show');
    if (w._seekChk) { clearTimeout(w._seekChk); w._seekChk = null; } // 清空空降校验定时器
    var bd = w.querySelector('.bd');
    var fr = bd && bd.querySelector('iframe');
    if (fr) fr.removeAttribute('src');
    var vd = bd && bd.querySelector('video');
    if (vd) { try { vd.pause(); } catch (e) { /* ignore */ } vd.removeAttribute('src'); vd.removeAttribute('data-src'); try { vd.load(); } catch (e2) { /* ignore */ } }
  }

  function openFloat(doc, sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    var w = ensureFloatPlayer(doc);
    w.setAttribute('data-sec', String(sec));
    var tt = w.querySelector('.tt');
    if (tt) tt.textContent = videoLabel() + ' · ' + fmt(sec);
    // 播放引擎选择（v3.5）：原生仅在本地服务器模式下可用（CDN 需 Referer）；否则回退B站播放器
    if (streamReady() && isLocalServer()) {
      startNative(w, sec);
    } else {
      var url = embedUrl(sec);
      if (!url) {
        var fallback = jumpUrl(sec);
        if (fallback) window.open(fallback, '_blank', 'noopener');
        return;
      }
      startIframe(w, sec);
      if (streamReady()) showServerTip(); // file:// 有直链但缺代理 → 提示本地服务器
    }
    updatePos(w, sec);
    w.classList.add('show');
  }

  function tsBadge(rangeStart) {
    var url = jumpUrl(rangeStart);
    if (!url) return null;
    return url;
  }

  function buildGallery(doc, range, frames, lines) {
    var picks = pickFrames(frames, range.start, range.end);
    if (!picks.length) return null;
    var d = doc.createElement('details');
    d.className = 'tsGal';
    var sum = doc.createElement('summary');
    sum.textContent = '查看该时段画面（' + picks.length + ' 帧 · 点击展开 · 左右滚动）';
    d.appendChild(sum);
    var strip = doc.createElement('div');
    strip.className = 'strip';
    picks.forEach(function (f) {
      var fig = doc.createElement('figure');
      var a = doc.createElement('a');
      a.href = f.f; a.target = '_blank'; a.rel = 'noopener';
      var img = doc.createElement('img');
      img.src = f.f; img.loading = 'lazy'; img.alt = fmt(f.t) + ' 画面';
      a.appendChild(img); fig.appendChild(a);
      var cap = doc.createElement('figcaption');
      var url = tsBadge(f.t);
      if (url) {
        var link = doc.createElement('a');
        link.className = 'ts ts-jump';
        link.href = url; link.target = '_blank'; link.rel = 'noopener';
        link.setAttribute('data-tsec', String(Math.round(f.t)));
        link.title = '点击小窗播放 ' + fmt(f.t) + '（右键可在B站新标签页打开）';
        link.textContent = fmt(f.t);
        cap.appendChild(link);
      } else {
        var b = doc.createElement('span');
        b.className = 'ts'; b.textContent = fmt(f.t);
        cap.appendChild(b);
      }
      cap.appendChild(doc.createTextNode(' ' + captionFor(lines, f.t)));
      fig.appendChild(cap);
      strip.appendChild(fig);
    });
    var hint = doc.createElement('span');
    hint.className = 'hint'; hint.textContent = '← 左右滚动 →';
    strip.appendChild(hint);
    d.appendChild(strip);
    return d;
  }

  // ---------- 图片点击放大（Q5：光标承诺必须兑现）----------
  function ensureZoom(doc) {
    if (doc.getElementById('tsGalZoom')) return;
    var ov = doc.createElement('div');
    ov.id = 'tsGalZoom';
    var im = doc.createElement('img');
    im.alt = '';
    var hint = doc.createElement('div');
    hint.className = 'zhint';
    hint.textContent = '点击任意处或按 ESC 关闭';
    ov.appendChild(im);
    ov.appendChild(hint);
    doc.body.appendChild(ov);
    ov.addEventListener('click', function () { ov.classList.remove('on'); });
    doc.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') ov.classList.remove('on');
    });
  }
  function zoomTo(img) {
    var ov = (img.ownerDocument || document).getElementById('tsGalZoom');
    if (!ov) return;
    var target = ov.querySelector('img');
    target.src = img.src;
    target.alt = img.alt || '';
    ov.classList.add('on');
  }

  function main() {
    var doc = document;
    ensureStyle(doc);
    var preAll = doc.getElementById('transcript');
    LINES = preAll ? parseTranscriptText(preAll.textContent) : [];
    ensureFloatPlayer(doc);
    ensureZoom(doc);

    // 图片点击放大：正文一切配图（框架表缩略图/配图区/画廊/时间线帧/步骤截图）统一 lightbox
    // preventDefault：画廊图被包在 <a target=_blank> 里（v3.4 老设计=新标签开原图），不阻止则默认跳转压过放大
    doc.addEventListener('click', function (ev) {
      var t = ev.target;
      var img = (t && t.closest) ? t.closest('img') : null;
      if (!img || !img.src) return;
      if (img.closest && img.closest('#tsFloat')) return;
      if (img.closest && img.closest('#tsGalZoom')) return;
      ev.preventDefault();
      ev.stopPropagation();
      zoomTo(img);
    }, false);

    // 点击 .ts-jump：左键 → 小窗播放；右键/中键/修饰键 → 浏览器默认
    doc.addEventListener('click', function (ev) {
      var t = ev.target;
      var a = (t && t.closest) ? t.closest('a.ts-jump') : null;
      if (!a) return;
      if (ev.button === 1) return;
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
      var sec = a.getAttribute('data-tsec');
      if (sec === null || sec === '') {
        var r0 = parseBadge(a.textContent);
        if (!r0) return;
        sec = r0.start;
      }
      ev.preventDefault();
      openFloat(doc, Number(sec));
    }, false);

    // 徽章链接化
    Array.prototype.forEach.call(doc.querySelectorAll('.ts'), function (badge) {
      if (badge.tagName === 'A') {
        if (!badge.getAttribute('data-tsec')) {
          var rr = parseBadge(badge.textContent);
          if (rr) badge.setAttribute('data-tsec', String(rr.start));
        }
        return;
      }
      if (badge.closest && badge.closest('summary')) return;
      var range = parseBadge(badge.textContent);
      if (!range) return;
      var cell = badge.parentNode;
      if (cell && (cell.tagName === 'TD' || cell.tagName === 'TH')) {
        var full = parseBadge(cell.textContent);
        if (full && full.start === range.start && full.end > range.end) range = full;
      }
      linkifyBadge(doc, badge, range);
    });

    // 折叠画廊（v1 规则）
    if (!DATA.frames || !DATA.frames.length) return;
    if (doc.querySelector('details.tsGal')) return;
    var lines = LINES;
    var els = doc.querySelectorAll('li, h3, .tip, .err');
    Array.prototype.forEach.call(els, function (el) {
      if (el.dataset.tsgal) return;
      if (el.closest && el.closest('details.tsGal')) return;
      var badge = (el.querySelector(':scope > .ts') || el.querySelector('.ts'));
      if (!badge) return;
      var range = parseBadge(badge.textContent);
      if (!range) return;
      el.dataset.tsgal = '1';
      var g = buildGallery(doc, range, DATA.frames, lines);
      if (!g) return;
      if (el.tagName === 'LI' || el.className === 'tip' || el.className === 'err') {
        el.appendChild(g);
      } else {
        el.insertAdjacentElement('afterend', g);
      }
    });

    // Q6 挂载点扩展（模板原有行为一律不动；仅三处：share「语录摘录」、lecture「知识点精讲」卡与「例题精解」卡）
    // 判别依据 = 元素所在区块最近的前置 <h2> 标题——防止误挂到 digest 要点区（v1 已管）、tutorial 步骤卡、lecture 老师总结、share 时间线等
    function sectionTitle(el) {
      var node = el;
      while (node) {
        if (node.tagName === 'H2') return (node.textContent || '').trim();
        node = node.previousElementSibling;
      }
      return '';
    }
    var extra = doc.querySelectorAll('.quote, .card');
    Array.prototype.forEach.call(extra, function (el) {
      if (el.dataset.tsgal) return;
      if (el.closest && el.closest('details.tsGal')) return;
      var sec = sectionTitle(el);
      if (!galleryAnchorAllowed(sec, el.className)) return;
      var badge = el.querySelector('.ts');
      if (!badge) return;
      var range = parseBadge(badge.textContent);
      if (!range) return;
      el.dataset.tsgal = '1';
      var g2 = buildGallery(doc, range, DATA.frames, lines);
      if (!g2) return;
      el.insertAdjacentElement('afterend', g2);
    });
  }

  // 画廊挂载点白名单（纯函数，node 可单测；Q6 拍板范围：share 语录摘录 / lecture 知识点精讲·例题精解）
  function galleryAnchorAllowed(sectionTitle, className) {
    var sec = String(sectionTitle || '');
    if (className === 'quote') return sec.indexOf('语录摘录') === 0;
    if (className === 'card') return sec.indexOf('知识点精讲') === 0 || sec.indexOf('例题精解') === 0;
    return false;
  }

  // 纯函数导出（node 单元测试）
  if (typeof globalThis !== 'undefined') {
    globalThis.__tsgal = {
      toSec: toSec, parseBadge: parseBadge, parseTranscriptText: parseTranscriptText,
      pickFrames: pickFrames, captionFor: captionFor, fmt: fmt,
      jumpUrl: jumpUrl, embedUrl: embedUrl,
      qualityLabel: qualityLabel, galleryAnchorAllowed: galleryAnchorAllowed,
      setVideo: function (v) { DATA.video = v; },
      setStream: function (s) { DATA.stream = s; },
    };
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', main);
    else main();
  }
})();
