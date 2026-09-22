# Local RAG · 私人閱讀室

A personal Windows Electron app for asking questions about local PDFs and EPUB books. Connect a folder for automatic imports, stream answers from Qwen3.5-9B through LM Studio, and follow citations to a PDF page or EPUB chapter text.

## Start

Open **`dist/Local-RAG-win32-x64/Local-RAG.exe`** if you have the packaged build. Keep the whole folder together: Python and the backend are included; LM Studio and model weights are separate.

To run from source, install Node.js and [uv](https://docs.astral.sh/uv/), then:

```powershell
.\setup.ps1
npm start
```

After setup, you can also double-click **`Start Local RAG.cmd`**.

## Models

Start the LM Studio Local Server at `http://127.0.0.1:1234`.

| Role | Default |
| --- | --- |
| Answers | Qwen3.5-9B Q4_K_M, API identifier `qwen3.5-9b` |
| Embeddings | Qwen3-Embedding-0.6B Q8_0 (`text-embedding-qwen3-embedding-0.6b`) |
| Context | Load the answer model with at least 8,192 tokens |

Settings → **回答模型** lists all locally downloaded answer models, with their loaded state. **Model identifier（可自行輸入）** remains editable for custom identifiers. Changing the answer model does not rebuild the document index. The answer model also handles PDF vision fallback, so scanned pages require a vision-capable model.

Download [Qwen3.5-9B Q4_K_M](https://huggingface.co/unsloth/Qwen3.5-9B-GGUF) in LM Studio, or use its CLI:

```powershell
lms get "https://huggingface.co/unsloth/Qwen3.5-9B-GGUF/blob/main/Qwen3.5-9B-Q4_K_M.gguf" --yes
lms load qwen3.5-9b --identifier qwen3.5-9b --context-length 8192 --gpu max --yes
lms get "https://huggingface.co/Qwen/Qwen3-Embedding-0.6B-GGUF/blob/main/Qwen3-Embedding-0.6B-Q8_0.gguf" --yes
lms load text-embedding-qwen3-embedding-0.6b --gpu max --yes
lms server start
```

The embedding model must also be downloaded in LM Studio. Keep the Qwen vision projection (`mmproj`) file alongside its GGUF for the automatic OCR fallback. Qwen3-Embedding-0.6B is the multilingual retrieval model. The query uses its instruction prefix. Chinese and English questions about an authored test document have been checked; a broad multilingual benchmark has not been run. Changing the embedding model requires an empty library and re-importing the PDFs.

The app sends both `reasoning_effort: "none"` and `chat_template_kwargs.enable_thinking: false`. The installed LM Studio honored `reasoning_effort`; the template field alone did not disable thinking in live testing. The app does not start LM Studio. The status badge checks the available model catalog, not GPU residency.

### Embedding memory

By default, the app unloads the embedding instance it used after 30 seconds of inactivity. It retains the model through an entire import job, including the gaps between embedding batches; embedding calls and unloading are serialized so cleanup cannot interrupt this app's search. Closing the desktop app also requests release when no import is active. The next import or query loads the embedding model automatically, even with JIT disabled. Saved vectors remain on disk and are not recomputed for existing documents.

Settings → **Embedding 記憶體** lets you keep the model loaded for faster repeated searches. This uses LM Studio's [model management API](https://lmstudio.ai/docs/developer/rest/unload) (LM Studio 0.4+). Only the exact embedding instance used by this app is unloaded; the answer/OCR model is left loaded. Other applications sharing that same embedding instance may need to reload it. Unsupported management endpoints leave normal embedding requests available; cleanup failures are logged and retried. Closing during an active import can leave its model loaded.

## Use

1. Click **連接資料夾** and choose your books/papers folder. PDFs and EPUBs in its subfolders are included automatically. You can also add individual files with the picker or drag and drop.
2. Choose a category in the sidebar, click a document, or tick multiple documents. **勾選列表** selects the visible list; **取消勾選** clears the selection. An empty selection never searches the whole library.
3. Ask a question. Answers stream into the conversation; Stop cancels an unfinished answer.
4. Click a citation to view the PDF page or extracted EPUB chapter. The reference panel shows evidence actually sent to the model.
5. Reopen saved conversations from the sidebar. Documents, settings and completed answers survive restarting.

Exact duplicate files are detected with SHA-256, including renamed files. Deletion removes the copied document, chunks, vectors and stored citation snapshots. Existing answer text remains until its conversation is deleted. Original input files are never modified.

### Categories, reading scope and language

Use **＋** beside the category picker to create or rename categories such as a book series, fiction, research or work. Tick documents, select a destination, then click **移至分類**. Each document has one category; removing a category returns its documents to Uncategorized without deleting files or rebuilding vectors. Automatically updated folder files inherit the prior version's category unless the replacement already has one.

The header and question box show the current scope. Category and document selections intersect: only selected documents in that category are searched. **所有文件** explicitly returns to the whole library. Changing scope or reading mode starts a fresh conversation; reopening a conversation restores its saved scope. Missing documents/categories require a new selection and never silently expand the search. Categories are live groups: their membership can change as you organize files or folder updates arrive.

For novels, select the relevant book or series and choose **小說／敘事** in the question box. This adds up to 220 characters on either side of each retrieved excerpt within the same stored chapter (or PDF page). The answer instructions distinguish narration, character statements and inference, and ask the model to avoid treating excerpts as the whole book. Existing indexes do not need rebuilding. This is still excerpt retrieval, not a full-book reading or chapter-summary system: cross-chapter plot analysis, chronology and hidden connections can be missed. No novel-quality benchmark has been run.

The top language picker switches the interface between **繁體中文 / English / 日本語** and persists across restarts. Document names, custom categories, source text and saved answers keep their original language. Answers follow the language of the question.

### Automatic folders

- While the app is open, folders are checked about every 10 seconds. New or changed files are read after their size and modification time match on two checks; imports run one at a time. Closing the app stops monitoring. Reopening catches up on changes.
- A changed source is indexed as a replacement first. Once it succeeds, the old automatically imported version is removed if no other tracked file refers to it. A failed update keeps the old searchable version; retry the failure in the library or folder manager. Independently imported copies are retained.
- Moving/deleting a source file or disconnecting a drive keeps the last library copy. **⋯ → 已連接的資料夾** shows missing files, progress and errors, offers an immediate check, and lets you stop watching without deleting documents.
- Deleting a document from the app suppresses that unchanged source version. Changing the source again imports it. To reimport immediately, use **加入個別文件**.
- Folder connections persist across restarts. Symlinks/junctions, entire drives, overlapping watched folders and the app's own library directory are excluded. Metadata-preserving edits (identical size and modification timestamp) are not detected automatically.

### EPUB reading

EPUB 2/3 text content is read in the package's [spine reading order](https://www.w3.org/TR/epub-33/). References use chapter/section titles, not fabricated page numbers. The built-in chapter viewer displays extracted text; original layouts, images and interactive content are not reproduced. Encrypted/DRM chapters and image-only books are unsupported. Archive limits are 200 MB expanded, 10,000 entries and 16 MB per chapter/resource read. Scripts and styles in books are not executed.

## Local storage

Data normally lives in `%APPDATA%/local-rag-desktop/library`; Settings shows the exact path. It contains `library.sqlite3`, document copies in `pdfs/` (including EPUBs for compatibility), and `backend.log`. Close the app before backing up the entire folder. Existing PDF libraries are migrated automatically.

The backend uses a random loopback port and per-launch session secret. Electron uses an isolated, sandboxed renderer with Node integration disabled and restricted navigation. Only local LM Studio addresses are accepted. No cloud inference or telemetry is implemented. Model downloads require internet; document processing and inference are local once models are installed.

The desktop app does not overwrite the legacy indexes under `data/vectordb`. Imported documents, local databases, logs, build output and test artifacts are ignored by Git and are not part of the source distribution.

## Architecture

```text
Electron interface
    │ authenticated loopback HTTP
    ▼
Python / FastAPI
    ├── pypdf + Qwen vision fallback → page-aware chunks
    ├── EPUB spine text → chapter-aware chunks
    ├── folder monitor → stable snapshots and incremental imports
    ├── LM Studio embeddings → normalized vectors
    ├── SQLite → document/chunk/vector persistence
    ├── exact cosine search + keyword rank fusion
    └── bounded evidence + recent conversation → LM Studio streaming API
```

SQLite keeps vectors together with their text and page metadata. Exact NumPy search is intended for small personal collections. Imports use a background worker; one answer is generated at a time. Closing the app stops its backend. Interrupted imports are marked for retry on next launch.

## Current limits

- Text PDFs use pypdf. Pages with missing text or detected corrupt font glyphs are rendered with PDFium and transcribed by Qwen3.5-9B vision. This requires the mmproj file and takes longer than text extraction. Blank pages with no content are skipped. MinerU remains in the separate legacy CLI and is not bundled.
- Both PDF extraction and model-based OCR can make mistakes, especially with complex equations, tables and layout. The corrupt-glyph detector does not catch every encoding issue. Page citations help verify the original; they do not guarantee factual correctness.
- Retrieval returns candidates, not a calibrated confidence score. Insufficient-evidence refusal is prompted and needs a larger evaluation set.
- A conservative UTF-8 byte budget keeps evidence/history within an 8K context. Some excerpts may be shortened.
- Maximum file size is 50 MB. No reranker or automatic model downloader UI yet. Large-library and multilingual retrieval performance have not been benchmarked.
- Windows output is a portable folder, not a signed installer. LM Studio remains an external dependency.

## Development

```powershell
uv pip install --python .venv/Scripts/python.exe -r requirements-dev.txt
.venv\Scripts\python.exe -m pytest -q
npm test
npm run test:e2e
node tests/electron-smoke.cjs --live
node tests/electron-smoke.cjs --live --packaged
node tests/electron-folders.cjs --live --packaged
node tests/electron-categories.cjs --live --packaged
```

Python tests cover duplicates, document scope, restart/delete persistence, incompatible settings, retry, API access and prompt budgets. Electron tests generate a fictional PDF and use real LM Studio embeddings; no personal documents are required. `--live` also checks a real Qwen answer against the fixture's invented timer delays and uncertainties, opens a page citation, and reloads the conversation. Isolated test data and screenshots are saved under `artifacts/`.

EPUB/folder tests cover reading order, chapter citations, encrypted/entity payload rejection, recursive imports, duplicates, failed replacement recovery, missing sources and background monitoring. The Electron folder test uses an authored EPUB fixture with real LM Studio embeddings; `--live` checks Qwen answers before and after a source edit, opens chapter citations, and verifies catch-up after restart. The native chooser is stubbed in this test; its actual IPC handler and API are exercised.

Category tests cover scope intersection, explicit empty selection, deleted selections, persistence, safe category removal, replacement inheritance, nearby chapter context and prompt budgets. The category Electron test exercises classification, bulk selection, all three interface languages, compact windows and restart; `--live` checks that Qwen's answer and chapter citations use only the selected book.

Build a portable Windows folder:

```powershell
.venv\Scripts\python.exe scripts\prepare_runtime.py
npm run pack
```

The runtime script copies the project's standalone CPython and installs production dependencies into that copy. It verifies the copied interpreter's location before installing anything. `LOCAL_RAG_PYTHON` overrides the runtime; `LOCAL_RAG_DATA_DIR` overrides the library location.

## Legacy CLI

`rag_system.py` is the original MinerU + Sentence Transformers + Annoy/FAISS pipeline. It has a separate dependency set in `requirements.txt`, reads `config.yaml` (or `--config`), and is not the Electron backend. `rag_system_useless.py` is an unused historical reference.

```powershell
python rag_system.py --action build
python rag_system.py --action query --question "What are the main findings?"
python rag_system.py --action add --pdf-file "document.pdf"
python rag_system.py --action clear
```

Legacy fixes include using YAML in the CLI, avoiding duplicate tail chunks, a FAISS finalization hook, reconstructing Annoy before appending to a built index, persistent clear, explicit model/timeout, and duplicate detection for newly indexed files. FAISS metadata now uses `faiss_documents.pkl`; rebuild older FAISS indexes that used the shared `documents.pkl`. The legacy stack is not bundled and has not received the same live coverage as the desktop app.
