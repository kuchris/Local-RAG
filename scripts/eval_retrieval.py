"""Retrieval benchmark on your own library, to compare optimizations against a fixed baseline.

The first run samples passages and asks the answer model to write one paraphrased question per
passage (a quarter in English, to cover cross-lingual search) and to copy the sentence that answers
it. Questions are saved and reused, so later runs measure only retrieval changes. A result counts as
a hit when a retrieved passage contains that answer sentence, so the metric survives re-chunking.
Each run appends its metrics to results.jsonl.

Questions quote your documents, so everything is stored in the library folder, not the repository.
Close the app first: this opens the library and starts its own model servers.

    .venv\\Scripts\\python.exe scripts\\eval_retrieval.py [--data-dir DIR] [--questions 60] [--note "..."]
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import subprocess
import sys
import time
from difflib import SequenceMatcher
from pathlib import Path

import httpx
import numpy as np

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from backend.core import Library, ModelClient  # noqa: E402
from backend.llama import LlamaRuntime, default_paths  # noqa: E402
from backend.prompt import prepare_messages  # noqa: E402

QUESTION_PROMPT = """Below is a passage from a book or document. Write ONE question that a reader could ask and that this passage answers specifically.
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

ANSWER_PROMPT = """Copy, word for word, the shortest sentence or two from the passage that answer the question.
Do not change, translate or add anything. Reply with only the copied text.

<passage>
{text}
</passage>

Question: {question}"""


def chat(url, headers, model, prompt, max_tokens):
    response = httpx.post(url + "/v1/chat/completions", headers=headers, timeout=120, json={
        "model": model, "max_tokens": max_tokens, "temperature": 0.3,
        "chat_template_kwargs": {"enable_thinking": False},
        "messages": [{"role": "user", "content": prompt}],
    }).raise_for_status().json()
    return response["choices"][0]["message"]["content"].strip()


def normalize(text: str) -> str:
    return re.sub(r"\s+", "", text)


def covers(text: str, answer: str) -> bool:
    """True when `text` holds most of the answer sentence (it may straddle a passage boundary)."""
    a, b = normalize(answer), normalize(text)
    if not a:
        return False
    if a in b:
        return True
    match = SequenceMatcher(None, a, b, autojunk=False).find_longest_match(0, len(a), 0, len(b))
    return match.size >= 0.6 * len(a)


STRICT_PROMPT = """Which single sentence of the passage best answers the question? Reply with that one sentence
exactly as it appears, character for character, including punctuation. Do not explain.

<passage>
{text}
</passage>

Question: {question}"""


def answer_span(url, headers, model, passage, question):
    """A verbatim answer sentence, or None when the model cannot quote one (the question is then skipped)."""
    for prompt in (ANSWER_PROMPT, STRICT_PROMPT):
        span = chat(url, headers, model, prompt.format(text=passage, question=question), 300).strip('「」"')
        if covers(passage, span) and len(normalize(span)) >= 6:
            return span
    return None


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
        question = chat(url, headers, settings["model"], QUESTION_PROMPT.format(language=language, text=row["text"]), 120).strip('"「」')
        if not question or "SKIP" in question.upper() or len(question) > 200:
            continue
        english += cross
        questions.append({"question": question, "chunk_id": row["id"], "document_id": row["document_id"],
                          "page": row["page"], "document": row["name"], "cross_lingual": cross, "passage": row["text"],
                          "answer": answer_span(url, headers, settings["model"], row["text"], question)})
        print(f"[{len(questions)}/{count}] {question}", flush=True)
    return questions


def upgrade(library: Library, runtime: LlamaRuntime, settings: dict, questions: list[dict]) -> bool:
    """Add the source passage and answer sentence to question sets made by the first version."""
    # Also retry answers that an earlier version replaced with the whole passage.
    missing = [q for q in questions if "answer" not in q or q["answer"] == q.get("passage")]
    if not missing:
        return False
    with library.connect() as db:
        for q in missing:
            row = db.execute("SELECT text FROM chunks WHERE id = ?", (q["chunk_id"],)).fetchone()
            if row is None:
                raise SystemExit("The question set predates answer sentences and its passages were re-chunked; use --regenerate.")
            q.setdefault("passage", row["text"])
    url, headers = runtime.ensure("chat", settings["model"])
    for i, q in enumerate(missing, 1):
        q["answer"] = answer_span(url, headers, settings["model"], q["passage"], q["question"])
        print(f"[answer {i}/{len(missing)}] {'ok' if q['answer'] else 'skipped'}", flush=True)
    return True


def first_hit(texts, answer):
    return next((i + 1 for i, text in enumerate(texts) if covers(text, answer)), None)


def evaluate(library: Library, settings: dict, item: dict, cache: dict) -> dict[str, int | None | bool]:
    """Rank of the first passage holding the answer: hybrid (+ reranker), vector only, keywords only;
    and whether the answer survives into the prompt the answer model receives."""
    hybrid = library.retrieve(item["question"], None, settings | {"top_k": 50})
    result = {"hybrid": first_hit([s["text"] for s in hybrid], item["answer"])}
    _, selected = prepare_messages(item["question"], hybrid[: settings["top_k"]], [], settings["max_tokens"])
    result["in_prompt"] = any(covers(s["text"], item["answer"]) for s in selected)
    if "matrix" not in cache:
        with library.connect() as db:
            rows = db.execute("SELECT c.id, c.text, c.vector FROM chunks c JOIN documents d ON d.id = c.document_id "
                              "WHERE d.status = 'ready'").fetchall()
        cache["ids"] = np.array([r["id"] for r in rows])
        cache["texts"] = [r["text"] for r in rows]
        cache["matrix"] = np.stack([np.frombuffer(r["vector"], dtype=np.float32) for r in rows])
    vector = library.client.embed([item["question"]], settings, query=True)[0]
    order = np.argsort(-(cache["matrix"] @ vector))[:50]
    result["vector"] = first_hit([cache["texts"][i] for i in order], item["answer"])
    keyword, _ = library.keyword_scores(item["question"], limit=50)
    position = {int(i): n for n, i in enumerate(cache["ids"])}
    result["keywords"] = first_hit([cache["texts"][position[i]] for i in keyword if i in position], item["answer"])
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
    parser.add_argument("--reranker", help="reranker model ID to use instead of the saved setting; empty string = off")
    args = parser.parse_args()

    folder = args.data_dir / "eval"
    folder.mkdir(exist_ok=True)
    question_file = folder / "retrieval-questions.json"
    runtime = LlamaRuntime(*default_paths(), log_dir=args.data_dir)
    library = Library(args.data_dir, ModelClient(runtime))
    try:
        settings = library.settings()
        if args.reranker is not None:
            settings["reranker_model"] = args.reranker
        if args.regenerate or not question_file.exists():
            questions = generate(library, runtime, settings, args.questions, args.seed)
            question_file.write_text(json.dumps(questions, ensure_ascii=False, indent=2), "utf-8")
        questions = json.loads(question_file.read_text("utf-8"))
        if upgrade(library, runtime, settings, questions):
            question_file.write_text(json.dumps(questions, ensure_ascii=False, indent=2), "utf-8")
        runtime.stop("chat")
        questions = [q for q in questions if q.get("answer")]

        started, cache, per_question = time.time(), {}, []
        for item in questions:
            per_question.append(item | {"ranks": evaluate(library, settings, item, cache)})
        elapsed = time.time() - started

        groups = {"all": per_question,
                  "same-language": [q for q in per_question if not q["cross_lingual"]],
                  "cross-lingual": [q for q in per_question if q["cross_lingual"]]}
        metrics = {}
        for name, items in groups.items():
            if items:
                metrics[name] = {method: summarize([q["ranks"][method] for q in items]) for method in ("hybrid", "vector", "keywords")}
                metrics[name] |= {"in_prompt": round(float(np.mean([q["ranks"]["in_prompt"] for q in items])), 3), "n": len(items)}
        commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=root, capture_output=True, text=True).stdout.strip()
        record = {"time": time.strftime("%Y-%m-%d %H:%M"), "commit": commit, "note": args.note, "metric": "answer-sentence v2",
                  "embedding_model": settings["embedding_model"], "reranker_model": settings.get("reranker_model") or None,
                  "chunks": len(cache.get("ids", [])), "seconds_per_query": round(elapsed / max(1, len(questions)), 3),
                  "metrics": metrics}
        with open(folder / "results.jsonl", "a", encoding="utf-8") as output:
            output.write(json.dumps(record, ensure_ascii=False) + "\n")
        (folder / "last-run.json").write_text(json.dumps(per_question, ensure_ascii=False, indent=2), "utf-8")

        print(f"\n{record['embedding_model']} + reranker {record['reranker_model']} · {record['chunks']} passages · "
              f"{len(questions)} questions · {record['seconds_per_query']} s/query · commit {commit}")
        print(f"{'':20}{'method':10}{'R@1':>7}{'R@5':>7}{'R@10':>7}{'MRR':>7}   answer in prompt")
        for name, block in metrics.items():
            for method in ("hybrid", "vector", "keywords"):
                m = block[method]
                extra = f"   {block['in_prompt']:.3f}" if method == "hybrid" else ""
                print(f"{name + ' (' + str(block['n']) + ')':20}{method:10}{m['R@1']:7.3f}{m['R@5']:7.3f}{m['R@10']:7.3f}{m['MRR']:7.3f}{extra}")
        print(f"\nSaved to {folder}")
    finally:
        library.close()


if __name__ == "__main__":
    main()
