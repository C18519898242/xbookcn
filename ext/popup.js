const $ = id => document.getElementById(id);
const onSite = $('onSite');
const offSite = $('offSite');

let tabId = null;
let timer = null;
let isShort = false;

function setStatus(text) { $('status').textContent = text; }

function setProgress(done, total) {
  $('bar').style.width = (total ? Math.round((done / total) * 100) : 0) + '%';
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function send(msg) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, msg, resp => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(resp || { ok: false, error: 'no response' });
    });
  });
}

function applyStatus(s) {
  if (!s || !s.ok) return;
  const p = s.progress || {};
  setStatus(p.message || '待机');
  setProgress(p.done || 0, p.total || 0);
  $('start').disabled = !!s.running;
  $('pause').disabled = !s.running;
  $('pause').textContent = s.paused ? '继续' : '暂停';
  $('log').textContent = (s.logs || []).slice(-5).join('\n');
}

async function refresh() {
  if (!tabId) return;
  const s = await send({ type: 'XB_STATUS' });
  if (!s.ok) {
    setStatus('页面未就绪，请刷新书页后重试');
    return;
  }
  applyStatus(s);
}

async function init() {
  const tab = await getActiveTab();
  if (!tab || !/^https:\/\/book\.xbookcn\.net\//.test(tab.url || '')) {
    onSite.hidden = true;
    offSite.hidden = false;
    return;
  }
  tabId = tab.id;
  isShort = /^https:\/\/blog\.xbookcn\.net\//.test(tab.url || '');

  if (isShort) {
    isShort = true;
    $('start').textContent = '下载本篇';
    $('name').value = tab.url;
    const lab = document.querySelector('label[for="name"]');
    if (lab) lab.textContent = '短篇链接';
    $('name').placeholder = '粘贴短篇链接，或留空用当前页';
    document.querySelector('.check').hidden = true;
    setStatus('短篇模式：点“下载本篇”');
  }

  const m = (tab.url || '').match(/\/search\/label\/(.+?)\/?$/);
  if (!isShort && m) {
    try { $('name').value = decodeURIComponent(m[1]); } catch { /* ignore */ }
  }

  const s = await send({ type: 'XB_STATUS' });
  if (!s.ok) {
    setStatus('脚本未注入：请在扩展页点“重新加载”，再刷新书页');
    return;
  }
  applyStatus(s);
  timer = setInterval(refresh, 1000);
}

$('start').addEventListener('click', async () => {
  let name = $('name').value.trim();
  if (!name && isShort) name = (await getActiveTab()).url;
  if (!name) { setStatus('请填写书名'); return; }
  const resp = await send({
    type: 'XB_START',
    name,
    maxChapters: !isShort && $('test').checked ? 2 : undefined
  });
  if (!resp.ok) setStatus(resp.error || '启动失败');
  setTimeout(refresh, 300);
});

$('pause').addEventListener('click', async () => {
  const isPaused = $('pause').textContent === '继续';
  await send({ type: isPaused ? 'XB_RESUME' : 'XB_PAUSE' });
  refresh();
});

$('openSite').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://book.xbookcn.net/' });
});

$('test').addEventListener('change', () => {
  if ($('test').checked) setStatus('测试模式：每个任务只抓前 2 章');
});

init();
window.addEventListener('unload', () => timer && clearInterval(timer));
