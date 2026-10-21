# XB 下载器（Chrome 扩展）

`ext/` 是 [xbookcn.net](https://book.xbookcn.net/) 的浏览器扩展版本，作为根目录 Python 脚本的补充：

- 不导出 Cookie、不绕过 Cloudflare；复用浏览器里已经通过验证的会话
- 长篇：按书名抓取整本，自动翻目录、逐章合并
- 短篇：单篇页面一键下载，或粘贴链接
- 输出适合手机阅读的 TXT（UTF-8 BOM + CRLF）

## 安装

1. 打开 `chrome://extensions`
2. 右上角开启 **开发者模式**
3. 点 **加载已解压的扩展程序**
4. 选择本目录 `ext/`
5. 建议把图标固定到工具栏

更新代码后，在扩展页点一下 **重新加载**，再刷新书页。

## 使用

### 长篇

1. 打开 `https://book.xbookcn.net/search/label/<书名>`（或任意书页）
2. 右下角面板里确认书名
3. 点 **开始**
4. 完成后 TXT 保存到系统下载目录

- 每页 20 章，脚本会自动跟随“下一页”
- 章节按目录顺序合并
- 勾选“只跑 2 章（测试）”可先验证链路

### 短篇

1. 打开 `https://blog.xbookcn.net/YYYY/MM/<slug>` 单篇页面
2. 点面板里的 **下载本篇**
3. 或在面板里粘贴另一篇的链接再点

短篇站没有可用的站内搜索（`/search?q=` 会跳回首页），所以只支持“当前页 / 粘贴链接”。

## 文件

| 文件 | 作用 |
|---|---|
| `manifest.json` | MV3 清单，权限与注入范围 |
| `content.js` | 核心：解析目录/正文、翻页、清洗、拼接、断点 |
| `background.js` | 调 `chrome.downloads` 写文件 |
| `popup.html/css/js` | 工具栏弹窗 |
| `icons/` | 16/32/48/128 图标 |

## 行为说明

- **断点**：每章写入 `chrome.storage.local`，中断后重新点“开始”会跳过已完成章节
- **限速**：章节间隔 1.2–1.9 秒；不并发
- **验证页**：检测到 Cloudflare 挑战时暂停，完成验证后点“继续”重试当前章
- **失败**：404/空章会记录在日志，不阻塞后续章节

## 权限

- `storage` / `unlimitedStorage`：保存断点与章节文本
- `downloads`：写出 TXT
- `host_permissions`：仅 `book.xbookcn.net` 与 `blog.xbookcn.net`

## 说明

仅供个人离线阅读使用。正文版权归原作者与首发平台所有，请勿再分发。
