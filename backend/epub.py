"""Read EPUB 2/3 spine text without extracting archives or executing book content."""
import io
import posixpath
import re
import zipfile
from html.parser import HTMLParser
from urllib.parse import unquote, urlsplit

from defusedxml import ElementTree as ET


class ChapterText(HTMLParser):
    BLOCKS = {'p', 'div', 'section', 'article', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'blockquote'}
    SKIP = {'head', 'script', 'style', 'nav', 'svg'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.heading = [], []
        self.skip = 0
        self.in_heading = False
        self.title = ''

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        if self.skip:
            return
        if tag in self.BLOCKS:
            self.parts.append('\n\n')
        if tag in ('h1', 'h2', 'h3') and not self.title:
            self.in_heading = True
        if tag == 'img' and dict(attrs).get('alt'):
            self.parts.append(' ' + dict(attrs)['alt'] + ' ')

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        if tag in ('h1', 'h2', 'h3') and self.in_heading:
            self.title = ''.join(self.heading).strip()
            self.in_heading = False
        if tag in self.BLOCKS:
            self.parts.append('\n\n')
        elif tag in ('td', 'th'):
            self.parts.append(' | ')

    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)
            if self.in_heading:
                self.heading.append(data)


def archive_path(base, href):
    parsed = urlsplit(href)
    name = posixpath.normpath(posixpath.join(base, unquote(parsed.path)))
    if parsed.scheme or parsed.netloc or name.startswith(('/', '../')) or '\\' in name:
        raise ValueError('EPUB 內含無效的資源路徑。')
    return name


def read_epub(content: bytes):
    """Return (spine position, title, plain text); spine positions are not page numbers."""
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as book:
            entries = book.infolist()
            if len(entries) > 10000 or sum(i.file_size for i in entries) > 200 * 1024 * 1024:
                raise ValueError('EPUB 解壓內容過大（上限 200 MB／10,000 個項目）。')
            if len({i.filename for i in entries}) != len(entries):
                raise ValueError('EPUB 內有重複的資源名稱。')

            def read(name):
                if book.getinfo(name).file_size > 16 * 1024 * 1024:
                    raise ValueError('EPUB 單一章節過大（上限 16 MB）。')
                return book.read(name)

            if read('mimetype').strip() != b'application/epub+zip':
                raise ValueError('這不是有效的 EPUB 文件。')
            container = ET.fromstring(read('META-INF/container.xml'))
            rootfile = container.find('.//{*}rootfile')
            if rootfile is None:
                raise ValueError('EPUB 缺少書籍內容索引。')
            opf_path = archive_path('', rootfile.attrib['full-path'])
            package = ET.fromstring(read(opf_path))
            manifest = {item.attrib['id']: item.attrib for item in package.findall('./{*}manifest/{*}item')}
            encrypted = set()
            if 'META-INF/encryption.xml' in book.namelist():
                encryption = ET.fromstring(read('META-INF/encryption.xml'))
                encrypted = {archive_path('', item.attrib['URI']) for item in encryption.findall('.//{*}CipherReference')}
            sections = []
            for number, itemref in enumerate(package.findall('./{*}spine/{*}itemref'), 1):
                item = manifest[itemref.attrib['idref']]
                filename = archive_path(posixpath.dirname(opf_path), item['href'])
                if filename in encrypted:
                    raise ValueError('此 EPUB 的章節有 DRM／加密保護，無法匯入。請使用未加密的版本。')
                if item.get('media-type') not in ('application/xhtml+xml', 'text/html'):
                    raise ValueError('此 EPUB 含非文字章節，目前只支援文字型 EPUB。')
                raw = read(filename)
                encoding = 'utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig'
                parser = ChapterText()
                parser.feed(raw.decode(encoding))
                text = re.sub(r'[ \t\r\f\v]+', ' ', ''.join(parser.parts))
                text = re.sub(r'\n\s*\n+', '\n\n', text).strip()
                if text:
                    sections.append((number, parser.title[:200] or f'第 {number} 節', text))
            if not sections:
                raise ValueError('EPUB 沒有可讀文字；圖片型書籍目前未支援。')
            return sections
    except ValueError:
        raise
    except Exception as error:
        raise ValueError('EPUB 損壞、格式不完整或文字編碼不支援。') from error
