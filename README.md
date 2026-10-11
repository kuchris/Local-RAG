# Local RAG

**A personal reading app for your PDFs and EPUBs.**

Connect a folder, choose what to search, and ask questions with citations back to the original text. Local RAG runs as a Windows desktop app, with answers and embeddings handled by llama.cpp on your computer.

The interface supports **繁體中文 · English · 日本語**. The answer model is prompted to respond in the language of your question.

![Local RAG desktop app showing an English answer and its source excerpt](docs/images/local-rag-app.png)

*Example screen with an English answer grounded in a fictional EPUB.*

## Features

- **Folder imports:** watch subfolders for new and changed PDFs and EPUBs, or add individual files with the picker and drag and drop.
- **Focused questions:** search the whole library, a category, one document, or several selected documents.
- **Answers with sources:** stream responses and open cited PDF pages or extracted EPUB chapters.
- **Library organization:** create categories, move documents in bulk, and reopen conversations with their saved search scope.
- **Local model choice:** choose any GGUF answer or embedding model from the `models/` folder.
- **Embedding memory control:** release the embedding model after idle periods while keeping the saved index.

## Get started

### 1. Put models in `models/`

The app starts and stops [llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server` itself; there is no separate server to run. Place GGUF files in the repository's `models/` folder, one subfolder per model:

```text
models/
  Qwen3.5-9B/            Qwen3.5-9B-Q4_K_M.gguf, mmproj-F32.gguf
  Qwen3-Embedding-0.6B/  Qwen3-Embedding-0.6B-Q8_0.gguf
```

| Purpose | Default model ID (file name without `.gguf`) |
| --- | --- |
| Answers | `Qwen3.5-9B-Q4_K_M` |
| Embeddings | `Qwen3-Embedding-0.6B-Q8_0` |

- A file whose name contains `embedding` is treated as an embedding model; anything else is an answer model.
- An `mmproj*.gguf` in the same subfolder is the model's vision projector, used to transcribe scanned PDF pages.
- File names must be unique across subfolders. Choose models in **Settings**.

Answers use an 8,192-token context with all layers on the GPU. Once dependencies and models are downloaded, everything runs locally without a cloud API key.

### 2. Launch the app

**From source:** clone or download this repository, install Node.js **22.12 or newer** and `uv`, then open PowerShell in the repository folder:

```powershell
.\setup.ps1
npm start
```

Setup creates a Python 3.11 environment, installs the desktop dependencies and downloads a pinned llama.cpp CUDA build (SHA256-verified) into `bin/llama/`. Afterwards, you can also launch with `Start Local RAG.cmd`.

**From a portable build:** open `dist/Local-RAG-win32-x64/Local-RAG.exe`. Keep the entire build folder together. Python, the backend and llama.cpp are included; put model weights in a `models/` folder next to `Local-RAG.exe`. Build output is generated locally and is not included in the repository.

### 3. Import and ask

1. Click **Connect folder** or **Add individual files**. PDF and EPUB files can be up to 50 MB each.
2. Wait for processing to finish. Exact duplicates are detected even when renamed.
3. Choose a category, click a document, or tick several documents. Check the scope above the question box.
4. Ask a question, then click a citation to inspect its source. **Stop** cancels generation; incomplete answers are not saved.

Switch the interface language at the top of the window. Document text, custom names and saved answers keep their original language.

## Organize your reading

### Categories and selections

Click **＋** beside the category picker to create or rename a category. Tick documents, choose a destination, and click **Move to category**. Each document belongs to one category. Removing a category returns its documents to **Uncategorized** without deleting them or rebuilding indexes.

Category and document selections work together: only selected documents in that category are searched. **Select visible** selects the current list, **Clear selection** selects nothing, and **All documents** returns to the whole library. Empty or missing selections never silently expand to all documents.

Changing scope or reading mode starts a new conversation. Reopening a conversation restores its saved scope. Categories remain live groups whose membership can change as you organize or update files.

### Connected folders

Folders are checked about every 10 seconds while the app is open. Files are imported after their size and modification time stabilize. Reopening the app checks for changes made while it was closed.

| Action | Result |
| --- | --- |
| Add a PDF or EPUB | Queue it for import, including files in subfolders. |
| Update a file | Index a replacement first; a failed update keeps the old searchable version. |
| Move or delete the original | Keep the imported library copy. |
| Disconnect a folder | Keep its imported documents. |
| Delete a document in the app | Remove its copy and index; exclude that unchanged folder version until the source changes or you import it manually. |

Successful replacements inherit the old category unless already classified. Older automatically imported versions are removed only when no other tracked file refers to them; independently imported copies are retained. Original files are never modified.

Use **⋯ → Connected folders** to inspect errors or request a scan. Entire drives, overlapping folders, symlinks/junctions and the app's own data directory are excluded. Changes that preserve both file size and modification time are not detected automatically.

### Fiction mode

Select a book or series, then choose **Fiction / narrative** in the question box. It adds nearby text from the same chapter or PDF page and asks the model to distinguish narration, character statements and inference. Existing indexes work without rebuilding.

This still uses retrieved excerpts. Whole-book summaries, chronology and connections across distant chapters can miss important scenes. Fiction mode does not build chapter summaries or read the entire book for every question.

## Models and memory

**Settings → Answer model** lists the models in `models/` and their loaded state. Changing the answer model keeps existing indexes. Changing the embedding model requires an empty library and reimporting documents, because saved vectors depend on that model.

By default, the embedding model stays loaded during imports and is released after 30 seconds idle. The next import or search loads it again. Choose **Keep loaded** to avoid repeated loading delays. Saved vectors remain on disk; this feature leaves the answer model loaded.

Each model runs in its own `llama-server` process on a random loopback port with a per-launch API key. Releasing the embedding model stops its process; all model processes are stopped when the app closes, and Windows ends them automatically if the backend crashes. Server logs are written to `llama-chat.log` and `llama-embedding.log` in the library folder.

## Data and privacy

The default library location is:

```text
%APPDATA%/local-rag-desktop/library
```

It contains the SQLite database, imported file copies and backend logs. **Settings** shows the exact path. Close the app before backing up the entire folder. Deleting a document removes its stored citations; existing answer text remains until its conversation is deleted.

The backend uses a random loopback port with a per-launch session secret. The renderer is sandboxed, and model servers listen only on the loopback interface. The application implements no cloud inference or telemetry.

`.gitignore` excludes document files, local databases, indexes, logs, environment files, test artifacts and build output. Ignore rules do not remove files from older Git commits; review files before publishing.

## Current limits

- **Platform:** the portable build targets Windows x64 and is unsigned. Other platforms have not been validated.
- **Extraction:** PDF text extraction and visual transcription can misread equations, tables, scans or unusual fonts. Citations help verify an answer; they do not guarantee accuracy.
- **EPUB:** text follows the book's reading order with chapter references, not fixed page numbers. Original layouts and images are not reproduced. DRM/encrypted chapters and image-only books are unsupported.
- **Retrieval:** exact vector search with keyword rank fusion is intended for personal collections. There is no reranker, and large-library or broad multilingual quality has not been benchmarked.
- **Context:** a conservative budget targets an 8K context, so excerpts and recent history may be shortened. Loading a larger model context does not automatically increase the app's budget.

## Development

```text
React UI (Electron window) → authenticated local FastAPI backend
                               ├─ PDF / EPUB extraction and folder monitoring
                               ├─ SQLite: documents, vectors and conversations
                               └─ llama-server ×2: answers + PDF vision, embeddings
```

| Folder | Contents |
| --- | --- |
| `frontend/` | React + TypeScript + Tailwind UI, built by Vite into `frontend/dist` |
| `backend/` | FastAPI server, library, folder sync and the `llama-server` runtime (`backend/llama.py`) |
| `desktop/` | Electron main process and preload bridge |

Imports run through one background worker; one answer is generated at a time. `npm start` builds the UI, then opens Electron.

To work on the UI with hot reload, run a backend with a fixed port and token, then the Vite dev server, which proxies `/api` and adds the token:

```powershell
$env:LOCAL_RAG_TOKEN = 'dev'; .venv\Scripts\python.exe -m backend.server --data-dir artifacts\dev-library --port 8765
npm run dev:ui
```

Open `http://localhost:5173`. Folder connection needs the Electron app; file import works through drag and drop.

### Tests

After setup:

```powershell
uv pip install --python .venv/Scripts/python.exe -r requirements-dev.txt
.venv\Scripts\python.exe -m pytest -q
npm test
```

Python tests cover persistence, imports, category scope, folder updates, the llama.cpp runtime, embedding lifecycle and prompt limits. `npm test` type-checks the UI and checks the Electron scripts.

End-to-end tests need the configured models in `models/` and a built UI (`npm run build:ui`):

```powershell
node tests/e2e/smoke.cjs --live
node tests/e2e/folders.cjs --live
node tests/e2e/categories.cjs --live
node tests/e2e/memory.cjs
```

They generate fictional PDF/EPUB fixtures and use isolated libraries under `artifacts/`. `--live` also checks generated answers. Add `--packaged` to test the portable build, or `--browser` to run the same checks against the backend in headless Chromium (`npx playwright install chromium`) where Electron cannot start. These are functional checks, not an answer-quality benchmark.

### Portable build

```powershell
.venv\Scripts\python.exe scripts\prepare_runtime.py
npm run pack
```

Output: `dist/Local-RAG-win32-x64/`. Packaging replaces the previous output, so close that executable first. `LOCAL_RAG_PYTHON` overrides the runtime, `LOCAL_RAG_DATA_DIR` the library location, `LOCAL_RAG_MODELS_DIR` the models folder and `LOCAL_RAG_LLAMA_SERVER` the `llama-server.exe` path.

### Legacy CLI

`rag_system.py` contains the earlier MinerU, Sentence Transformers and Annoy/FAISS pipeline. It uses `requirements.txt`, `config.yaml` and a separate `data/` directory, and requires its own dependency environment. It is not the desktop backend. `rag_system_useless.py` is a historical reference.

The CLI supports `--action build`, `query`, `add` and `clear`; run `python rag_system.py --help` in that environment for options. Older FAISS stores using `documents.pkl` must be rebuilt for the current `faiss_documents.pkl` metadata path.
