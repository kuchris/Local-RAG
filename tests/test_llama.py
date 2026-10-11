import json
import sqlite3

import pytest

from backend.core import Library
from backend.llama import LlamaRuntime, profile, scan


def gguf(path, size=4):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b'x' * size)
    return path


def test_scan_pairs_projectors_and_classifies(tmp_path):
    gguf(tmp_path / 'Qwen3.5-9B' / 'Qwen3.5-9B-Q4_K_M.gguf', 10)
    projector = gguf(tmp_path / 'Qwen3.5-9B' / 'mmproj-F16.gguf')
    gguf(tmp_path / 'Qwen3-Embedding-0.6B' / 'Qwen3-Embedding-0.6B-Q8_0.gguf')
    gguf(tmp_path / 'Text-only' / 'plain.gguf')
    models = scan(tmp_path)
    assert set(models) == {'Qwen3.5-9B-Q4_K_M', 'Qwen3-Embedding-0.6B-Q8_0', 'plain'}
    assert models['Qwen3.5-9B-Q4_K_M'].mmproj == projector and models['Qwen3.5-9B-Q4_K_M'].size == 10
    assert models['Qwen3-Embedding-0.6B-Q8_0'].type == 'embedding'
    assert models['plain'].type == 'llm' and models['plain'].mmproj is None
    assert scan(tmp_path / 'missing') == {}


def test_duplicate_identifiers_are_rejected(tmp_path):
    gguf(tmp_path / 'a' / 'same.gguf')
    gguf(tmp_path / 'b' / 'same.gguf')
    with pytest.raises(ValueError, match='same'):
        scan(tmp_path)


def test_server_arguments_follow_role_and_profile(tmp_path):
    gguf(tmp_path / 'm' / 'Qwen3.5-9B-Q4_K_M.gguf')
    gguf(tmp_path / 'm' / 'mmproj-F32.gguf')
    gguf(tmp_path / 'e' / 'Qwen3-Embedding-0.6B-Q8_0.gguf')
    runtime = LlamaRuntime(tmp_path, tmp_path / 'llama-server.exe', tmp_path)
    chat = runtime.arguments('chat', runtime.model('Qwen3.5-9B-Q4_K_M'), 5000, 'secret')
    assert chat[chat.index('--mmproj') + 1].endswith('mmproj-F32.gguf')
    assert chat[chat.index('--host') + 1] == '127.0.0.1' and chat[chat.index('--api-key') + 1] == 'secret'
    assert '--embedding' not in chat
    embedding = runtime.arguments('embedding', runtime.model('Qwen3-Embedding-0.6B-Q8_0'), 5001, 'k')
    assert '--embedding' in embedding and embedding[embedding.index('--pooling') + 1] == 'last'
    with pytest.raises(ValueError, match='setup.ps1'):
        runtime.ensure('chat', 'Qwen3.5-9B-Q4_K_M')
    with pytest.raises(ValueError, match='找不到模型'):
        runtime.model('missing')


def test_profiles():
    assert profile('embeddinggemma-2-Q8_0')['document'] == 'title: none | text: '
    assert profile('Qwen3-Embedding-4B-Q8_0')['query'].startswith('Instruct:')
    assert profile('bge-m3') == {'args': [], 'query': '', 'document': ''}


def test_lm_studio_settings_migrate_to_file_identifiers(tmp_path):
    class Client:
        pass

    Library(tmp_path, Client()).close()
    db = sqlite3.connect(tmp_path / 'library.sqlite3')
    db.execute("UPDATE settings SET data=?", (json.dumps({
        'host': 'http://127.0.0.1:1234', 'model': 'qwen3.5-9b',
        'embedding_model': 'text-embedding-qwen3-embedding-0.6b', 'top_k': 3}),))
    db.execute("INSERT INTO documents(id,name,hash,status,created,embedding_model) VALUES ('d','n','h','ready',0,'text-embedding-qwen3-embedding-0.6b')")
    db.commit()
    db.close()
    library = Library(tmp_path, Client())
    settings = library.settings()
    with library.connect() as connection:
        assert 'host' not in json.loads(connection.execute('SELECT data FROM settings').fetchone()[0])
    assert settings['model'] == 'Qwen3.5-9B-Q4_K_M' and settings['top_k'] == 3
    assert settings['embedding_model'] == 'Qwen3-Embedding-0.6B-Q8_0'
    assert library.document('d')['embedding_model'] == 'Qwen3-Embedding-0.6B-Q8_0'
    library.close()


def test_rerankers_are_their_own_type_and_role(tmp_path):
    gguf(tmp_path / 'r' / 'bge-reranker-v2-m3-Q8_0.gguf')
    gguf(tmp_path / 'e' / 'embeddinggemma-2-Q8_0.gguf')
    runtime = LlamaRuntime(tmp_path, tmp_path / 'llama-server.exe', tmp_path)
    reranker = runtime.model('bge-reranker-v2-m3-Q8_0')
    assert reranker.type == 'reranker'
    assert '--reranking' in runtime.arguments('rerank', reranker, 5002, 'k')
    assert runtime.model('embeddinggemma-2-Q8_0').type == 'embedding'
