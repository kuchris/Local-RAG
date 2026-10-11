import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest

from backend.core import DEFAULTS, ModelClient


class Runtime:
    """Stands in for LlamaRuntime: tracks whether the embedding server is running."""
    def __init__(self):
        self.running = None
        self.starts = 0
        self.fail_stop = False
        self.calls = []

    def ensure(self, role, model_id):
        assert role == 'embedding'
        if self.running != model_id:
            self.running = model_id
            self.starts += 1
        return 'http://embedding', {'Authorization': 'Bearer key'}

    def loaded(self, role):
        return self.running

    def stop(self, role):
        if self.fail_stop:
            raise RuntimeError('stop failed')
        self.running = None

    def close(self):
        self.running = None


@pytest.fixture
def client(monkeypatch):
    runtime = Runtime()

    def post(url, json, headers, **kwargs):
        runtime.calls.append((url, json, headers))
        data = {'data': [{'index': i, 'embedding': [3, 4]} for i, _ in enumerate(json['input'])]}
        return httpx.Response(200, request=httpx.Request('POST', url), json=data)

    monkeypatch.setattr(httpx, 'post', post)
    client = ModelClient(runtime)
    now = [0]
    client.memory.clock = lambda: now[0]
    return client, runtime, now, DEFAULTS | {'embedding_model': 'Qwen3-Embedding-0.6B-Q8_0'}


def test_idle_stop_and_restart_on_next_embedding(client):
    client, runtime, now, settings = client
    first = client.embed(['a'], settings)
    now[0] = 29
    client.memory.release_idle()
    assert runtime.running
    now[0] = 30
    client.memory.release_idle()
    assert runtime.running is None
    second = client.embed(['query'], settings, query=True)
    assert (first == second).all()
    assert runtime.starts == 2
    url, body, headers = runtime.calls[-1]
    assert url == 'http://embedding/v1/embeddings' and headers['Authorization'] == 'Bearer key'
    assert body['input'][0].startswith('Instruct: ') and runtime.calls[0][1]['input'] == ['a']


def test_import_session_retains_between_batches_and_resets_idle(client):
    client, runtime, now, settings = client
    with client.memory.session():
        client.embed(['batch 1'], settings)
        now[0] = 100
        client.memory.release_idle(force=True)
        assert runtime.running
        client.embed(['batch 2'], settings)
    now[0] = 129
    client.memory.release_idle()
    assert runtime.running
    now[0] = 130
    client.memory.release_idle()
    assert not runtime.running


def test_disabled_preference_failure_and_retry(client):
    client, runtime, now, settings = client
    client.embed(['text'], settings)
    client.memory.configure(settings | {'embedding_idle_unload': False})
    now[0] = 100
    client.memory.release_idle(force=True)
    assert runtime.running
    client.memory.configure(settings)
    runtime.fail_stop = True
    now[0] = 130
    client.memory.release_idle()
    assert client.memory.error
    assert runtime.running
    runtime.fail_stop = False
    now[0] = 160
    client.memory.release_idle()
    assert not runtime.running
    assert client.memory.error is None


def test_stop_cannot_interrupt_an_inflight_embedding(client, monkeypatch):
    client, runtime, now, settings = client
    entered, finish = threading.Event(), threading.Event()
    original = httpx.post

    def slow_post(url, **kwargs):
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
    assert not runtime.running


def test_embeddinggemma_prefixes(client):
    client, runtime, now, settings = client
    settings = settings | {'embedding_model': 'embeddinggemma-2-Q8_0'}
    client.embed(['passage'], settings)
    client.embed(['question'], settings, query=True)
    assert runtime.calls[0][1]['input'] == ['title: none | text: passage']
    assert runtime.calls[1][1]['input'] == ['task: search result | query: question']
