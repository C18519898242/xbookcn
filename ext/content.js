/* XB 下载器 v0.1
 * 运行在 book.xbookcn.net 页面内：
 *  - 解析目录（/search/label/<书名>），自动跟随“下一页”
 *  - 逐章同源 fetch，提取 .post-body.entry-content
 *  - 去噪、拼 TXT（UTF-8 BOM + CRLF），触发下载
 *  - 断点：每章落 chrome.storage.local（无 chrome 时退回 localStorage）
 *  - 遇到 Cloudflare 验证页：暂停并提示，不自动重试
 */
(() => {
  if (window.__XB__) return;

  const HOST = 'https://book.xbookcn.net';
  const VERSION = '0.2.0';
  const IS_SHORT = location.hostname === 'blog.xbookcn.net';
  const DELAY_MIN = 1200;
  const DELAY_MAX = 1900;
  const MAX_TOC_PAGES = 60;

  const state = {
    running: false,
    paused: false,
    stop: false,
    progress: { phase: 'idle', label: '', done: 0, total: 0, chars: 0, message: '待机' },
    logs: []
  };

  /* ---------- storage ---------- */
  const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const store = {
    async get(key) {
      if (hasChromeStorage) return (await chrome.storage.local.get(key))[key];
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : undefined;
    },
    async set(key, value) {
      if (hasChromeStorage) return chrome.storage.local.set({ [key]: value });
      localStorage.setItem(key, JSON.stringify(value));
    },
    async del(key) {
      if (hasChromeStorage) return chrome.storage.local.remove(key);
      localStorage.removeItem(key);
    }
  };

  const K_TOC = l => `xb:toc:${l}`;
  const K_DONE = l => `xb:done:${l}`;
  const K_CH = (l, id) => `xb:ch:${l}:${id}`;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const jitter = () => DELAY_MIN + Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN));

  function log(msg) {
    const line = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${msg}`;
    state.logs.push(line);
    if (state.logs.length > 80) state.logs.shift();
    render();
    if (window.__XB_DEBUG__) console.log('[XB]', msg);
  }

  /* ---------- network ---------- */
  function isChallenge(doc) {
    const t = (doc && doc.title) || '';
    return /请稍候|Just a moment|Attention Required|Verifying you are human/i.test(t) ||
      !!(doc && doc.querySelector('#challenge-stage, #cf-chl-widget, .cf-browser-verification'));
  }

  async function fetchDoc(url) {
    const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (res.status === 403 || isChallenge(doc)) {
      const err = new Error('CHALLENGE');
      err.code = 'CHALLENGE';
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}`);
      err.code = 'HTTP';
      err.status = res.status;
      throw err;
    }
    return doc;
  }

  /* ---------- parse ---------- */
  function labelFromLocation() {
    const m = location.pathname.match(/^\/search\/label\/(.+?)\/?$/);
    if (!m) return '';
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
  }

  function parseToc(doc) {
    return [...doc.querySelectorAll('.post-outer')].map(node => {
      const a = node.querySelector('.post-title a');
      const meta = node.querySelector('meta[itemprop="postId"]');
      const href = a && a.getAttribute('href');
      return {
        title: (a ? a.textContent : '').trim(),
        url: href ? new URL(href, HOST).href : '',
        postId: (meta && meta.getAttribute('content')) || ''
      };
    }).filter(x => x.url);
  }

  async function collectToc(label) {
    let url = `${HOST}/search/label/${encodeURIComponent(label)}`;
    const seen = new Set();
    const out = [];
    for (let page = 1; page <= MAX_TOC_PAGES && url; page++) {
      const doc = await fetchDoc(url);
      const items = parseToc(doc);
      for (const it of items) {
        const key = it.postId || it.url;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(it);
      }
      state.progress.message = `目录第 ${page} 页，累计 ${out.length} 条`;
      render();
      const next = doc.querySelector('#blog-pager-older-link a');
      url = next ? new URL(next.getAttribute('href'), HOST).href : null;
      if (url) await sleep(300);
    }
    return out;
  }

  function cleanChapter(doc) {
    const body = doc.querySelector('.post-body.entry-content');
    if (!body) return { text: '', paragraphs: 0 };
    return extractFromElement(body, doc);
  }

  function extractFromElement(body, doc) {
    const clone = body.cloneNode(true);
    clone.querySelectorAll('script,style,ins,iframe,noscript,.jump-link,.post-footer,.post-share-buttons,.comments').forEach(el => el.remove());

    const walker = doc.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
    const comments = [];
    while (walker.nextNode()) comments.push(walker.currentNode);
    comments.forEach(c => c.remove());

    clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));

    const ps = [...clone.querySelectorAll('p')];
    let paras;
    if (ps.length) {
      paras = ps.map(p => p.textContent.replace(/\u3000/g, ' ').replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
    } else {
      paras = clone.textContent.split(/\n+/).map(s => s.replace(/\u3000/g, ' ').trim()).filter(Boolean);
    }
    return { text: paras.join('\r\n\r\n'), paragraphs: paras.length };
  }

  /* ---------- short mode ---------- */
  function isShortPostUrl(u) {
    return /^https:\/\/blog\.xbookcn\.net\/\d{4}\/\d{2}\//.test(u || '');
  }

  function parseShortDoc(doc) {
    const titleEl = doc.querySelector('article.post h1.post__title, h1.post__title');
    const body = doc.querySelector('article.post .post__content, .post__content');
    const tags = [...doc.querySelectorAll('.meta__item-tags a[href*="/search/label/"]')]
      .map(a => a.textContent.trim())
      .filter(Boolean);
    if (!titleEl || !body) {
      return { title: '', text: '', paragraphs: 0, tags: [] };
    }
    const { text, paragraphs } = extractFromElement(body, doc);
    return {
      title: cleanBookTitle(titleEl.textContent.trim()),
      text,
      paragraphs,
      tags
    };
  }

  function buildShortTxt(title, text) {
    return '\uFEFF' + `${title}\r\n\r\n${text}\r\n`;
  }

  async function runShortJob(input, opts = {}) {
    if (state.running) throw new Error('已有任务在运行');

    let url = (input || location.href || '').trim();
    if (!/^https?:\/\//i.test(url)) {
      url = location.href;
    }
    if (!isShortPostUrl(url)) {
      throw new Error('请打开短篇单篇页面，或粘贴形如 blog.xbookcn.net/2022/01/blog-post_50 的链接');
    }

    state.running = true;
    state.paused = false;
    state.stop = false;
    state.progress = { phase: 'short', label: url, done: 0, total: 1, chars: 0, message: '读取短篇…' };
    log(`短篇：${url}`);

    try {
      let doc;
      if (url.split('#')[0].split('?')[0] === location.href.split('#')[0].split('?')[0]) {
        doc = document;
      } else {
        doc = await fetchDoc(url);
      }

      const data = parseShortDoc(doc);
      if (!data.text) throw new Error('未识别到正文，请确认是单篇页面');

      state.progress.message = `已解析：${data.paragraphs} 段 / ${data.text.length} 字`;
      render();

      const txt = buildShortTxt(data.title || '短篇', data.text);
      if (opts.download !== false) {
        await downloadTxt(sanitizeFilename(data.title || '短篇'), txt);
      }

      state.progress.phase = 'done';
      state.progress.done = 1;
      state.progress.chars = data.text.length;
      state.progress.message = `完成：${data.title} / ${data.text.length} 字`;
      log(`完成：${data.text.length} 字`);

      return {
        ok: true,
        mode: 'short',
        title: data.title,
        url,
        paragraphs: data.paragraphs,
        chars: data.text.length,
        tags: data.tags
      };
    } catch (e) {
      state.progress.phase = e.code === 'CANCELLED' ? 'idle' : 'error';
      state.progress.message = e.code === 'CHALLENGE'
        ? '已暂停：需要人工验证'
        : (e.code === 'CANCELLED' ? '已停止' : `失败：${e.message}`);
      log(state.progress.message);
      throw e;
    } finally {
      state.running = false;
      render();
    }
  }

  function chapterKey(it) {
    return it.postId || ('u' + Math.abs([...it.url].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)));
  }

  /* ---------- text ---------- */
  function cleanBookTitle(t) {
    return (t || '').replace(/-(长篇|短篇).*$/, '').trim();
  }

  function buildTxt(bookTitle, chapters) {
    const out = [bookTitle, ''];
    for (const ch of chapters) {
      out.push(ch.title, '', ch.text, '');
    }
    return '\uFEFF' + out.join('\r\n').replace(/\r\n{3,}/g, '\r\n\r\n');
  }

  function sanitizeFilename(name) {
    return (name || 'book').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 80) + '.txt';
  }

  async function downloadTxt(filename, text) {
    // 扩展环境：交给 service worker 调 chrome.downloads（不受用户手势限制）
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'XB_SAVE', filename, text });
        if (resp && resp.ok) return true;
        log(`下载失败：${(resp && resp.error) || '未知错误'}`);
      } catch (e) {
        log(`下载异常：${e.message}`);
      }
    }
    // 回退：页面内 blob 下载（仅在没有扩展 API 时使用）
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  }

  /* ---------- job ---------- */
  async function waitIfPaused() {
    while (state.paused && !state.stop) await sleep(300);
    if (state.stop) {
      const err = new Error('CANCELLED');
      err.code = 'CANCELLED';
      throw err;
    }
  }

  async function runLongJob(name, opts = {}) {
    if (state.running) throw new Error('已有任务在运行');

    const label = (opts.label || labelFromLocation() || name || '').trim();
    if (!label) throw new Error('请先填写书名（站内标签名）');

    state.running = true;
    state.paused = false;
    state.stop = false;
    state.progress = { phase: 'toc', label, done: 0, total: 0, chars: 0, message: '读取目录…' };
    log(`开始：${label}`);

    try {
      let toc = await store.get(K_TOC(label));
      if (!toc || opts.fresh) {
        const items = await collectToc(label);
        if (!items.length) throw new Error('未找到该书。请确认书名与站内标签一致，或先打开该书目录页。');
        toc = { label, title: '', toc: items, updatedAt: Date.now() };
        const first = items.find(x => /内容简介|简介/.test(x.title)) || items[0];
        toc.title = cleanBookTitle(first.title.replace(/\s*(内容简介|简介)\s*$/, '')) || label;
        await store.set(K_TOC(label), toc);
      }

      const doneIds = (await store.get(K_DONE(label))) || [];
      const doneSet = new Set(doneIds);
      const all = toc.toc;
      const pending = all.filter(it => !doneSet.has(chapterKey(it)));
      const limit = opts.maxChapters ? Math.min(opts.maxChapters, pending.length) : pending.length;
      const batch = pending.slice(0, limit);

      state.progress.phase = 'chapters';
      state.progress.total = all.length;
      state.progress.done = all.length - pending.length;
      state.progress.message = pending.length > batch.length
        ? `测试模式：只抓 ${batch.length} 章`
        : `待抓 ${batch.length} 章`;
      render();

      for (const it of batch) {
        await waitIfPaused();
        const key = chapterKey(it);
        const t0 = performance.now();

        let doc = null;
        while (!doc) {
          try {
            doc = await fetchDoc(it.url);
          } catch (e) {
            if (e.code !== 'CHALLENGE') throw e;
            state.paused = true;
            state.progress.message = '检测到验证页：请在浏览器中完成验证，然后点“继续”';
            log('暂停：需要人工验证');
            render();
            await waitIfPaused();   // 用户点“继续”后重试本章，无需刷新
            state.progress.message = '重试本章…';
            render();
          }
        }

        const { text, paragraphs } = cleanChapter(doc);
        await store.set(K_CH(label, key), { title: it.title, text, chars: text.length });
        doneSet.add(key);
        await store.set(K_DONE(label), [...doneSet]);

        state.progress.done += 1;
        state.progress.chars += text.length;
        state.progress.message = `第 ${state.progress.done}/${all.length} 章 · ${paragraphs} 段 · ${text.length} 字`;
        log(`${it.title} → ${text.length} 字 (${Math.round(performance.now() - t0)}ms)`);
        render();

        await sleep(jitter());
      }

      state.progress.phase = 'packing';
      state.progress.message = '生成 TXT…';
      render();

      const chapters = [];
      for (const it of all) {
        const key = chapterKey(it);
        const ch = await store.get(K_CH(label, key));
        if (ch) chapters.push({ title: it.title, text: ch.text });
      }
      const txt = buildTxt(toc.title || label, chapters);

      if (opts.download !== false) {
        await downloadTxt(sanitizeFilename(toc.title || label), txt);
      }

      state.progress.phase = 'done';
      state.progress.message = `完成：${chapters.length} 章 / ${txt.length} 字符`;
      log(`完成：${chapters.length} 章`);

      return {
        ok: true,
        label,
        title: toc.title || label,
        chapters: chapters.length,
        chars: txt.length,
        textLength: txt.length,
        sampleHead: txt.slice(0, 40)
      };
    } catch (e) {
      state.progress.phase = e.code === 'CANCELLED' ? 'idle' : 'error';
      state.progress.message = e.code === 'CHALLENGE'
        ? '已暂停：需要人工验证'
        : (e.code === 'CANCELLED' ? '已停止' : `失败：${e.message}`);
      log(state.progress.message);
      throw e;
    } finally {
      state.running = false;
      render();
    }
  }

  function runJob(name, opts = {}) {
    return IS_SHORT ? runShortJob(name, opts) : runLongJob(name, opts);
  }

  /* ---------- panel ---------- */
  let shadow = null;
  let els = {};

  const panelHtml = `
  <style>
    :host { all: initial; }
    .xb {
      position: fixed; right: 16px; bottom: 16px; width: 300px;
      z-index: 2147483647;
      font: 12px/1.5 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
      color: #e8e8e8; background: #1e1f22;
      border: 1px solid #3a3c40; border-radius: 10px;
      box-shadow: 0 8px 28px rgba(0,0,0,.45);
      overflow: hidden;
    }
    .xb-head { display: flex; align-items: center; justify-content: space-between;
      padding: 8px 10px; background: #2a2c30; cursor: default; }
    .xb-head b { font-size: 12px; font-weight: 600; letter-spacing: .3px; }
    .xb-min { background: none; border: 0; color: #aaa; font-size: 14px; cursor: pointer; padding: 0 2px; }
    .xb-body { padding: 10px; }
    .xb.collapsed .xb-body { display: none; }
    .xb label { display: block; color: #9aa0a6; font-size: 11px; margin-bottom: 4px; }
    .xb input[type=text] {
      width: 100%; box-sizing: border-box; padding: 6px 8px; margin-bottom: 8px;
      color: #e8e8e8; background: #141517; border: 1px solid #3a3c40;
      border-radius: 6px; font-size: 12px; outline: none;
    }
    .xb input[type=text]:focus { border-color: #6b8afd; }
    .xb-row { display: flex; gap: 6px; margin-bottom: 8px; }
    .xb button {
      flex: 1; padding: 6px 0; font-size: 12px; cursor: pointer;
      color: #e8e8e8; background: #33363b; border: 1px solid #44474d;
      border-radius: 6px;
    }
    .xb button:hover { background: #3d4148; }
    .xb button.primary { background: #3b5bdb; border-color: #4c6ef5; }
    .xb button.primary:hover { background: #4c6ef5; }
    .xb button:disabled { opacity: .45; cursor: not-allowed; }
    .xb-bar-wrap { height: 4px; background: #2a2c30; border-radius: 2px; overflow: hidden; margin-bottom: 6px; }
    .xb-bar { height: 100%; width: 0; background: #4c6ef5; transition: width .25s; }
    .xb-status { color: #c9cdd2; min-height: 18px; margin-bottom: 6px; word-break: break-all; }
    .xb-log { height: 62px; overflow: auto; background: #141517; border: 1px solid #2a2c30;
      border-radius: 6px; padding: 4px 6px; color: #8b9096; font-size: 11px; white-space: pre-wrap; }
    .xb-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; gap: 6px; }
    .xb-foot label { display: flex; align-items: center; gap: 4px; margin: 0; color: #9aa0a6; font-size: 11px; }
    .xb-diag { flex: 0 0 auto; padding: 4px 8px; font-size: 11px; }
  </style>
  <div class="xb" id="xb-panel">
    <div class="xb-head"><b>XB 下载器 v${VERSION}</b><button class="xb-min" title="收起">—</button></div>
    <div class="xb-body">
      <label class="xb-label">书名（站内标签）</label>
      <input type="text" class="xb-input" placeholder="例如：出差">
      <div class="xb-row">
        <button class="xb-start primary">开始</button>
        <button class="xb-pause">暂停</button>
        <button class="xb-stop">停止</button>
      </div>
      <div class="xb-bar-wrap"><div class="xb-bar"></div></div>
      <div class="xb-status">待机</div>
      <div class="xb-log"></div>
      <div class="xb-foot">
        <label><input type="checkbox" class="xb-test"> 只跑 2 章（测试）</label>
        <button class="xb-diag">复制诊断</button>
      </div>
    </div>
  </div>`;

  function mountPanel() {
    if (shadow || !document.body) return;
    const host = document.createElement('div');
    host.id = 'xb-host';
    shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = panelHtml;
    document.body.appendChild(host);

    els = {
      panel: shadow.querySelector('.xb'),
      label: shadow.querySelector('.xb-label'),
      input: shadow.querySelector('.xb-input'),
      start: shadow.querySelector('.xb-start'),
      pause: shadow.querySelector('.xb-pause'),
      stop: shadow.querySelector('.xb-stop'),
      bar: shadow.querySelector('.xb-bar'),
      status: shadow.querySelector('.xb-status'),
      log: shadow.querySelector('.xb-log'),
      test: shadow.querySelector('.xb-test'),
      diag: shadow.querySelector('.xb-diag'),
      min: shadow.querySelector('.xb-min')
    };

    if (IS_SHORT) {
      els.input.value = isShortPostUrl(location.href) ? location.href : '';
      els.label.textContent = '短篇链接（留空用当前页）';
      els.start.textContent = '下载本篇';
      els.test.closest('label').style.display = 'none';
    } else {
      els.input.value = labelFromLocation() || '';
    }

    if (isChallenge(document)) {
      state.progress.message = '当前是验证页，请先完成验证';
    } else if (!IS_SHORT && els.input.value.trim()) {
      checkResume(els.input.value.trim());
    }
    els.start.addEventListener('click', () => {
      const raw = els.input.value.trim() || (IS_SHORT ? location.href : '');
      const maxChapters = !IS_SHORT && els.test.checked ? 2 : undefined;
      runJob(raw, { maxChapters }).catch(() => {});
    });
    els.pause.addEventListener('click', () => {
      if (state.running) {
        state.paused = !state.paused;
        els.pause.textContent = state.paused ? '继续' : '暂停';
        state.progress.message = state.paused ? '已暂停' : '继续抓取…';
        render();
      }
    });
    els.stop.addEventListener('click', () => { state.stop = true; });
    els.min.addEventListener('click', () => els.panel.classList.toggle('collapsed'));
    els.diag.addEventListener('click', copyDiagnostics);

    render();
  }

  async function checkResume(label) {
    if (state.running) return;
    const toc = await store.get(K_TOC(label));
    if (!toc || !Array.isArray(toc.toc)) return;
    const done = (await store.get(K_DONE(label))) || [];
    if (!done.length) return;
    state.progress = {
      phase: 'idle',
      label,
      done: done.length,
      total: toc.toc.length,
      chars: 0,
      message: `发现未完成任务：${done.length}/${toc.toc.length} 章，点“开始”继续`
    };
    render();
  }

  function render() {
    if (!els.status) return;
    els.status.textContent = state.progress.message || '待机';
    const total = state.progress.total || 0;
    const pct = total ? Math.round((state.progress.done / total) * 100) : 0;
    els.bar.style.width = pct + '%';
    els.log.textContent = state.logs.slice(-6).join('\n');
    els.log.scrollTop = els.log.scrollHeight;
    els.start.disabled = state.running;
    els.pause.disabled = !state.running;
    els.stop.disabled = !state.running;
  }

  async function copyDiagnostics() {
    const report = {
      version: VERSION,
      time: new Date().toISOString(),
      url: location.href,
      title: document.title,
      challenge: isChallenge(document),
      selectors: {
        postOuter: document.querySelectorAll('.post-outer').length,
        postBody: document.querySelectorAll('.post-body.entry-content').length,
        pagerOlder: document.querySelectorAll('#blog-pager-older-link a').length
      },
      progress: state.progress,
      running: state.running,
      paused: state.paused,
      logs: state.logs.slice(-20)
    };
    const text = JSON.stringify(report, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      log('诊断已复制到剪贴板');
    } catch {
      console.log('[XB] diagnostics', report);
      log('复制失败，已打印到控制台');
    }
  }

  /* ---------- boot ---------- */
  function boot() {
    if (document.body) mountPanel();
    else document.addEventListener('DOMContentLoaded', mountPanel, { once: true });
  }
  boot();

  /* ---------- messaging ---------- */
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'XB_STATUS') {
        sendResponse({ ok: true, ...publicStatus() });
        return true;
      }
      if (msg.type === 'XB_START') {
        if (state.running) { sendResponse({ ok: false, error: '已有任务在运行' }); return true; }
        runJob(msg.name, { maxChapters: msg.maxChapters }).catch(() => {});
        sendResponse({ ok: true });
        return true;
      }
      if (msg.type === 'XB_PAUSE') { state.paused = true; sendResponse({ ok: true, ...publicStatus() }); return true; }
      if (msg.type === 'XB_RESUME') { state.paused = false; sendResponse({ ok: true, ...publicStatus() }); return true; }
      if (msg.type === 'XB_STOP') { state.stop = true; sendResponse({ ok: true, ...publicStatus() }); return true; }
      return false;
    });
  }

  function publicStatus() {
    return {
      running: state.running,
      paused: state.paused,
      progress: { ...state.progress },
      logs: state.logs.slice(-8)
    };
  }

  /* ---------- debug API ---------- */
  window.__XB__ = {
    version: VERSION,
    probe() {
      return {
        version: VERSION,
        mode: IS_SHORT ? 'short' : 'long',
        url: location.href,
        title: document.title,
        challenge: isChallenge(document),
        label: labelFromLocation(),
        counts: {
          postOuter: document.querySelectorAll('.post-outer').length,
          postBody: document.querySelectorAll('.post-body.entry-content').length,
          pagerOlder: document.querySelectorAll('#blog-pager-older-link a').length,
          shortTitle: document.querySelectorAll('article.post h1.post__title, h1.post__title').length,
          shortContent: document.querySelectorAll('article.post .post__content, .post__content').length
        }
      };
    },
    start: (name, opts = {}) => runJob(name, opts),
    short: (url) => runShortJob(url, {}),
    pause: () => { state.paused = true; render(); return publicStatus(); },
    resume: () => { state.paused = false; render(); return publicStatus(); },
    stop: () => { state.stop = true; return publicStatus(); },
    status: () => publicStatus(),
    toc: (label) => collectToc(label),
    clear: async (label) => {
      await store.del(K_TOC(label));
      await store.del(K_DONE(label));
      return true;
    }
  };
})();
