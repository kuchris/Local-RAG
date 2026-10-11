# Local RAG

**A personal reading app for your PDFs and EPUBs.**

Connect a folder, choose what to search, and ask questions with citations back to the original text. Local RAG is a Windows desktop app; answers, embeddings and reranking run on your own GPU through [llama.cpp](https://github.com/ggml-org/llama.cpp), with no cloud service.

The interface supports **繁體中文 · English · 日本語**, in light or dark mode. The answer model is prompted to respond in the language of your question.

![Local RAG showing an English answer, its citation and the source passage](docs/images/local-rag-app.png)

*Example screen with an answer grounded in a fictional EPUB.*

## Features

- **Chat with your library:** streamed answers with inline citations; open the cited PDF page or EPUB chapter.
- **Focused questions:** search everything, one category, or hand-picked documents from the scope menu in the question box.
- **Fiction mode:** adds nearby chapter context and asks the model to separate narration, dialogue and inference.
- **Folder sync:** connected folders (with subfolders) import new and changed PDFs and EPUBs automatically.
- **Library management:** categories, bulk moves, retries and deletion on a dedicated Library page.
- **Hybrid retrieval:** vector search and BM25 keyword search, reordered by a reranker.
- **Model choice:** any GGUF answer, embedding or reranker model from the `models/` folder; switching the embedding model rebuilds the index in place.

## Get started

### 1. Requirements

- Windows 10/11 x64 with an NVIDIA GPU (the bundled llama.cpp build uses CUDA 13). The default models use about 9–10 GB of VRAM.
- For running from source: Node.js **22.12 or newer** and [`uv`](https://docs.astral.sh/uv/).

### 2. Install

Clone or download this repository, then in PowerShell in the repository folder:

```powershell
.\setup.ps1
```

Setup creates a Python 3.11 environment, installs the Node.js dependencies and downloads a pinned llama.cpp CUDA build (SHA256-verified) into `bin/llama/`.

### 3. Add models

Put GGUF files in `models/`, one subfolder per model:

```text
models/
  Qwen3.5-9B/            Qwen3.5-9B-Q4_K_M.gguf, mmproj-F32.gguf
  EmbeddingGemma-2/      embeddinggemma-2-Q8_0.gguf
  bge-reranker-v2-m3/    bge-reranker-v2-m3-Q8_0.gguf
```

| Purpose | Default model ID (file name without `.gguf`) | Source |
| --- | --- | --- |
| Answers (+ scanned-page reading) | `Qwen3.5-9B-Q4_K_M` with its `mmproj` | any Qwen3.5-9B GGUF with a vision projector |
| Embeddings | `embeddinggemma-2-Q8_0` | [ggml-org/embeddinggemma-2-GGUF](https://huggingface.co/ggml-org/embeddinggemma-2-GGUF) |
| Reranking (optional) | `bge-reranker-v2-m3-Q8_0` | [gpustack/bge-reranker-v2-m3-GGUF](https://huggingface.co/gpustack/bge-reranker-v2-m3-GGUF) |

- A file name containing `rerank` marks a reranker and one containing `embedding` an embedding model; anything else is an answer model.
- An `mmproj*.gguf` in the same subfolder is the vision projector used to transcribe scanned PDF pages.
- File names must be unique across subfolders. Pick models under **Settings → Models**.

### 4. Launch

```powershell
npm.cmd start
```

or double-click `Start Local RAG.cmd`. (`npm.cmd` works even when PowerShell's execution policy blocks `npm.ps1`.) The first question loads the answer model, which takes about ten seconds.

## Using the app

### Ask

Type a question and press Enter (Shift + Enter for a new line); **Stop** cancels generation, and incomplete answers are not saved. Click a citation number to open the **Sources** panel; from there, open the PDF page or EPUB chapter. Ctrl + N starts a new chat.

The **scope** button at the bottom left of the question box chooses what to search: all documents, one category, or ticked documents within it. An empty selection never silently expands to everything. Changing scope or reading mode starts a new chat; reopening a chat restores its scope.

### Fiction mode

Switch the question box from **Standard** to **Fiction** when reading novels. Each retrieved passage is widened with nearby text from the same chapter, and the model is asked to distinguish narration, character statements and its own inference. It still answers from retrieved excerpts: whole-book summaries, chronology and links between distant chapters can miss important scenes.

### Library

Open **Library** in the sidebar.

- **Documents:** search and filter by category, tick documents to move them to a category, ask about them, or delete them. Drag PDF or EPUB files anywhere onto the window to import them (up to 50 MB each); exact duplicates are detected even when renamed.
- **Folders:** connect a folder to import its PDFs and EPUBs, including subfolders, and keep them in sync.
- **Categories:** create, rename or remove categories. Removing one returns its documents to **Uncategorized**.

Connected folders are checked about every 10 seconds while the app is open, and once at start-up for changes made while it was closed. Files are imported after their size and modification time stop changing.

| Folder change | Result |
| --- | --- |
| Add a PDF or EPUB | Imported, including files in subfolders. |
| Update a file | The new version is indexed first; if that fails, the old one stays searchable. |
| Move or delete the original | The library copy is kept. |
| Disconnect the folder | Its imported documents are kept. |
| Delete a document in the app | Its copy and index are removed; that unchanged file is not re-imported until it changes or you add it manually. |

Updated documents keep their category. Original files are never modified. Entire drives, overlapping folders, symlinks/junctions and the app's own data folder cannot be connected.

## Models and retrieval

### How a question is answered

1. **Hybrid search:** the question is embedded and compared with every passage, and also matched with SQLite FTS5 BM25 (words, and overlapping character pairs for Chinese and Japanese). The two rankings are merged with reciprocal rank fusion; keywords count only as far as the question's words occur in the library, so an English question about Chinese books relies on the vectors.
2. **Reranking:** the reranker scores the best 30 passages against the question and reorders them.
3. **Answering:** the top passages (5 by default) go to the answer model within an 8,192-token context, budgeted in estimated tokens so Chinese and Japanese passages are not cut short.

### Measured on a real library

`scripts/eval_retrieval.py` builds a fixed set of questions from your own documents (the answer model writes a paraphrased question per sampled passage and quotes the answer sentence) and reports how often the answer is retrieved. On a library of 32 Chinese novels (5,529 passages, 48 questions, a quarter of them in English):

| Change | Answer ranked 1st | In top 5 | Reaches the prompt |
| --- | --- | --- | --- |
| Character-overlap keywords + vectors | 0.30 | 0.68 | — |
| + BM25 keywords, coverage-weighted | 0.58 | 0.85 | — |
| + bge-reranker-v2-m3 | 0.75 | 0.94 | 0.88 |
| + token-based evidence budget (current) | 0.75 | 0.94 | 0.94 |

The first two rows were measured with the benchmark's earlier version (60 questions, hit = the exact source passage); later rows count a hit when a passage contains the quoted answer sentence. Same-language questions now reach the prompt every time. Tried and not adopted: Qwen3-Reranker-0.6B (lower and slower), sentence-packed passages of 350 or 650 tokens, and book/chapter titles in the embedded text. The benchmark covers looking up specific passages; it does not measure whole-book questions.

To run it, close the app and use:

```powershell
.venv\Scripts\python.exe scripts\eval_retrieval.py --note "what changed"
```

Questions and results are stored in the library folder under `eval/` (they quote your documents), and each run appends to `results.jsonl` for comparison.

### Changing models

Changing the answer model or reranker takes effect immediately. Choosing another embedding model offers **Rebuild index and switch**: the stored passage text is embedded again with the new model, without re-reading files or repeating scanned-page transcription. The old index stays in use until the rebuild succeeds, and questions wait until it finishes.

### Memory

The answer model stays loaded once used. The embedding model and reranker are released after 30 seconds idle (or kept loaded, under **Settings → Models**) and load again for the next import or search; saved vectors remain on disk.

Each model runs in its own `llama-server` process on a random loopback port with a per-launch API key. All of them stop when the app closes, and Windows ends them if the backend crashes. Server logs are `llama-chat.log`, `llama-embedding.log` and `llama-rerank.log` in the library folder.

## Data and privacy

The library lives in:

```text
%APPDATA%\local-rag-desktop\library
```

It holds the SQLite database (documents, passages, vectors, chats), copies of imported files and logs; **Settings → General** shows the path. Close the app before backing it up. Deleting a document removes its stored citations; answer text remains until its chat is deleted.

The backend listens on a random loopback port with a per-launch session secret, the renderer is sandboxed, and model servers listen only on loopback. The app has no cloud inference or telemetry. `.gitignore` excludes documents, databases, models, logs and build output; ignore rules do not remove files from earlier commits, so review before publishing.

## Current limits

- **Platform:** Windows x64 with an NVIDIA GPU; the portable build is unsigned. Other platforms are untested.
- **Extraction:** PDF text extraction and visual transcription can misread equations, tables, scans or unusual fonts. Citations help verify an answer but do not guarantee it.
- **EPUB:** text follows reading order with chapter references, not page numbers; layout and images are not reproduced. DRM-protected and image-only books are unsupported.
- **Whole-book questions:** retrieval returns passages, so summaries of a book, timelines and character arcs across volumes are incomplete.
- **Context:** the prompt targets an 8K context; loading a larger context does not raise the app's budget.

## Troubleshooting

- **`npm start` fails with "running scripts is disabled":** use `npm.cmd start` or `Start Local RAG.cmd`.
- **Electron exits immediately (code 0x80000003):** the repository folder probably has a Low integrity label, which some sandboxing tools add; Chromium's sandbox cannot start under it. Reset it with `icacls "<repository folder>" /setintegritylevel "(OI)(CI)medium"`.
- **A model will not load:** check the `llama-*.log` files in the library folder and **Settings → Models**.

## Development

```text
React UI (Electron window) → authenticated local FastAPI backend
                               ├─ PDF / EPUB extraction and folder sync
                               ├─ SQLite: documents, passages, vectors, FTS5 keywords, chats
                               └─ llama-server ×3: answers + PDF vision, embeddings, reranking
```

| Folder | Contents |
| --- | --- |
| `frontend/` | React + TypeScript + Tailwind UI, built by Vite into `frontend/dist` |
| `backend/` | FastAPI server, library and retrieval (`core.py`), prompt assembly, folder sync, `llama-server` runtime (`llama.py`) |
| `desktop/` | Electron main process and preload bridge |
| `scripts/` | Runtime bundling, packaging and the retrieval benchmark |
| `tests/` | Python tests and end-to-end tests (`tests/e2e/`) |

Imports and index rebuilds run on one background worker; one answer is generated at a time. `npm.cmd start` builds the UI, then opens Electron.

For UI work with hot reload, run a backend with a fixed port and token, then the Vite dev server, which proxies `/api` and adds the token:

```powershell
$env:LOCAL_RAG_TOKEN = 'dev'; .venv\Scripts\python.exe -m backend.server --data-dir artifacts\dev-library --port 8765
npm.cmd run dev:ui
```

Open `http://localhost:5173`. Connecting folders needs the Electron app; files can be dropped onto the page.

### Tests

```powershell
uv pip install --python .venv/Scripts/python.exe -r requirements-dev.txt
.venv\Scripts\python.exe -m pytest -q
npm.cmd test
```

Python tests cover persistence, imports, scope rules, folder sync, keyword indexing, reranking, index rebuilds, the llama.cpp runtime, model memory and prompt budgets. `npm test` type-checks the UI and checks the Electron scripts.

End-to-end tests need the default models in `models/` and a built UI (`npm.cmd run build:ui`):

```powershell
node tests/e2e/smoke.cjs --live
node tests/e2e/folders.cjs --live
node tests/e2e/categories.cjs --live
node tests/e2e/memory.cjs
```

They create fictional PDF/EPUB fixtures and isolated libraries under `artifacts/`; `--live` also checks generated answers. Add `--packaged` to test the portable build, or `--browser` to run against the backend in headless Chromium (`npx playwright install chromium`).

### Portable build

```powershell
.venv\Scripts\python.exe scripts\prepare_runtime.py
npm.cmd run pack
```

Output: `dist/Local-RAG-win32-x64/` (about 1.2 GB, mostly CUDA libraries). It includes Python, the backend and llama.cpp; put the `models/` folder next to `Local-RAG.exe`. Close the executable before packaging again. `LOCAL_RAG_PYTHON`, `LOCAL_RAG_DATA_DIR`, `LOCAL_RAG_MODELS_DIR` and `LOCAL_RAG_LLAMA_SERVER` override the runtime, library folder, models folder and `llama-server.exe` path.
