import io
import time

import numpy as np
import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

from backend.core import Library, split_text, needs_vision
from backend.server import create_app


class DeterministicEmbeddings:
    """For persistence and orchestration tests only; not a retrieval quality test."""
    def embed(self, texts, settings, query=False):
        return np.array([[1, 0, 0] if 'orchid' in t.lower() else [0, 1, 0] for t in texts], dtype=np.float32)


def pdf_bytes(text='Orchid project launches on 12 October 2026.', second_page=None):
    output = io.BytesIO()
    doc = canvas.Canvas(output)
    doc.drawString(50, 750, text)
    if second_page:
        doc.showPage()
        doc.drawString(50, 750, second_page)
    doc.save()
    return output.getvalue()


def wait_ready(library, doc_id):
    for _ in range(100):
        doc = library.document(doc_id)
        if doc['status'] in ('ready', 'error'):
            assert doc['status'] == 'ready', doc['error']
            return doc
        time.sleep(.02)
    pytest.fail('Import did not finish')


def test_chunk_tail_is_not_duplicated():
    chunks = list(split_text('x' * 1200, size=1000, overlap=200))
    assert [len(c) for c in chunks] == [1000, 400]
    with pytest.raises(ValueError):
        list(split_text('abc', size=2, overlap=2))


def test_font_glyphs_request_vision_instead_of_guessing_symbols():
    assert needs_vision('lifetime is 1:0/.00060:1 ms')
    assert needs_vision('lifetime is 1.0\x01 0.1 ms')
    assert needs_vision('')
    assert not needs_vision('Lifetime is 1.0 ± 0.1 ms.')


def test_pdf_import_duplicate_scope_restart_delete(tmp_path):
    library = Library(tmp_path, DeterministicEmbeddings())
    content = pdf_bytes(second_page='The project budget is 4200 dollars.')
    first = library.enqueue('orchid.pdf', content)
    document = wait_ready(library, first['id'])
    assert document['pages'] == 2
    assert document['chunks'] == 2
    assert library.enqueue('renamed.pdf', content) == {'id': first['id'], 'duplicate': True}
    second = library.enqueue('other.pdf', pdf_bytes('A separate research document.'))
    wait_ready(library, second['id'])
    results = library.retrieve('orchid', [first['id']], library.settings())
    assert {r['document_id'] for r in results} == {first['id']}
    assert {r['page'] for r in results} == {1, 2}
    conversation = library.new_conversation('Launch date?')
    library.add_message(conversation, 'assistant', '12 October [1]', results)
    library.close()
    restarted = Library(tmp_path, DeterministicEmbeddings())
    assert len(restarted.documents()) == 2
    assert restarted.history(conversation)[0]['sources'][0]['name'] == 'orchid.pdf'
    restarted.delete(first['id'])
    assert not (tmp_path / 'pdfs' / f"{first['id']}.pdf").exists()
    assert restarted.retrieve('orchid', [first['id']], restarted.settings()) == []
    assert restarted.history(conversation)[0]['sources'] == []
    restarted.close()
    again = Library(tmp_path, DeterministicEmbeddings())
    assert len(again.documents()) == 1
    again.close()


def test_settings_model_change_requires_empty_library(tmp_path):
    library = Library(tmp_path, DeterministicEmbeddings())
    doc = library.enqueue('a.pdf', pdf_bytes())
    wait_ready(library, doc['id'])
    settings = library.settings()
    settings['model'] = 'another-generator'
    library.save_settings(settings)
    assert library.settings()['model'] == 'another-generator'
    settings['embedding_model'] = 'different-embedding'
    with pytest.raises(ValueError):
        library.save_settings(settings)
    library.close()


def test_failed_import_can_retry(tmp_path):
    class Failing:
        def embed(self, *args, **kwargs):
            raise ValueError('Embedding unavailable')
    library = Library(tmp_path, Failing())
    doc = library.enqueue('a.pdf', pdf_bytes())
    for _ in range(100):
        if library.document(doc['id'])['status'] == 'error':
            break
        time.sleep(.02)
    assert library.document(doc['id'])['status'] == 'error'
    library.client = DeterministicEmbeddings()
    library.retry(doc['id'])
    wait_ready(library, doc['id'])
    library.close()


def test_api_access_upload_history_and_empty_query(tmp_path):
    app = create_app(tmp_path, 'test-session', DeterministicEmbeddings())
    with TestClient(app) as client:
        assert client.get('/api/health').status_code == 401
        client.headers['Authorization'] = 'Bearer test-session'
        assert client.get('/api/health').status_code == 200
        assert client.post('/api/documents', files={'file': ('bad.pdf', b'not pdf')}).status_code == 400
        assert client.post('/api/chat', json={'question': ' '}).status_code == 422
        assert client.get('/api/health', headers={'origin': 'https://evil.example'}).status_code == 403
        assert client.put('/api/settings', json={'host': 'https://remote.example'}).status_code == 422
        response = client.post('/api/chat', json={'question': 'Question without documents'})
        assert '"type": "done"' in response.text
        conversations = client.get('/api/conversations').json()
        assert len(conversations) == 1
        messages = client.get('/api/conversations/' + conversations[0]['id']).json()
        assert len(messages) == 2
        response = client.post('/api/documents', files={'file': ('notes.pdf', pdf_bytes())})
        assert response.status_code == 202
        doc_id = response.json()['id']
        wait_ready(app.state.library, doc_id)
        assert client.get(f'/api/documents/{doc_id}/pdf').content.startswith(b'%PDF')
        assert client.delete(f'/api/documents/{doc_id}').status_code == 200
        assert client.get(f'/api/documents/{doc_id}/pdf').status_code == 404
        assert client.get('/api/documents').json() == []


def test_generation_error_releases_lock_and_does_not_save_a_false_answer(tmp_path, monkeypatch):
    class UnavailableResponse:
        status_code = 503
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def aread(self): return b'unavailable'

    class UnavailableClient:
        def __init__(self, *args, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        def stream(self, *args, **kwargs): return UnavailableResponse()

    app = create_app(tmp_path, 'test-session', DeterministicEmbeddings())
    with TestClient(app, headers={'Authorization': 'Bearer test-session'}) as client:
        doc = app.state.library.enqueue('notes.pdf', pdf_bytes())
        wait_ready(app.state.library, doc['id'])
        monkeypatch.setattr('backend.server.httpx.AsyncClient', UnavailableClient)
        for _ in range(2):
            response = client.post('/api/chat', json={'question': 'When does Orchid launch?'})
            assert response.status_code == 200
            assert '"type": "error"' in response.text
            assert '"type": "done"' not in response.text
        with app.state.library.connect() as db:
            assert db.execute("SELECT count(*) FROM messages WHERE role='assistant'").fetchone()[0] == 0
