import io
from pathlib import Path
import time
import zipfile

import pytest
from fastapi.testclient import TestClient

from backend.core import Library
from backend.epub import read_epub
from backend.folders import FolderSync
from backend.server import create_app
from test_library import DeterministicEmbeddings, pdf_bytes, wait_ready


def epub_bytes(value='4200', encrypted=False, attack=False):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as book:
        book.writestr('mimetype', 'application/epub+zip')
        book.writestr('META-INF/container.xml', '''<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>''')
        book.writestr('OPS/book.opf', '''<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest>
            <item id="later" href="chapter%202.xhtml" media-type="application/xhtml+xml"/>
            <item id="first" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
            </manifest><spine><itemref idref="first"/><itemref idref="later"/></spine></package>''')
        book.writestr('OPS/chapter1.xhtml', '<html><head><title>Not evidence</title><style>malicious-style</style></head><body><h1>第一章 · Orchid 計劃</h1><p>Orchid 計劃於 2026 年 10 月 12 日啟動。</p><script>malicious-script</script></body></html>')
        book.writestr('OPS/chapter 2.xhtml', f'<html><body><h1>第二章 · 預算</h1><p>Orchid 計劃預算是 {value} 港元。</p><p>每位研究員獲發 2 本參考書。</p></body></html>')
        if encrypted:
            book.writestr('META-INF/encryption.xml', '<encryption><EncryptedData><CipherData><CipherReference URI="OPS/chapter1.xhtml"/></CipherData></EncryptedData></encryption>')
        if attack:
            book.writestr('META-INF/encryption.xml', '<!DOCTYPE test [<!ENTITY x SYSTEM "file:///etc/passwd">]><encryption>&x;</encryption>')
    return output.getvalue()


def scan_ready(sync):
    sync.scan()
    sync.scan()
    for doc in sync.library.documents():
        if doc['status'] in ('queued', 'processing'):
            wait_ready(sync.library, doc['id'])
    sync.scan()


def test_epub_spine_text_citations_api_restart(tmp_path):
    sections = read_epub(epub_bytes())
    assert [s[0] for s in sections] == [1, 2]
    assert sections[0][1] == '第一章 · Orchid 計劃'
    assert 'malicious' not in str(sections)
    app = create_app(tmp_path, 'session', DeterministicEmbeddings())
    with TestClient(app, headers={'Authorization': 'Bearer session'}) as client:
        result = client.post('/api/documents', files={'file': ('book.EPUB', epub_bytes())})
        assert result.status_code == 202
        identifier = result.json()['id']
        doc = wait_ready(app.state.library, identifier)
        assert (doc['format'], doc['pages'], doc['extractor']) == ('epub', 2, 'epub-spine')
        sources = app.state.library.retrieve('Orchid 預算', [identifier], app.state.library.settings())
        assert all(s['format'] == 'epub' and '章' in s['location'] for s in sources)
        assert '4200' in client.get(f'/api/documents/{identifier}/sections/2').json()['text']
        assert client.get(f'/api/documents/{identifier}/pdf').status_code == 409
    library = Library(tmp_path, DeterministicEmbeddings())
    assert '4200' in library.section(identifier, 2)['text']
    source_path = library.source_path(identifier)
    library.delete(identifier)
    assert not source_path.exists()
    library.close()


@pytest.mark.parametrize('kwargs', [{'encrypted': True}, {'attack': True}])
def test_epub_encrypted_or_entity_payload_is_rejected(kwargs):
    with pytest.raises(ValueError):
        read_epub(epub_bytes(**kwargs))


def test_folder_recursive_duplicates_update_missing_restart_detach(tmp_path):
    source = tmp_path / 'books'
    nested = source / 'nested'
    nested.mkdir(parents=True)
    book = nested / 'book.epub'
    book.write_bytes(epub_bytes())
    (source / 'copy.epub').write_bytes(epub_bytes())
    (source / 'paper.pdf').write_bytes(pdf_bytes())
    (source / 'ignored.txt').write_text('ignore')
    library = Library(tmp_path / 'library', DeterministicEmbeddings())
    sync = FolderSync(library)
    folder = sync.add(str(source))
    assert sync.add(str(source))['id'] == folder['id']
    with pytest.raises(ValueError):
        sync.add(str(nested))
    scan_ready(sync)
    assert len(library.documents()) == 2
    assert len(sync.folders()[0]['files']) == 3
    book.write_bytes(epub_bytes('7300'))
    scan_ready(sync)
    # A separate unchanged copy still refers to the original version.
    assert len(library.documents()) == 3
    updated = next(f for f in sync.folders()[0]['files'] if f['path'].endswith('book.epub'))
    identifier = updated['document_id']
    assert '7300' in library.section(identifier, 2)['text']
    book.unlink()
    sync.scan()
    assert library.document(identifier)['status'] == 'ready'
    assert not next(f for f in sync.folders()[0]['files'] if f['document_id'] == identifier)['present']
    sync.close()
    library.close()
    library = Library(tmp_path / 'library', DeterministicEmbeddings())
    sync = FolderSync(library)
    assert sync.folders()[0]['path'] == str(source)
    book.write_bytes(epub_bytes('9800'))
    scan_ready(sync)
    assert library.document(identifier) is None  # Unshared old version retired only after success.
    assert len(library.documents()) == 3
    sync.remove(folder['id'])
    assert sync.folders() == []
    assert len(library.documents()) == 3
    assert book.exists()
    sync.close()
    library.close()


def test_folder_failure_preserves_old_version_retry_and_manual_delete(tmp_path):
    source = tmp_path / 'books'
    source.mkdir()
    book = source / 'book.epub'
    book.write_bytes(epub_bytes())
    library = Library(tmp_path / 'library', DeterministicEmbeddings())
    sync = FolderSync(library)
    sync.add(str(source))
    scan_ready(sync)
    old_id = library.documents()[0]['id']
    book.write_bytes(epub_bytes('7300'))
    class Failure:
        def embed(self, *args, **kwargs):
            raise ValueError('offline')
    library.client = Failure()
    sync.scan()
    sync.scan()
    library.executor.submit(lambda: None).result(timeout=5)
    sync.scan()
    failed = next(d for d in library.documents() if d['status'] == 'error')
    assert library.document(old_id)['status'] == 'ready'
    library.client = DeterministicEmbeddings()
    library.retry(failed['id'])
    wait_ready(library, failed['id'])
    sync.scan()
    assert library.document(old_id) is None
    library.delete(failed['id'])
    scan_ready(sync)
    assert library.documents() == []  # Do not immediately reimport a manually deleted version.
    assert book.exists()
    sync.close()
    library.close()


def test_background_monitor_not_just_manual_scan(tmp_path):
    source = tmp_path / 'books'
    source.mkdir()
    library = Library(tmp_path / 'library', DeterministicEmbeddings())
    sync = FolderSync(library, interval=.03)
    sync.add(str(source))
    sync.start()
    try:
        (source / 'book.epub').write_bytes(epub_bytes())
        for _ in range(200):
            files = sync.folders()[0]['files']
            if files and files[0]['document_id']:
                break
            time.sleep(.02)
        assert files[0]['status'] == 'ready'
        with pytest.raises(ValueError):
            sync.add(str(library.root))
    finally:
        sync.close()
        library.close()


if __name__ == '__main__':
    import sys
    Path(sys.argv[1]).write_bytes(epub_bytes(sys.argv[2] if len(sys.argv) > 2 else '4200'))
