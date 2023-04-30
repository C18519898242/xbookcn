好的，以下是使用说明的 Markdown 格式：

## 使用说明

该 Python 脚本可以从中国网站 "xbookcn.net" 下载小说，支持下载 "长篇" 和 "短篇" 两种类型的小说。

脚本包含以下几个函数：

- `download_novel()`：通过调用 `get_chapter_handle()` 获取章节列表，然后使用 `get_chapter_content()` 下载每个章节并将小说保存到文本文件中。
- `get_chapter_from_url()`：使用 `requests` 和 `BeautifulSoup` 库从网站上爬取章节列表。
- `get_chapter_from_file()`：从本地 JSON 文件中获取章节列表。
- `download_short_story()`：从网站上下载短篇小说并将其保存到文本文件中。
- `get_chapter_content()`：通过向网站发送 HTTP 请求并使用 BeautifulSoup 解析 HTML 响应来获取章节内容。

脚本还包含一些代码行，允许用户输入他们想要下载的小说类型（"长篇" 或 "短篇"）、小说名称和保存路径。

### 运行脚本

运行脚本的方式是在命令行中输入以下命令：

```
python xbookcn_downloader.py
```

### 下载长篇小说

如果要下载长篇小说，请按照以下步骤操作：

1. 在命令行中输入 "1"，表示要下载长篇小说。
2. 输入小说名称。
3. 输入小说保存路径。如果不输入，则默认保存到 "Z:\nextcloud\data\admin\files\Documents\小说"。

### 下载短篇小说

如果要下载短篇小说，请按照以下步骤操作：

1. 在命令行中输入 "2"，表示要下载短篇小说。
2. 输入小说名称作为章节名称。
3. 输入小说网址。
4. 输入小说保存路径。如果不输入，则默认保存到 "Z:\nextcloud\data\admin\files\Documents\小说"。

### 从本地文件下载长篇小说

如果要从本地文件下载长篇小说，请按照以下步骤操作：

1. 在命令行中输入 "3"，表示要从本地文件下载长篇小说。
2. 输入小说名称。
3. 输入小说保存路径。如果不输入，则默认保存到 "Z:\nextcloud\data\admin\files\Documents\小说"。