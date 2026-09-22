"""Loopback-only API and renderer server, owned by the Electron process."""
from __future__ import annotations

import argparse
import asyncio
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import secrets
import time
from urllib.parse import urlparse
from typing import Literal

import httpx
from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from starlette.concurrency import run_in_threadpool

from backend.core import Library
from backend.prompt import prepare_messages
from backend.folders import FolderSync


class Settings(BaseModel):
    host: str = "http://127.0.0.1:1234"
    model: str = Field(default="qwen3.5-9b", min_length=1, max_length=200)
    embedding_model: str = Field(default="text-embedding-qwen3-embedding-0.6b", min_length=1, max_length=200)
    top_k: int = Field(default=5, ge=1, le=6)
    max_tokens: int = Field(default=1200, ge=100, le=2000)
    temperature: float = Field(default=0.2, ge=0, le=1)
    embedding_idle_unload: bool = True

    @field_validator("host")
    @classmethod
    def local_host(cls, value):
        parsed = urlparse(value)
        if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost", "::1") or parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            raise ValueError("請使用本機 LM Studio 位址，例如 http://127.0.0.1:1234")
        return value.rstrip("/")


class Scope(BaseModel):
    document_ids: list[str] | None = Field(default=None, max_length=2000)
    category_id: str | None = None
    reading_mode: Literal['standard', 'fiction'] = 'standard'


class Preferences(BaseModel):
    language: Literal['zh-Hant', 'en', 'ja'] | None = None
    scope: Scope | None = None


class CategoryName(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class Assignment(BaseModel):
    document_ids: list[str] = Field(min_length=1, max_length=2000)
    category_id: str | None = None


class Query(Scope):
    question: str = Field(min_length=1, max_length=1500)
    language: Literal['zh-Hant', 'en', 'ja'] = 'zh-Hant'
    conversation_id: str | None = None

    @field_validator("question")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("問題不能留空")
        if len(value.encode('utf-8')) > 4000:
            raise ValueError("問題過長，請縮短後重試。")
        return value.strip()


class FolderRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)


def create_app(data_dir: Path, token: str, client=None):
    library = Library(data_dir, client)
    folders = FolderSync(library)
    generation_lock = asyncio.Lock()

    @asynccontextmanager
    async def lifespan(app):
        folders.start()
        yield
        await run_in_threadpool(folders.close)
        await run_in_threadpool(library.close)

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)
    app.state.library = library
    app.state.folders = folders

    @app.middleware("http")
    async def authenticate(request: Request, call_next):
        supplied = request.cookies.get("rag_session", "")
        if request.headers.get("authorization", "").startswith("Bearer "):
            supplied = request.headers["authorization"][7:]
        if not secrets.compare_digest(supplied, token):
            return JSONResponse({"detail": "Unauthorized"}, status_code=401)
        origin = request.headers.get("origin")
        if origin and origin != str(request.base_url).rstrip("/"):
            return JSONResponse({"detail": "Origin rejected"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'self'; base-uri 'none'; frame-ancestors 'self'"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(ValueError)
    async def invalid(request, error):
        return JSONResponse({"detail": str(error)}, status_code=409)

    @app.exception_handler(KeyError)
    async def missing(request, error):
        return JSONResponse({"detail": "找不到此文件或對話。"}, status_code=404)

    @app.get("/api/health")
    def health():
        return {"ok": True, "data_dir": str(library.root)}

    @app.post('/api/release-embedding')
    def release_embedding():
        memory = getattr(library.client, 'memory', None)
        if memory:
            memory.release_idle(force=True)
        return {'ok': True}

    @app.get("/api/settings")
    def settings():
        return library.settings()

    @app.put("/api/settings")
    def save_settings(settings: Settings):
        library.save_settings(settings.model_dump())
        return library.settings()

    @app.get("/api/models")
    async def models():
        try:
            settings = library.settings()
            async with httpx.AsyncClient(timeout=4, trust_env=False) as http:
                native = await http.get(settings['host'] + '/api/v1/models')
                if native.status_code == 200 and isinstance(native.json().get('models'), list):
                    entries = native.json()['models']
                    catalog = [{'id': m['key'], 'name': m.get('display_name', m['key']),
                                'type': m['type'], 'loaded': bool(m.get('loaded_instances'))} for m in entries]
                    ids = list(dict.fromkeys([m['key'] for m in entries] +
                               [i['id'] for m in entries for i in m.get('loaded_instances', [])]))
                else:
                    response = await http.get(settings["host"] + "/v1/models")
                    response.raise_for_status()
                    ids = [r['id'] for r in response.json()['data']]
                    catalog = [{'id': identifier, 'name': identifier, 'type': 'unknown', 'loaded': None} for identifier in ids]
            return {"online": True, "models": ids, 'catalog': catalog, "configured_available": settings["model"] in ids}
        except Exception:
            return {"online": False, "models": [], 'catalog': [], "configured_available": False}

    @app.get("/api/documents")
    def documents():
        return library.documents()

    @app.get('/api/preferences')
    def preferences():
        return library.preferences()

    @app.patch('/api/preferences')
    def save_preferences(value: Preferences):
        values = value.model_dump(exclude_none=True)
        if value.scope is not None:
            values['scope'] = value.scope.model_dump()
        return library.save_preferences(values)

    @app.get('/api/categories')
    def categories():
        return library.categories()

    @app.post('/api/categories')
    def add_category(value: CategoryName):
        return library.save_category(value.name)

    @app.put('/api/categories/{identifier}')
    def rename_category(identifier: str, value: CategoryName):
        return library.save_category(value.name, identifier)

    @app.delete('/api/categories/{identifier}')
    def delete_category(identifier: str):
        library.delete_category(identifier)
        return {'ok': True}

    @app.put('/api/document-categories')
    def assign_category(value: Assignment):
        library.assign_category(value.document_ids, value.category_id)
        return {'ok': True}

    @app.post("/api/documents", status_code=202)
    async def upload(file: UploadFile):
        try:
            extension = Path(file.filename or '').suffix.lower()
            if extension not in ('.pdf', '.epub'):
                raise HTTPException(400, "只支援 PDF 或 EPUB 文件。")
            content = await file.read(50 * 1024 * 1024 + 1)
            if len(content) > 50 * 1024 * 1024:
                raise HTTPException(413, "每份文件上限為 50 MB。")
            if extension == '.pdf' and b"%PDF-" not in content[:1024]:
                raise HTTPException(400, "這不是有效的 PDF 文件。")
            return await run_in_threadpool(library.enqueue, file.filename, content)
        finally:
            await file.close()

    @app.delete("/api/documents/{doc_id}")
    def delete_document(doc_id: str):
        library.delete(doc_id)
        return {"ok": True}

    @app.post("/api/documents/{doc_id}/retry")
    def retry(doc_id: str):
        library.retry(doc_id)
        return {"ok": True}

    @app.get("/api/documents/{doc_id}/pdf")
    def pdf(doc_id: str):
        return FileResponse(library.pdf_path(doc_id), media_type="application/pdf", content_disposition_type="inline")

    @app.get('/api/documents/{doc_id}/sections/{number}')
    def section(doc_id: str, number: int):
        return library.section(doc_id, number)

    @app.get('/api/folders')
    def list_folders():
        return folders.folders()

    @app.post('/api/folders', status_code=202)
    def add_folder(value: FolderRequest):
        try:
            return folders.add(value.path)
        except OSError as error:
            raise HTTPException(400, '無法開啟此資料夾，請確認路徑及存取權限。') from error

    @app.delete('/api/folders/{identifier}')
    def remove_folder(identifier: str):
        folders.remove(identifier)
        return {'ok': True}

    @app.post('/api/folders/scan', status_code=202)
    def scan_folders():
        folders.request_scan()
        return {'ok': True}

    @app.get("/api/conversations")
    def conversations():
        return library.conversations()

    @app.get("/api/conversations/{conversation_id}")
    def history(conversation_id: str):
        return library.history(conversation_id)

    @app.get('/api/conversations/{conversation_id}/scope')
    def conversation_scope(conversation_id: str):
        return library.conversation_scope(conversation_id)

    @app.delete("/api/conversations/{conversation_id}")
    def delete_conversation(conversation_id: str):
        with library.connect() as db:
            db.execute("DELETE FROM conversations WHERE id=?", (conversation_id,))
        return {"ok": True}

    @app.post("/api/chat")
    async def chat(query: Query, request: Request):
        if generation_lock.locked():
            raise HTTPException(409, "上一個回答仍在產生中，請稍候。")
        await generation_lock.acquire()
        settings = library.settings()

        async def events():
            def event(kind, **data):
                return json.dumps({"type": kind, **data}, ensure_ascii=False) + "\n"

            started = time.perf_counter()
            try:
                conversation_id = query.conversation_id
                if conversation_id and not any(c["id"] == conversation_id for c in library.conversations()):
                    raise ValueError("對話已不存在，請建立新對話。")
                scope = {'document_ids': query.document_ids, 'category_id': query.category_id, 'reading_mode': query.reading_mode}
                if conversation_id and library.conversation_scope(conversation_id) != scope:
                    raise ValueError('查詢範圍已改變，請建立新對話。')
                identifiers = library.resolve_scope(query.category_id, query.document_ids)
                yield event("status", message="正在搜尋文件…")
                sources = await run_in_threadpool(library.retrieve, query.question, identifiers, settings, query.reading_mode)
                conversation_id = conversation_id or library.new_conversation(query.question, scope)
                history = library.history(conversation_id)
                if sources:
                    messages, sources = prepare_messages(query.question, sources, history, settings['max_tokens'], query.reading_mode)
                library.add_message(conversation_id, "user", query.question)
                yield event("sources", sources=sources, conversation_id=conversation_id)
                answer = ""
                if not sources:
                    answer = {'zh-Hant': '目前範圍沒有可查詢的文件。請選擇已完成處理的文件。', 'en': 'No searchable documents in this scope. Select documents that have finished processing.', 'ja': 'この範囲には検索できる文書がありません。処理済みの文書を選択してください。'}[query.language]
                    yield event("delta", text=answer)
                else:
                    yield event("status", message="正在閱讀原文並撰寫答案…")
                    async with httpx.AsyncClient(timeout=httpx.Timeout(180, connect=5), trust_env=False) as http:
                        async with http.stream("POST", settings["host"] + "/v1/chat/completions", json={
                            "model": settings["model"], "messages": messages, "stream": True,
                            "max_tokens": settings["max_tokens"], "temperature": settings["temperature"],
                            "chat_template_kwargs": {"enable_thinking": False},
                            "reasoning_effort": "none",
                        }) as response:
                            if response.status_code != 200:
                                await response.aread()
                                raise ValueError(f"LM Studio 回應 {response.status_code}。請確認已下載並載入模型 {settings['model']}。")
                            completed = False
                            truncated = False
                            async for line in response.aiter_lines():
                                if await request.is_disconnected():
                                    return
                                if not line.startswith("data: "):
                                    continue
                                data = line[6:]
                                if data == "[DONE]":
                                    completed = True
                                    break
                                packet = json.loads(data)
                                choices = packet.get("choices", [])
                                if not choices:
                                    continue
                                delta = choices[0].get("delta", {}).get("content") or ""
                                if delta:
                                    answer += delta
                                    yield event("delta", text=delta)
                                if choices[0].get("finish_reason"):
                                    completed = True
                                    truncated = choices[0]['finish_reason'] == 'length'
                            if truncated:
                                raise ValueError('回答達到 token 上限，未完整答案不會保存。請縮短問題或在設定提高回答上限。')
                            if not completed or not answer.strip():
                                raise ValueError("模型未完整返回答案，請重試。")
                # A concurrently removed source must not be resurrected in history.
                sources = [s for s in sources if library.document(s["document_id"])]
                library.add_message(conversation_id, "assistant", answer, sources)
                yield event("done", elapsed=round(time.perf_counter() - started, 2))
            except asyncio.CancelledError:
                raise
            except Exception as error:
                message = str(error)
                if isinstance(error, (httpx.ConnectError, httpx.TimeoutException)):
                    message = "LM Studio 無法連線或回應逾時。請確認 server 和模型已啟動，再重試。"
                yield event("error", message=message[:500])
            finally:
                generation_lock.release()

        return StreamingResponse(events(), media_type="application/x-ndjson")

    app.mount("/", StaticFiles(directory=Path(__file__).resolve().parents[1] / "desktop" / "renderer", html=True), name="ui")
    return app


if __name__ == "__main__":
    import socket
    import uvicorn
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, required=True)
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    token = os.environ.get("LOCAL_RAG_TOKEN")
    if not token:
        raise SystemExit("LOCAL_RAG_TOKEN must be set")
    app = create_app(args.data_dir, token)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", args.port))
    print(json.dumps({"port": sock.getsockname()[1]}), flush=True)
    uvicorn.Server(uvicorn.Config(app, log_level="warning")).run(sockets=[sock])
