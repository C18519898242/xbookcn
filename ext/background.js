/* XB 下载器：负责把 TXT 写入下载目录。
 * 内容脚本无法直接调用 chrome.downloads，统一由这里处理。
 */
function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'XB_SAVE') return false;

  try {
    const url = 'data:text/plain;charset=utf-8;base64,' + toBase64(msg.text || '');
    chrome.downloads.download(
      { url, filename: msg.filename || 'book.txt', saveAs: false, conflictAction: 'overwrite' },
      id => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true, id });
        }
      }
    );
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
  return true;
});
