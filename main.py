import json
import os
import requests
import logging
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import time

DEFAULT_SAVE_PATH = "Z:\\nextcloud\\data\\admin\\files\\Documents\\小说"

# 配置日志
logging.basicConfig(
    level=logging.DEBUG,  # 设置日志等级为 DEBUG
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',  # 设置日志格式
    datefmt='%Y-%m-%d %H:%M:%S'  # 设置时间格式
)


def download_novel(book, out_path, get_chapter_handle):
    chapter_object_list = get_chapter_handle(out_path, book)
    with open('{out_path}/{book}.txt'.format(out_path=out_path, book=book), 'w', encoding='utf-8') as f:
        # 书名
        f.write('{book} \n\n'.format(book=book))
        for chapter_object in chapter_object_list:
            title = chapter_object.get("title")
            url = chapter_object.get("url")

            logging.info("正在下载 {title}".format(title=title))
            f.write(title + '\n\n')
            content = get_chapter_content(url)
            f.write(content)
            f.write('\n\n')
    logging.info("下载完成")


def get_chapter_from_url(out_path, book):
    # 发送请求获取HTML页面
    url = "https://book.xbookcn.net/search/label/{book}?max-results=10000&start=0&by-date=false"
    url = url.format(book=book)
    response = requests.get(url)
    html_content = response.text

    # 解析HTML页面获取所有章节标题
    soup = BeautifulSoup(html_content, 'html.parser')
    chapter_list = soup.find_all('h3', class_='post-title entry-title')

    chapter_object_list = []
    for chapter in chapter_list:
        title = chapter.text.strip().replace("{book} ".format(book=book), "")
        if "第" in title and ("集" in title or "卷" in title):  # 检查标题是否包含"第"和"集"
            part = chapter.text.strip().replace("{book} ".format(book=book), "")  # 第一集 淫魔降世

        if "第" in title and ("章" in title or "话" in title):  # 检查标题是否包含"第"和"章"
            if part:
                title = part + " " + title  # 第一集 淫魔降世 第一章 炼狱咖啡
            url = chapter.a['href']
            chapter_object = {
                "title": title,
                "url": url
            }
            chapter_object_list.append(chapter_object)

    return chapter_object_list


def get_chapter_from_file(out_path, book):
    book_path = "{out_path}\\{book}-chapter.json".format(book=book, out_path=out_path)
    with open(book_path, 'r', encoding='utf-8') as f:
        chapter_object_list = json.load(f)
    return chapter_object_list


def download_short_story(book, chapter, url, out_path):
    file_name = '{out_path}/{book}.txt'.format(out_path=out_path, book=book)
    if os.path.exists(file_name):
        mode = 'a'
    else:
        mode = 'w'

    with open(file_name, mode, encoding='utf-8') as f:
        logging.info("正在下载 {book}".format(book=book))
        f.write('{chapter} \n\n'.format(chapter=chapter))
        content = get_chapter_content(url)
        f.write(content)
        f.write('\n\n')


def get_chapter_content(url):
    # 配置 requests Retry
    retries = Retry(total=5, backoff_factor=1, status_forcelist=[500, 502, 503, 504])
    session = requests.Session()
    session.mount('https://', HTTPAdapter(max_retries=retries))

    while True:
        try:
            response = session.get(url, verify=False)
            response.raise_for_status()  # Raise an HTTPError for 4xx/5xx status codes
            html_content = response.text
            break
        except requests.exceptions.RequestException as e:
            logging.warning("Network error occurred: {0}. Retrying in 5 seconds...".format(str(e)))
            time.sleep(5)

    soup = BeautifulSoup(html_content, 'html.parser')

    content_div = soup.select_one('div[itemprop="description articleBody"]')
    paragraphs = content_div.find_all('p')
    content = '\n\n'.join([p.get_text().strip() for p in paragraphs])
    return content.strip()


if __name__ == "__main__":
    category = input("请输入下载小说类型 （1. 长篇 2. 短篇, 3. 长篇-本地章节文件 ）默认为 1: ")
    if not category:
        category = "1"

    book_name = ""
    while not book_name:
        book_name = input("请输入书名：")

    save_path = input("请输入小说保存文件夹 (默认文件夹 {save_path}): ".format(save_path=DEFAULT_SAVE_PATH))
    if not save_path:
        save_path = DEFAULT_SAVE_PATH

    # 根据不同种类小说使用不同函数下载
    if category == "1":
        download_novel(book_name, save_path, get_chapter_from_url)

    if category == "2":
        chapter_name = book_name
        chapter_name = input("请输入章节名：")

        book_url = ""
        while not book_url:
            book_url = input("请输下载的小说 url：")
        download_short_story(book_name, chapter_name, book_url, save_path)
        pass

    if category == "3":
        download_novel(book_name, save_path, get_chapter_from_file)
