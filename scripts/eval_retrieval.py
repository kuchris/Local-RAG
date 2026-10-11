"""Retrieval benchmark on your own library, to compare optimizations against a fixed baseline.

The first run samples passages and asks the answer model to write one paraphrased question per
passage (a quarter in English, to cover cross-lingual search). Questions are saved and reused, so
later runs measure only retrieval changes. Each run appends its metrics to results.jsonl.

Questions quote your documents, so everything is stored in the library folder, not the repository.
Close the app first: this opens the library and starts its own model servers.

    .venv\\Scripts\\python.exe scripts\\eval_retrieval.py [--data-dir DIR] [--questions 60] [--note "..."]
"""
from __future__ import annotations

import argparse
import json
import os
import random
import subprocess
import sys
import time
from pathlib import Path

import httpx
import numpy as np

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from backend.core import Library, ModelClient, tokens  # noqa: E402
from backend.llama import LlamaRuntime, default_paths  # noqa: E402

PROMPT = """Below is a passage from a book or document. Write ONE question that a reader could ask and that this passage answers specifically.
Rules:
- Paraphrase: do not copy distinctive phrases from the passage; use different wording.
- The question must make sense on its own, naming the people, objects or concepts involved.
- Ask about something specific to this passage, not general knowledge.
- Write the question in {language}.
- If the passage is a table of contents, copyright page, list of names or has nothing specific to ask, reply with SKIP.
Reply with only the question or SKIP.

<passage>
{text}
</passage>"""


def generate(library: Library, runtime: LlamaRuntime, settings: dict, count: int, seed: int) -> list[dict]:
    with library.connect() as db:
        rows = db.execute("""SELECT c.id, c.document_id, c.page, c.text, d.name FROM chunks c
                             JOIN documents d ON d.id = c.document_id WHERE d.status = 'ready'""").fetchall()
    candidates = [r for r in rows if len(r["text"]) >= 300]
    random.Random(seed).shuffle(candidates)
    url, headers = runtime.ensure("chat", settings["model"])
    questions, english = [], 0
    for row in candidates:
        if len(questions) >= count:
            break
        cross = english < count // 4 and len(questions) % 4 == 3
        language = "English" if cross else "the same language as the passage (Traditional Chinese if Chinese)"
        response = httpx.post(url + "/v1/chat/completions", headers=headers, timeout=120, json={
            "model": settings["model"], "max_tokens": 120, "temperature": 0.3,
            "chat_template_kwargs": {"enable_thinking": False},
            "messages": [{"role": "user", "content": PROMPT.format(language=language, text=row["text"])}],
        }).raise_for_status().json()
        question = response["choices"][0]["message"]["content"].strip().strip('"「」')
        if not question or "SKIP" in question.upper() or len(question) > 200:
            continue
        english += cross
        questions.append({"question": question, "chunk_id": row["id"], "document_id": row["document_id"],
                          "page": row["page"], "document": row["name"], "cross_lingual": cross})
        print(f"[{len(questions)}/{count}] {question}", flush=True)
    return questions


def ranks(library: Library, settings: dict, item: dict, cache: dict) -> dict[str, int | None]:
    """Rank of the source passage under the app's hybrid search, vector only and keywords only."""
    hybrid = library.retrieve(item["question"], None, settings | {"top_k": 50})
    result = {"hybrid": next((i + 1 for i, s in enumerate(hybrid) if s["chunk_id"] == item["chunk_id"]), None),
              "hybrid_same_location": next((i + 1 for i, s in enumerate(hybrid)
                                            if s["document_id"] == item["document_id"] and s["page"] == item["page"]), None)}
    if "matrix" not in cache:
        with library.connect() as db:
            rows = db.execute("SELECT c.id, c.text, c.vector FROM chunks c JOIN documents d ON d.id = c.document_id "
                              "WHERE d.status = 'ready'").fetchall()
        cache["ids"] = np.array([r["id"] for r in rows])
        cache["matrix"] = np.stack([np.frombuffer(r["vector"], dtype=np.float32) for r in rows])
        cache["tokens"] = [tokens(r["text"]) for r in rows]
    target = int(np.where(cache["ids"] == item["chunk_id"])[0][0])
    vector = library.client.embed([item["question"]], settings, query=True)[0]
    semantic = cache["matrix"] @ vector
    result["vector"] = int((semantic > semantic[target]).sum()) + 1
    keywords = tokens(item["question"])
    lexical = np.array([len(keywords & t) / max(1, len(keywords)) for t in cache["tokens"]])
    result["keywords"] = int((lexical > lexical[target]).sum()) + 1
    return result


def summarize(values: list[int | None]) -> dict:
    found = np.array([v if v is not None else 10**9 for v in values])
    return {"R@1": round(float((found <= 1).mean()), 3), "R@5": round(float((found <= 5).mean()), 3),
            "R@10": round(float((found <= 10).mean()), 3), "MRR": round(float(np.mean(1 / found)), 3)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path(os.environ["APPDATA"]) / "local-rag-desktop" / "library")
    parser.add_argument("--questions", type=int, default=60)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--regenerate", action="store_true", help="write a new question set (breaks comparability)")
    parser.add_argument("--note", default="", help="what changed since the last run")
    args = parser.parse_args()

    folder = args.data_dir / "eval"
    folder.mkdir(exist_ok=True)
    question_file = folder / "retrieval-questions.json"
    runtime = LlamaRuntime(*default_paths(), log_dir=args.data_dir)
    library = Library(args.data_dir, ModelClient(runtime))
    try:
        settings = library.settings()
        if args.regenerate or not question_file.exists():
            questions = generate(library, runtime, settings, args.questions, args.seed)
            question_file.write_text(json.dumps(questions, ensure_ascii=False, indent=2), "utf-8")
            runtime.stop("chat")
        questions = json.loads(question_file.read_text("utf-8"))
        with library.connect() as db:
            present = {r[0] for r in db.execute("SELECT id FROM chunks")}
        questions = [q for q in questions if q["chunk_id"] in present]

        started, cache, per_question = time.time(), {}, []
        for item in questions:
            per_question.append(item | {"ranks": ranks(library, settings, item, cache)})
        elapsed = time.time() - started

        groups = {"all": per_question,
                  "same-language": [q for q in per_question if not q["cross_lingual"]],
                  "cross-lingual": [q for q in per_question if q["cross_lingual"]]}
        metrics = {name: {method: summarize([q["ranks"][method] for q in items])
                          for method in ("hybrid", "hybrid_same_location", "vector", "keywords")} | {"n": len(items)}
                   for name, items in groups.items() if items}
        commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=root, capture_output=True, text=True).stdout.strip()
        record = {"time": time.strftime("%Y-%m-%d %H:%M"), "commit": commit, "note": args.note,
                  "embedding_model": settings["embedding_model"], "chunks": len(cache.get("ids", [])),
                  "seconds_per_query": round(elapsed / max(1, len(questions)), 3), "metrics": metrics}
        with open(folder / "results.jsonl", "a", encoding="utf-8") as output:
            output.write(json.dumps(record, ensure_ascii=False) + "\n")
        (folder / "last-run.json").write_text(json.dumps(per_question, ensure_ascii=False, indent=2), "utf-8")

        print(f"\n{record['embedding_model']} · {record['chunks']} passages · {len(questions)} questions · "
              f"{record['seconds_per_query']} s/query · commit {commit}")
        print(f"{'':16}{'method':22}{'R@1':>7}{'R@5':>7}{'R@10':>7}{'MRR':>7}")
        for name, block in metrics.items():
            for method in ("hybrid", "hybrid_same_location", "vector", "keywords"):
                m = block[method]
                print(f"{name + ' (' + str(block['n']) + ')':16}{method:22}{m['R@1']:7.3f}{m['R@5']:7.3f}{m['R@10']:7.3f}{m['MRR']:7.3f}")
        print(f"\nSaved to {folder}")
    finally:
        library.close()


if __name__ == "__main__":
    main()
