import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.core import Library
from backend.server import create_app
from backend.prompt import prepare_messages
from backend.folders import FolderSync
from test_library import DeterministicEmbeddings, pdf_bytes, wait_ready
from test_epub_folders import epub_bytes, scan_ready


def test_category_scope_intersection_and_empty_never_expand(tmp_path):
    library = Library(tmp_path, DeterministicEmbeddings())
    try:
        first = library.enqueue('Novel A.pdf', pdf_bytes('Orchid carries a silver key.'))['id']
        second = library.enqueue('Novel B.pdf', pdf_bytes('Orchid carries a red compass.'))['id']
        for identifier in (first, second):
            wait_ready(library, identifier)
        category = library.save_category('Fiction')['id']
        library.assign_category([first], category)
        assert library.resolve_scope(None, None) is None
        assert library.resolve_scope(category, None) == [first]
        assert library.resolve_scope(category, [first, second]) == [first]
        assert library.resolve_scope('__uncategorized__', None) == [second]
        sources = library.retrieve('Orchid carries what?', library.resolve_scope(category, None), library.settings())
        assert {s['document_id'] for s in sources} == {first}
        class NoEmbedding:
            def embed(self, *args, **kwargs):
                pytest.fail('Empty selection must not embed or search all documents')
        library.client = NoEmbedding()
        for scope in ([], library.resolve_scope(category, [second])):
            assert library.retrieve('Orchid', scope, library.settings()) == []
        for category_id, identifiers in [('missing', None), (None, ['missing']), (None, [first, 'missing'])]:
            with pytest.raises(ValueError):
                library.resolve_scope(category_id, identifiers)
    finally:
        library.close()


def test_categories_persist_and_delete_keeps_documents_vectors(tmp_path):
    library = Library(tmp_path, DeterministicEmbeddings())
    identifier = library.enqueue('Book.epub', epub_bytes())['id']
    wait_ready(library, identifier)
    category = library.save_category('Novel')['id']
    library.assign_category([identifier], category)
    library.save_category('Series A', category)
    with pytest.raises(ValueError):
        library.save_category('series a')
    with pytest.raises(KeyError):
        library.assign_category([identifier, 'missing'], None)
    assert library.document(identifier)['category_id'] == category
    scope = {'category_id':category, 'document_ids':[identifier], 'reading_mode':'fiction'}
    conversation = library.new_conversation('A scoped question', scope)
    library.close()
    library = Library(tmp_path, DeterministicEmbeddings())
    try:
        assert library.categories() == [{'id':category, 'name':'Series A', 'count':1}]
        assert library.conversation_scope(conversation) == scope
        library.delete_category(category)
        assert library.document(identifier)['category_id'] is None
        assert library.source_path(identifier).exists()
        assert library.retrieve('Orchid', [identifier], library.settings())
        with pytest.raises(ValueError):
            library.resolve_scope(category, None)
    finally:
        library.close()


def test_api_preferences_null_scope_and_conversation_boundary(tmp_path):
    app = create_app(tmp_path, 'test', DeterministicEmbeddings())
    with TestClient(app, headers={'Authorization':'Bearer test'}) as client:
        identifier = app.state.library.enqueue('Available.pdf', pdf_bytes())['id']
        wait_ready(app.state.library, identifier)
        scope = {'category_id':None, 'document_ids':[], 'reading_mode':'fiction'}
        assert client.patch('/api/preferences', json={'language':'ja','scope':scope}).json()['scope'] == scope
        assert client.patch('/api/preferences', json={'scope':{'document_ids':None}}).json() == {
            'language':'ja','scope':{'document_ids':None,'category_id':None,'reading_mode':'standard'}}
        assert client.patch('/api/preferences', json={'language':'bad'}).status_code == 422
        response = client.post('/api/chat', json={'question':'What?', 'language':'en', **scope})
        events = [json.loads(line) for line in response.text.splitlines()]
        sources = next(e for e in events if e['type']=='sources')
        assert sources['sources'] == []
        assert 'No searchable documents' in next(e['text'] for e in events if e['type']=='delta')
        conversation = sources['conversation_id']
        assert client.get(f'/api/conversations/{conversation}/scope').json() == scope
        response = client.post('/api/chat', json={'question':'What?', 'conversation_id':conversation})
        assert '查詢範圍已改變' in response.text
        assert len(app.state.library.history(conversation)) == 2
    app = create_app(tmp_path, 'test', DeterministicEmbeddings())
    with TestClient(app, headers={'Authorization':'Bearer test'}) as client:
        assert client.get('/api/preferences').json()['language'] == 'ja'


def test_fiction_expands_only_matching_chapter_and_keeps_prompt_budget(tmp_path):
    library = Library(tmp_path, DeterministicEmbeddings())
    try:
        identifier = library.enqueue('Novel.epub', epub_bytes())['id']
        wait_ready(library, identifier)
        seed = 'Orchid said, "I will take the silver key."'
        full = 'Mira entered the room. ' + seed + ' She then left by the east door.'
        with library.connect() as db:
            db.execute('DELETE FROM chunks WHERE document_id=?', (identifier,))
            db.execute('UPDATE sections SET text=? WHERE document_id=? AND number=1', (full, identifier))
            db.execute('UPDATE sections SET text=? WHERE document_id=? AND number=2', ('UNRELATED CHAPTER', identifier))
            db.execute('INSERT INTO chunks(document_id,page,text,vector) VALUES (?,1,?,?)', (identifier,seed,np.array([1,0,0],dtype=np.float32).tobytes()))
        standard = library.retrieve('Orchid', [identifier], library.settings())
        fiction = library.retrieve('Orchid', [identifier], library.settings(), 'fiction')
        assert standard[0]['text'] == seed
        assert fiction[0]['text'] == full
        assert 'UNRELATED' not in fiction[0]['text']
        messages, selected = prepare_messages('What happened?', fiction, [], 2000, 'fiction')
        assert '不可把局部檢索片段當作全書' in messages[0]['content']
        assert full in messages[-1]['content']
        assert selected[0]['text'] == full
        assert sum(len(m['content'].encode()) for m in messages) + 2400 <= 8192
    finally:
        library.close()


def test_folder_replacement_inherits_category(tmp_path):
    books = tmp_path / 'books'
    books.mkdir()
    source = books / 'book.epub'
    source.write_bytes(epub_bytes())
    library = Library(tmp_path / 'library', DeterministicEmbeddings())
    sync = FolderSync(library)
    try:
        sync.add(str(books))
        scan_ready(sync)
        old = library.documents()[0]['id']
        category = library.save_category('Research')['id']
        library.assign_category([old], category)
        source.write_bytes(epub_bytes('9300'))
        scan_ready(sync)
        new = library.documents()[0]
        assert library.document(old) is None
        assert new['id'] != old and new['category_id'] == category
    finally:
        sync.close()
        library.close()
