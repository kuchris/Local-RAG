"""Serialize embedding requests with idle unload, while retaining whole import jobs."""
from contextlib import contextmanager
import logging
import threading
import time

import httpx

log = logging.getLogger(__name__)


class EmbeddingMemory:
    def __init__(self, idle_seconds=30, clock=time.monotonic):
        self.idle_seconds = idle_seconds
        self.clock = clock
        self.lock = threading.RLock()
        self.enabled = True
        self.active = 0
        self.used = {}
        self.aliases = {}
        self.error = None
        self.stop = threading.Event()
        self.thread = None

    def configure(self, settings):
        with self.lock:
            self.enabled = settings.get('embedding_idle_unload', True)
            # Give ongoing work and a newly enabled preference a full idle period.
            for item in self.used.values():
                item['last_used'] = self.clock()

    def start(self):
        self.thread = threading.Thread(target=self.run, daemon=True, name='embedding-memory')
        self.thread.start()

    def run(self):
        while not self.stop.wait(1):
            self.release_idle()

    @contextmanager
    def session(self):
        with self.lock:
            self.active += 1
        try:
            yield
        finally:
            with self.lock:
                self.active -= 1
                for item in self.used.values():
                    item['last_used'] = self.clock()

    def prepare(self, settings):
        """Called under lock; use the exact embedding instance, never an LLM or all models."""
        host, requested = settings['host'], settings['embedding_model']
        key = self.aliases.get((host, requested), requested)
        response = httpx.get(host + '/api/v1/models', timeout=5, trust_env=False)
        if response.status_code in (404, 405):
            self.error = '目前 server 不支援自動釋放；embedding 仍可正常使用。'
            return requested
        response.raise_for_status()
        models = response.json()['models']
        for model in models:
            instances = model.get('loaded_instances', [])
            exact = next((i for i in instances if i['id'] == requested), None)
            if model['type'] != 'embedding' or not (model['key'] == key or exact):
                continue
            self.aliases[(host, requested)] = model['key']
            instance = exact or next(iter(instances), None)
            if instance is None:
                loaded = httpx.post(host + '/api/v1/models/load',
                                    json={'model': model['key'], 'context_length': 8192},
                                    timeout=180, trust_env=False)
                loaded.raise_for_status()
                data = loaded.json()
                if data['type'] != 'embedding':
                    raise ValueError('設定的模型不是 embedding 模型。')
                identifier = data['instance_id']
            else:
                identifier = instance['id']
            self.used[(host, identifier)] = {'last_used': self.clock(), 'key': model['key']}
            self.error = None
            return identifier
        # Preserve the normal server error for an unknown identifier / non-LM Studio server.
        return requested

    def release_idle(self, force=False):
        with self.lock:
            if not self.enabled or self.active:
                return
            for (host, identifier), item in list(self.used.items()):
                if not force and self.clock() - item['last_used'] < self.idle_seconds:
                    continue
                try:
                    catalog = httpx.get(host + '/api/v1/models', timeout=5, trust_env=False)
                    catalog.raise_for_status()
                    # Recheck identity in case the user unloaded or reused an alias externally.
                    present = any(m['type'] == 'embedding' and m['key'] == item['key'] and
                                  any(i['id'] == identifier for i in m.get('loaded_instances', []))
                                  for m in catalog.json()['models'])
                    if present:
                        response = httpx.post(host + '/api/v1/models/unload',
                                              json={'instance_id': identifier}, timeout=10, trust_env=False)
                        response.raise_for_status()
                    del self.used[(host, identifier)]
                    self.error = None
                except Exception as error:
                    # A cleanup failure must never turn a successfully indexed file into an error.
                    self.error = 'Embedding 自動釋放失敗，稍後會重試。'
                    item['last_used'] = self.clock()
                    log.warning('Embedding unload failed: %s', type(error).__name__)

    def close(self):
        self.stop.set()
        if self.thread:
            self.thread.join()
        self.release_idle(force=True)
