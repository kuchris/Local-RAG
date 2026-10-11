"""Owns llama-server processes: one for answers (with optional vision), one for embeddings.

Models live in one folder, one subfolder per model; an `mmproj*.gguf` next to a model is
its vision projector. A model's identifier is its file name without `.gguf`.
"""
from __future__ import annotations

import logging
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import httpx

log = logging.getLogger(__name__)

CONTEXT = 8192
STARTUP_TIMEOUT = 180
# Per-model quirks, matched by case-insensitive substring of the identifier.
PROFILES = [
    ('qwen3-embedding', {
        'args': ['--pooling', 'last'],
        'query': 'Instruct: Given a user question, retrieve relevant passages from documents that answer the question.\nQuery: ',
        'document': '',
    }),
    ('embeddinggemma', {'args': [], 'query': 'task: search result | query: ', 'document': 'title: none | text: '}),
    ('nomic', {'args': [], 'query': 'search_query: ', 'document': 'search_document: '}),
]


def profile(model_id: str) -> dict:
    lowered = model_id.lower()
    return next((p for key, p in PROFILES if key in lowered), {'args': [], 'query': '', 'document': ''})


@dataclass
class Model:
    id: str
    path: Path
    type: str
    mmproj: Path | None
    size: int


def scan(models_dir: Path) -> dict[str, Model]:
    models, duplicates = {}, set()
    if not models_dir.is_dir():
        return models
    for path in sorted(models_dir.rglob('*.gguf')):
        if path.name.lower().startswith('mmproj'):
            continue
        projectors = sorted(p for p in path.parent.glob('*.gguf') if p.name.lower().startswith('mmproj'))
        identifier = path.stem
        if identifier in models:
            duplicates.add(identifier)
        lowered = identifier.lower()
        kind = 'reranker' if 'rerank' in lowered else 'embedding' if 'embedding' in lowered else 'llm'
        models[identifier] = Model(identifier, path, kind, projectors[0] if projectors else None, path.stat().st_size)
    if duplicates:
        raise ValueError('models 資料夾有重複的模型檔名：' + ', '.join(sorted(duplicates)))
    return models


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class _Job:
    """Windows job object: children die with this process, even on TerminateProcess."""

    def __init__(self):
        self.handle = None
        if sys.platform != 'win32':
            return
        import ctypes
        from ctypes import wintypes
        kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel32.CreateJobObjectW.restype = wintypes.HANDLE
        kernel32.OpenProcess.restype = wintypes.HANDLE

        class Basic(ctypes.Structure):
            _fields_ = [('PerProcessUserTimeLimit', ctypes.c_int64), ('PerJobUserTimeLimit', ctypes.c_int64),
                        ('LimitFlags', wintypes.DWORD), ('MinimumWorkingSetSize', ctypes.c_size_t),
                        ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', wintypes.DWORD),
                        ('Affinity', ctypes.c_size_t), ('PriorityClass', wintypes.DWORD),
                        ('SchedulingClass', wintypes.DWORD)]

        class Counters(ctypes.Structure):
            _fields_ = [(name, ctypes.c_uint64) for name in
                        ('ReadOps', 'WriteOps', 'OtherOps', 'ReadBytes', 'WriteBytes', 'OtherBytes')]

        class Extended(ctypes.Structure):
            _fields_ = [('Basic', Basic), ('Io', Counters), ('ProcessMemoryLimit', ctypes.c_size_t),
                        ('JobMemoryLimit', ctypes.c_size_t), ('PeakProcessMemoryUsed', ctypes.c_size_t),
                        ('PeakJobMemoryUsed', ctypes.c_size_t)]

        handle = kernel32.CreateJobObjectW(None, None)
        info = Extended()
        info.Basic.LimitFlags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if handle and kernel32.SetInformationJobObject(handle, 9, ctypes.byref(info), ctypes.sizeof(info)):
            self.handle, self.kernel32 = handle, kernel32
        else:
            log.warning('Job object unavailable; llama-server may outlive a crashed backend')

    def add(self, process: subprocess.Popen):
        if self.handle:
            self.kernel32.AssignProcessToJobObject(self.handle, int(process._handle))


class _Instance:
    def __init__(self, model: Model, process: subprocess.Popen, port: int, key: str, log_path: Path):
        self.model, self.process, self.port, self.key, self.log_path = model, process, port, key, log_path

    @property
    def base_url(self):
        return f'http://127.0.0.1:{self.port}'

    @property
    def headers(self):
        return {'Authorization': f'Bearer {self.key}'}

    def alive(self):
        return self.process.poll() is None


class LlamaRuntime:
    def __init__(self, models_dir: Path, server: Path, log_dir: Path):
        self.models_dir, self.server, self.log_dir = Path(models_dir), Path(server), Path(log_dir)
        self.instances: dict[str, _Instance] = {}
        self.locks = {'chat': threading.Lock(), 'embedding': threading.Lock(), 'rerank': threading.Lock()}
        self.job = _Job()

    def available(self):
        return self.server.is_file()

    def catalog(self) -> dict[str, Model]:
        return scan(self.models_dir)

    def model(self, model_id: str) -> Model:
        model = self.catalog().get(model_id)
        if model is None:
            raise ValueError(f'在 models 資料夾找不到模型 {model_id}。請把 GGUF 放進 models\\<名稱>\\ 後再到設定選擇。')
        return model

    def arguments(self, role: str, model: Model, port: int, key: str) -> list[str]:
        args = [str(self.server), '-m', str(model.path), '--host', '127.0.0.1', '--port', str(port),
                '--api-key', key, '-ngl', '99', '--no-webui']
        if role == 'embedding':
            # Each input is one sequence; a slot must hold a whole ~900-character chunk plus prefix.
            args += ['--embedding', '-c', str(CONTEXT), '-np', '4', '-b', '2048', '-ub', '2048']
            args += profile(model.id)['args']
        elif role == 'rerank':
            # Each (question, passage) pair is one sequence; encoder rerankers need it in one ubatch.
            args += ['--reranking', '-c', str(4 * 4096), '-np', '4', '-b', '4096', '-ub', '4096']
        else:
            args += ['-c', str(CONTEXT), '-np', '1', '--jinja']
            args += ['--mmproj', str(model.mmproj)] if model.mmproj else ['--no-mmproj']
        return args

    def ensure(self, role: str, model_id: str) -> tuple[str, dict]:
        with self.locks[role]:
            current = self.instances.get(role)
            if current and current.model.id == model_id and current.alive():
                return current.base_url, current.headers
            self._stop(role)
            if not self.available():
                raise ValueError(f'找不到 llama-server：{self.server}。請先執行 setup.ps1。')
            model = self.model(model_id)
            if role == 'embedding' and model.type != 'embedding':
                raise ValueError('設定的 embedding 模型不是 embedding 模型。')
            if role == 'rerank' and model.type != 'reranker':
                raise ValueError('設定的 reranker 不是 reranker 模型。')
            port, key = free_port(), secrets.token_hex(16)
            self.log_dir.mkdir(parents=True, exist_ok=True)
            log_path = self.log_dir / f'llama-{role}.log'
            with open(log_path, 'wb') as output:
                process = subprocess.Popen(self.arguments(role, model, port, key), stdin=subprocess.DEVNULL,
                                           stdout=output, stderr=subprocess.STDOUT, cwd=self.server.parent,
                                           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            self.job.add(process)
            instance = _Instance(model, process, port, key, log_path)
            self.instances[role] = instance
            try:
                self._wait(instance)
            except Exception:
                self._stop(role)
                raise
            return instance.base_url, instance.headers

    def _wait(self, instance: _Instance):
        deadline = time.monotonic() + STARTUP_TIMEOUT
        while time.monotonic() < deadline:
            if not instance.alive():
                raise ValueError(f'llama-server 啟動失敗（{instance.model.id}）：' + self._tail(instance.log_path))
            try:
                if httpx.get(instance.base_url + '/health', timeout=2, trust_env=False).status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.25)
        raise ValueError(f'llama-server 載入 {instance.model.id} 逾時。')

    @staticmethod
    def _tail(path: Path, lines=6):
        try:
            text = path.read_text('utf-8', errors='replace').strip().splitlines()
        except OSError:
            return ''
        return ' | '.join(text[-lines:])[-400:]

    def loaded(self, role: str) -> str | None:
        instance = self.instances.get(role)
        return instance.model.id if instance and instance.alive() else None

    def stop(self, role: str):
        with self.locks[role]:
            self._stop(role)

    def _stop(self, role: str):
        # Report the role as unloaded only after the process (and its VRAM) is gone.
        instance = self.instances.get(role)
        if instance and instance.alive():
            instance.process.terminate()
            try:
                instance.process.wait(10)
            except subprocess.TimeoutExpired:
                instance.process.kill()
                instance.process.wait(5)
        self.instances.pop(role, None)

    def close(self):
        for role in self.locks:
            self.stop(role)


def default_paths() -> tuple[Path, Path]:
    root = Path(__file__).resolve().parents[1]
    models = Path(os.environ.get('LOCAL_RAG_MODELS_DIR') or root / 'models')
    server = Path(os.environ.get('LOCAL_RAG_LLAMA_SERVER') or root / 'bin' / 'llama' / 'llama-server.exe')
    return models, server
