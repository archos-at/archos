from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import sys
from pathlib import Path

PAGES_PER_DOC = 4

SAMPLE_SEED = 0

MAX_CHUNK_CHARS = 2000

_BATCH = 64

DEFAULT_MODEL = os.environ.get("EMBED_MODEL", "openai/text-embedding-3-large")
DEFAULT_BASE_URL = os.environ.get("EMBED_BASE_URL", "https://openrouter.ai/api/v1")


def default_fixture_path() -> Path:
    return Path(__file__).resolve().parents[2] / "fixtures" / "vector_channel_recorded.json"


def resolve_api_key(base_url: str, model: str) -> str:
    try:
        from knowledge_layer.embedding import resolve_embed_api_key

        key = resolve_embed_api_key(base_url, model)
        if key:
            return key
    except Exception:  # noqa: BLE001 - the hand chain below is the whole point
        pass
    for env in ("EMBED_API_KEY", "OPENROUTER_KEY", "OPENROUTER_API_KEY"):
        value = os.environ.get(env)
        if value:
            return value
    raise SystemExit("No embeddings key: set EMBED_API_KEY (or the provider key for EMBED_BASE_URL).")


def embed(texts: list[str], *, model: str, base_url: str, api_key: str) -> list[list[float]]:
    import httpx

    vectors: list[list[float]] = []
    with httpx.Client(timeout=180.0) as client:
        for start in range(0, len(texts), _BATCH):
            batch = texts[start : start + _BATCH]
            response = client.post(
                f"{base_url.rstrip('/')}/embeddings",
                json={"model": model, "input": batch},
                headers={"Authorization": f"Bearer {api_key}"},
            )
            response.raise_for_status()
            payload = response.json()["data"]
            vectors.extend(item["embedding"] for item in sorted(payload, key=lambda item: item["index"]))
            print(f"  embedded {min(start + _BATCH, len(texts))}/{len(texts)}", file=sys.stderr)
    return vectors


def read_corpus(corpus_dir: Path) -> list[tuple[str, int, str]]:
    import pdfplumber

    rng = random.Random(SAMPLE_SEED)
    chunks: list[tuple[str, int, str]] = []
    for path in sorted(corpus_dir.glob("*.pdf")):
        with pdfplumber.open(path) as pdf:
            pages = len(pdf.pages)
            for index in sorted(rng.sample(range(pages), min(PAGES_PER_DOC, pages))):
                text = (pdf.pages[index].extract_text() or "").strip()
                if text:
                    chunks.append((path.name, index + 1, text[:MAX_CHUNK_CHARS]))
    return chunks


def embed_text_for(file_name: str, page: int, text: str) -> str:
    return f"file_name: {file_name}\npage_label: {page}\n\n{text}"


def corpus_fingerprint(chunks: list[tuple[str, int, str]]) -> str:
    digest = hashlib.sha256()
    for file_name, page, text in chunks:
        digest.update(f"{file_name}\x00{page}\x00{text}\x00".encode())
    return digest.hexdigest()[:16]


def cosine(left: list[float], right: list[float]) -> float:
    dot = sum(x * y for x, y in zip(left, right, strict=True))
    left_norm = sum(x * x for x in left) ** 0.5
    right_norm = sum(x * x for x in right) ** 0.5
    if not left_norm or not right_norm:
        return 0.0
    return dot / (left_norm * right_norm)


def record(golden_path: Path, corpus_dir: Path, *, model: str, base_url: str) -> dict:
    entries = json.loads(golden_path.read_text())["entries"]
    chunks = read_corpus(corpus_dir)
    if not chunks:
        raise SystemExit(f"No corpus text under {corpus_dir}")
    print(f"corpus: {len(chunks)} page-chunks", file=sys.stderr)

    api_key = resolve_api_key(base_url, model)
    print("embedding corpus …", file=sys.stderr)
    chunk_vectors = embed([embed_text_for(*chunk) for chunk in chunks], model=model, base_url=base_url, api_key=api_key)
    print("embedding questions …", file=sys.stderr)
    question_vectors = embed([entry["question"] for entry in entries], model=model, base_url=base_url, api_key=api_key)

    rankings: dict[str, list[list]] = {}
    for entry, question_vector in zip(entries, question_vectors, strict=True):
        best: dict[str, float] = {}
        for (file_name, _page, _text), chunk_vector in zip(chunks, chunk_vectors, strict=True):
            score = cosine(question_vector, chunk_vector)
            if score > best.get(file_name, -2.0):
                best[file_name] = score
        ordered = sorted(best.items(), key=lambda item: -item[1])
        rankings[entry["id"]] = [[file_name, round(score, 6)] for file_name, score in ordered]

    return {
        "schema_version": 1,
        "description": (
            "Recorded file-level vector-channel ranking per golden question. Produced by "
            "oib_retrieval.record_vector against the real data/oib corpus with the "
            "production embedding model. Re-record when the model, the corpus or the "
            "golden questions change; the harness refuses a fixture whose model does not "
            "match the configured one."
        ),
        "model": model,
        "base_url": base_url,
        "pages_per_doc": PAGES_PER_DOC,
        "sample_seed": SAMPLE_SEED,
        "corpus_fingerprint": corpus_fingerprint(chunks),
        "chunk_count": len(chunks),
        "rankings": rankings,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Record the VECTOR channel's file-level ranking for every golden question."
    )
    parser.add_argument("--golden", default=None)
    parser.add_argument("--corpus", default="data/oib")
    parser.add_argument("--out", default=None)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    args = parser.parse_args(argv)

    from oib_retrieval.overview import default_golden_path

    golden = Path(args.golden) if args.golden else default_golden_path()
    out = Path(args.out) if args.out else default_fixture_path()
    payload = record(golden, Path(args.corpus), model=args.model, base_url=args.base_url)
    out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {out} ({len(payload['rankings'])} questions, model {payload['model']})")
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI entry
    raise SystemExit(main())
