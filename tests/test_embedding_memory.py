import json
import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

from backend.core import DEFAULTS, ModelClient
from backend.embedding_memory import EmbeddingMemory


class Server:
    def __init__(self):
        self.instances = ['custom-embedding']
        self.calls = []
        self.fail_unload = False

    def get(self, url, **kwargs):
        return httpx.Response(200, request=httpx.Request('GET', url), json={'models': [
            {'type': 'llm', 'key': 'qwen3.5-9b', 'loaded_instances': [{'id': 'qwen3.5-9b'}]},
            {'type': 'embedding', 'key': 'embedding-key', 'loaded_instances': [{'id': i} for i in self.instances]},
        ]})

    def post(self, url, json, **kwargs):
        self.calls.append((url, json))
        status, data = 200, {}
        if url.endswith('/load'):
            self.instances = ['embedding-key']
            data = {'type': 'embedding', 'instance_id': 'embedding-key'}
        elif url.endswith('/unload'):
            if self.fail_unload:
                status = 503
            else:
                self.instances.remove(json['instance_id'])
        elif url.endswith('/embeddings'):
            data = {'data': [{'index': i, 'embedding': [3, 4]} for i, _ in enumerate(json['input'])]}
        return httpx.Response(status, request=httpx.Request('POST', url), json=data)


@pytest.fixture
def client(monkeypatch):
    server = Server()
    monkeypatch.setattr(httpx, 'get', server.get)
    monkeypatch.setattr(httpx, 'post', server.post)
    client = ModelClient()
    now = [0]
    client.memory.clock = lambda: now[0]
    return client, server, now, DEFAULTS | {'embedding_model': 'custom-embedding'}


def test_idle_unload_preserves_llm_and_reloads_custom_alias(client):
    client, server, now, settings = client
    first = client.embed(['a'], settings)
    now[0] = 29
    client.memory.release_idle()
    assert server.instances == ['custom-embedding']
    now[0] = 30
    client.memory.release_idle()
    assert server.instances == []
    second = client.embed(['query'], settings, query=True)
    assert (first == second).all()
    assert server.instances == ['embedding-key']
    assert next(body for url, body in server.calls if url.endswith('/unload')) == {'instance_id': 'custom-embedding'}
    assert next(body for url, body in server.calls if url.endswith('/load'))['model'] == 'embedding-key'


def test_import_session_retains_between_batches_and_resets_idle(client):
    client, server, now, settings = client
    with client.memory.session():
        client.embed(['batch 1'], settings)
        now[0] = 100
        client.memory.release_idle(force=True)
        assert server.instances
        client.embed(['batch 2'], settings)
    now[0] = 129
    client.memory.release_idle()
    assert server.instances
    now[0] = 130
    client.memory.release_idle()
    assert not server.instances


def test_disabled_preference_failure_and_retry_leave_vectors_valid(client):
    client, server, now, settings = client
    client.embed(['text'], settings)
    client.memory.configure(settings | {'embedding_idle_unload': False})
    now[0] = 100
    client.memory.release_idle(force=True)
    assert server.instances
    client.memory.configure(settings)
    server.fail_unload = True
    now[0] = 130
    client.memory.release_idle()
    assert client.memory.error
    assert server.instances
    server.fail_unload = False
    now[0] = 160
    client.memory.release_idle()
    assert not server.instances
    assert client.memory.error is None


def test_unload_cannot_interrupt_an_inflight_embedding(client, monkeypatch):
    client, server, now, settings = client
    entered, finish = threading.Event(), threading.Event()
    original = server.post
    def slow_post(url, **kwargs):
        if url.endswith('/embeddings'):
            entered.set()
            assert finish.wait(3)
        return original(url, **kwargs)
    monkeypatch.setattr(httpx, 'post', slow_post)
    with ThreadPoolExecutor(max_workers=2) as pool:
        embedding = pool.submit(client.embed, ['slow request'], settings)
        assert entered.wait(3)
        cleanup = pool.submit(client.memory.release_idle, True)
        assert not cleanup.done()
        finish.set()
        assert embedding.result(timeout=3).shape == (1, 2)
        cleanup.result(timeout=3)
    assert not server.instances


def test_unsupported_management_api_keeps_embedding_working(client, monkeypatch):
    client, server, now, settings = client
    monkeypatch.setattr(httpx, 'get', lambda url, **kw: httpx.Response(404))
    assert client.embed(['text'], settings).shape == (1, 2)
    client.memory.release_idle(force=True)
    assert server.instances
    assert client.memory.error
