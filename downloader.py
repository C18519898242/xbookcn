import requests
from bs4 import BeautifulSoup
import os
import json
import time
import re
from urllib.parse import unquote

def get_chapters_from_label_page(novel_name):
    """从标签页获取小说的所有章节链接"""
    label_url = f"https://book.xbookcn.net/search/label/{novel_name}?max-results=9999"
    print(f"正在从标签页获取章节: {label_url}")
    html = get_html(label_url)
    if not html:
        return []
    
    soup = BeautifulSoup(html, 'html.parser')
    chapters = []
    chapter_id = 1
    # 根据web_fetch的输出，链接在<h3>标签中
    for h3_tag in soup.find_all('h3'):
        link_tag = h3_tag.find('a')
        if link_tag and link_tag.has_attr('href'):
            title = link_tag.text.strip()
            # 过滤掉导航链接
            if '下一页' in title or '主页' in title:
                continue
            url = requests.compat.urljoin(label_url, link_tag['href'])
            chapters.append({'id': chapter_id, 'title': title, 'url': url})
            chapter_id += 1
    return chapters

def save_chapters_to_json(novel_name, chapters):
    """将章节列表保存到JSON文件"""
    if not os.path.exists('chapters'):
        os.makedirs('chapters')
    
    file_path = os.path.join('chapters', f'{novel_name}_chapters.json')
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(chapters, f, ensure_ascii=False, indent=4)
    print(f"章节列表已保存到: {file_path}")


def get_html(url, retries=3, delay=3):
    """获取指定URL的HTML内容，带重试机制"""
    for attempt in range(retries):
        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()  # 如果请求失败则引发HTTPError
            # 移除强制编码，让 requests 自动检测
            return response.text
        except requests.exceptions.RequestException as e:
            print(f"获取HTML时出错: {e}。这是第 {attempt + 1}/{retries} 次尝试。")
            if attempt < retries - 1:
                print(f"将在 {delay} 秒后重试...")
                time.sleep(delay)
    print(f"获取 {url} 失败，已达到最大重试次数。")
    return None

def load_config():
    """加载配置文件"""
    config_path = 'config.json'
    default_path = 'novels'
    
    if not os.path.exists(config_path):
        print(f"未找到配置文件 '{config_path}'，将使用默认下载路径 '{default_path}'。")
        return default_path

    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
            path = config.get('download_path')
            if not path or not isinstance(path, str):
                print(f"配置文件中 'download_path' 无效，将使用默认路径 '{default_path}'。")
                return default_path
            # 替换反斜杠以确保路径正确
            return path.replace('\\', '/')
    except json.JSONDecodeError:
        print(f"配置文件 '{config_path}' 格式错误，将使用默认路径 '{default_path}'。")
        return default_path
    except Exception as e:
        print(f"加载配置文件时出错: {e}，将使用默认路径 '{default_path}'。")
        return default_path

def get_chapter_links(index_url):
    """从目录页获取所有章节的链接"""
    html = get_html(index_url)
    if not html:
        return [], None
    
    soup = BeautifulSoup(html, 'html.parser')
    
    book_title = soup.find('h1').text.strip()
    
    links = []
    # 假设章节链接在 <div id="list"> 中的 <a> 标签内
    list_div = soup.find('div', id='list')
    if list_div:
        for a_tag in list_div.find_all('a'):
            chapter_title = a_tag.text.strip()
            chapter_url = requests.compat.urljoin(index_url, a_tag['href'])
            links.append((chapter_title, chapter_url))
            
    return links, book_title

def get_chapter_content(chapter_url):
    """获取并解析单个章节的内容"""
    html = get_html(chapter_url)
    if not html:
        return None
        
    soup = BeautifulSoup(html, 'html.parser')
    
    # 根据页面结构，内容可能在 class="post-body" 的div中
    content_div = soup.find('div', class_='post-body')
    if content_div:
        # 移除不需要的脚本、样式和导航链接
        for unwanted in content_div.find_all(['script', 'style', 'div', 'span']):
            # 特别是移除包含导航链接的div
            if unwanted.find('a', string='上一页') or unwanted.find('a', string='下一页'):
                unwanted.decompose()
        
        return content_div.get_text('\n', strip=True)
    return None

def save_novel(book_title, chapters):
    """将小说内容保存到文本文件中"""
    download_path = load_config()
    
    try:
        if not os.path.exists(download_path):
            os.makedirs(download_path)
            print(f"已创建下载目录: {download_path}")
    except OSError as e:
        print(f"创建目录 {download_path} 失败: {e}")
        print("请检查路径是否有效或权限是否正确。")
        return

    file_path = os.path.join(download_path, f'{book_title}.txt')
    
    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            for title, content in chapters:
                f.write(f"# {title}\n\n")
                f.write(content)
                f.write('\n\n')
        print(f"小说已保存到: {file_path}")
    except IOError as e:
        print(f"保存文件 {file_path} 失败: {e}")
        print("请检查磁盘空间或文件权限。")

def download_from_json(novel_name):
    """从JSON文件加载章节列表并下载小说"""
    json_path = os.path.join('chapters', f'{novel_name}_chapters.json')
    if not os.path.exists(json_path):
        print(f"错误: 未找到章节文件 {json_path}")
        print("请先使用选项 '1' 生成章节列表。")
        return

    with open(json_path, 'r', encoding='utf-8') as f:
        chapters_from_json = json.load(f)

    if not chapters_from_json:
        print("章节文件为空，无法下载。")
        return

    print(f"从 {json_path} 加载了 {len(chapters_from_json)} 个章节。")
    
    all_chapters_content = []
    for chapter in chapters_from_json:
        print(f"正在下载章节 {chapter['id']}: {chapter['title']}")
        content = get_chapter_content(chapter['url'])
        if content:
            all_chapters_content.append((chapter['title'], content))
        else:
            print(f"下载章节失败: {chapter['title']}")
    
    if all_chapters_content:
        print("所有章节下载完成，正在保存...")
        save_novel(novel_name, all_chapters_content)
    else:
        print("没有下载到任何内容。")

def download_novel_from_url(index_url):
    """根据给定的URL下载单本小说"""
    print("正在获取章节列表...")
    chapter_links, book_title = get_chapter_links(index_url)

    if not chapter_links or not book_title:
        print("无法获取章节列表或书名，程序退出。")
        return

    print(f"书名: {book_title}")
    print(f"共找到 {len(chapter_links)} 个章节。")

    all_chapters = []
    for i, (title, url) in enumerate(chapter_links, 1):
        print(f"正在下载章节: {title} ({i}/{len(chapter_links)})")
        content = get_chapter_content(url)
        if content:
            all_chapters.append((title, content))
        else:
            print(f"下载章节失败: {title}")

    if all_chapters:
        print("所有章节下载完成，正在保存...")
        save_novel(book_title, all_chapters)
    else:
        print("没有下载到任何内容。")

def download_long_novel():
    """下载长篇小说的完整流程"""
    novel_name = input("请输入长篇小说名称 (例如: 烈火凤凰): ").strip()
    if not novel_name:
        print("小说名称不能为空。")
        return

    # 1. 获取章节列表
    print(f"\n正在为《{novel_name}》获取章节列表...")
    chapters = get_chapters_from_label_page(novel_name)
    
    if not chapters:
        print(f"未能找到《{novel_name}》的章节列表，请检查小说名称是否正确。")
        return

    print(f"成功找到 {len(chapters)} 个章节。正在保存章节信息...")
    
    # 2. 保存章节列表到JSON
    save_chapters_to_json(novel_name, chapters)

    # 3. 下载小说本体
    print(f"\n即将开始下载《{novel_name}》的小说内容...")
    download_from_json(novel_name)

    print(f"\n《{novel_name}》下载完成。")

def get_and_save_short_story_categories():
    """获取所有短篇小说分类并保存到JSON文件，过滤掉时间分类"""
    categories_url = "https://blog.xbookcn.net/p/all.html"
    print(f"正在从 {categories_url} 获取所有分类...")
    html = get_html(categories_url)
    if not html:
        print("获取分类页面失败。")
        return

    soup = BeautifulSoup(html, 'html.parser')
    categories = []
    
    content_div = soup.find('div', class_='post-body')
    if content_div:
        for link_tag in content_div.find_all('a'):
            if link_tag and link_tag.has_attr('href'):
                title = link_tag.text.strip()
                # 过滤掉时间相关的分类，例如 "2021年12月"
                if title and not re.match(r'^\d{4}年\d{1,2}月$', title):
                    raw_url = requests.compat.urljoin(categories_url, link_tag['href'])
                    url = unquote(raw_url)
                    categories.append({'title': title, 'url': url})
    
    if not categories:
        print("未能找到任何有效分类。")
        return

    print(f"成功找到 {len(categories)} 个有效分类。")

    if not os.path.exists('categories'):
        os.makedirs('categories')
    
    file_path = os.path.join('categories', 'short_story_categories.json')
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(categories, f, ensure_ascii=False, indent=4)
    print(f"分类列表已保存到: {file_path}")

def handle_stories_in_category(category_url, category_name):
    """获取分类下的小说，并让用户选择下载单个或全部"""
    full_url = f"{category_url}?max-results=9999"
    print(f"正在从分类页面 {full_url} 获取小说列表...")
    html = get_html(full_url)
    if not html:
        print("获取分类页面失败。")
        return

    soup = BeautifulSoup(html, 'html.parser')
    stories_in_category = []
    
    for h3_tag in soup.find_all('h3'):
        link_tag = h3_tag.find('a')
        if link_tag and link_tag.has_attr('href'):
            title = link_tag.text.strip()
            if '下一页' in title or '主页' in title:
                continue
            url = requests.compat.urljoin(full_url, link_tag['href'])
            stories_in_category.append({'title': title, 'url': url})

    if not stories_in_category:
        print("在该分类下没有找到任何小说。")
        return

    print(f"\n--- 分类 '{category_name}' 下的小说列表 ---")
    for i, story in enumerate(stories_in_category, 1):
        print(f"{i}. {story['title']}")
    print("---------------------------------------")

    choice = input("请输入小说编号或名称进行单篇下载，或直接按 Enter 下载全部: ").strip()

    download_path = load_config()
    safe_category_name = "".join(c for c in category_name if c.isalnum() or c in (' ', '_')).rstrip()
    category_save_path = os.path.join(download_path, safe_category_name)
    
    try:
        if not os.path.exists(category_save_path):
            os.makedirs(category_save_path)
    except OSError as e:
        print(f"创建目录 {category_save_path} 失败: {e}")
        return

    stories_to_download = []
    if not choice:
        print(f"\n准备下载分类 '{category_name}' 下的全部 {len(stories_in_category)} 篇小说...")
        stories_to_download = stories_in_category
    else:
        target_story = None
        if choice.isdigit():
            choice_index = int(choice) - 1
            if 0 <= choice_index < len(stories_in_category):
                target_story = stories_in_category[choice_index]
        else:
            for story in stories_in_category:
                if story['title'] == choice:
                    target_story = story
                    break
        
        if not target_story:
            print(f"未能找到编号或名称为 '{choice}' 的小说。")
            return
        
        print(f"\n准备下载单篇小说: {target_story['title']}")
        stories_to_download.append(target_story)

    if not stories_to_download:
        return

    total = len(stories_to_download)
    for i, story in enumerate(stories_to_download, 1):
        print(f"正在下载 ({i}/{total}): {story['title']}")
        content = get_chapter_content(story['url'])
        if content:
            safe_title = "".join(c for c in story['title'] if c.isalnum() or c in (' ', '_')).rstrip()
            file_path = os.path.join(category_save_path, f"{safe_title}.txt")
            try:
                with open(file_path, 'w', encoding='utf-8') as f:
                    f.write(f"# {story['title']}\n\n")
                    f.write(content)
                print(f" -> 已保存到: {file_path}")
            except (IOError, OSError) as e:
                print(f"保存文件 {file_path} 失败: {e}")
        else:
            print(f"下载失败: {story['title']}")
    
    if total > 1:
        print(f"\n分类 '{category_name}' 下载完成。")
    elif total == 1:
        print(f"\n小说《{stories_to_download[0]['title']}》下载完成。")

def download_short_stories_by_category():
    """处理按分类下载短篇小说的逻辑，提供列表选择"""
    categories_path = os.path.join('categories', 'short_story_categories.json')

    if not os.path.exists(categories_path):
        print("本地未找到分类文件。请先通过主菜单选项 '3' 更新分类列表。")
        return

    try:
        with open(categories_path, 'r', encoding='utf-8') as f:
            categories = json.load(f)
    except (json.JSONDecodeError, FileNotFoundError) as e:
        print(f"读取分类文件时出错: {e}。请尝试通过主菜单选项 '3' 重新获取分类列表。")
        return

    print("\n--- 可用分类列表 ---")
    for i, category in enumerate(categories, 1):
        print(f"{i}. {category['title']}")
    print("--------------------")

    choice = input("请输入分类编号或完整的分类名称: ").strip()
    if not choice:
        print("输入不能为空。")
        return

    target_category = None
    # 检查输入是否为数字（编号）
    if choice.isdigit():
        choice_index = int(choice) - 1
        if 0 <= choice_index < len(categories):
            target_category = categories[choice_index]
        else:
            print("无效的编号。")
            return
    # 如果不是数字，则按名称搜索
    else:
        for category in categories:
            if category['title'] == choice:
                target_category = category
                break
    
    if not target_category:
        print(f"未能找到名为 '{choice}' 的分类。请检查输入是否正确。")
        return

    print(f"\n您已选择分类: {target_category['title']}")
    handle_stories_in_category(target_category['url'], target_category['title'])

def main():
    """主函数：让用户选择下载长篇或短篇小说。"""
    while True:
        print("\n请选择操作:")
        print("1. 下载长篇小说 (通过名称搜索)")
        print("2. 下载短篇小说 (按分类下载)")
        print("3. 更新短篇小说分类列表")
        print("4. 退出")
        
        choice = input("请输入您的选择 (1, 2, 3, 或 4): ").strip()
        
        if choice == '1':
            download_long_novel()
        elif choice == '2':
            download_short_stories_by_category()
        elif choice == '3':
            get_and_save_short_story_categories()
        elif choice == '4':
            print("程序已退出。")
            break
        else:
            print("无效的输入，请输入 1, 2, 3, 或 4。")


if __name__ == '__main__':
    main()
