"""Serialize embedding requests and stop the embedding server when idle, retaining whole import jobs."""
from contextlib import contextmanager
import logging
import threading
import time

log = logging.getLogger(__name__)


class EmbeddingMemory:
    def __init__(self, runtime, idle_seconds=30, clock=time.monotonic):
        self.runtime = runtime
        self.idle_seconds = idle_seconds
        self.clock = clock
        self.lock = threading.RLock()
        self.enabled = True
        self.active = 0
        self.last_used = None
        self.error = None
        self.stop = threading.Event()
        self.thread = None

    def configure(self, settings):
        with self.lock:
            self.enabled = settings.get('embedding_idle_unload', True)
            # Give ongoing work and a newly enabled preference a full idle period.
            if self.last_used is not None:
                self.last_used = self.clock()

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
                self.touch()

    def prepare(self, settings):
        """Called under lock; returns the embedding server's base URL and auth headers."""
        endpoint = self.runtime.ensure('embedding', settings['embedding_model'])
        self.touch()
        return endpoint

    def touch(self):
        if self.runtime.loaded('embedding'):
            self.last_used = self.clock()

    def release_idle(self, force=False):
        with self.lock:
            if self.last_used is None or self.active or not self.enabled:
                return
            if not force and self.clock() - self.last_used < self.idle_seconds:
                return
            try:
                self.runtime.stop('embedding')
                self.last_used = None
                self.error = None
            except Exception as error:
                # A cleanup failure must never turn a successfully indexed file into an error.
                self.error = 'Embedding 自動釋放失敗，稍後會重試。'
                self.last_used = self.clock()
                log.warning('Embedding stop failed: %s', type(error).__name__)

    def close(self):
        self.stop.set()
        if self.thread:
            self.thread.join()
        self.release_idle(force=True)
