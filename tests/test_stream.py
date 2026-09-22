import json
from fastapi.testclient import TestClient
from backend.server import create_app
from test_library import DeterministicEmbeddings, pdf_bytes, wait_ready


def test_truncated_generation_is_not_persisted(tmp_path, monkeypatch):
    class Response:
        status_code = 200
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def aiter_lines(self):
            yield 'data: ' + json.dumps({'choices': [{'delta': {'content': 'Incomplete answer'}, 'finish_reason': None}]})
            yield 'data: ' + json.dumps({'choices': [{'delta': {}, 'finish_reason': 'length'}]})
            yield 'data: [DONE]'

    class Client:
        def __init__(self, *args, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        def stream(self, *args, **kwargs): return Response()

    app = create_app(tmp_path, 'test', DeterministicEmbeddings())
    with TestClient(app, headers={'Authorization': 'Bearer test'}) as client:
        doc = app.state.library.enqueue('notes.pdf', pdf_bytes())
        wait_ready(app.state.library, doc['id'])
        monkeypatch.setattr('backend.server.httpx.AsyncClient', Client)
        response = client.post('/api/chat', json={'question': 'What is Orchid?'})
        assert 'Incomplete answer' in response.text
        assert '"type": "error"' in response.text
        assert '"type": "done"' not in response.text
        with app.state.library.connect() as db:
            assert db.execute("SELECT count(*) FROM messages WHERE role='assistant'").fetchone()[0] == 0
