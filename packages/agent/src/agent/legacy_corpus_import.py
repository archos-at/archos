from __future__ import annotations

import hashlib
import json
import logging
import sys
from pathlib import Path

from agent import corpus_store
from agent.knowledge.leader_lock import keyed_lock

logger = logging.getLogger(__name__)


def legacy_pdfs(root: Path, operator_dir: Path | None = None) -> dict[str, Path]:
    excluded_path = root / "oib_excluded.json"
    excluded = set(json.loads(excluded_path.read_text(encoding="utf-8"))) if excluded_path.is_file() else set()
    found: dict[str, Path] = {}
    for directory, honour_exclusions in ((operator_dir or root / "oib", True), (root / "oib_uploads", False)):
        if not directory.is_dir():
            continue
        for pdf in sorted(directory.glob("*.pdf")):
            if honour_exclusions and pdf.name in excluded:
                continue
            found[pdf.name] = pdf
    return found


def _import_one(name: str, data: bytes) -> str:
    with keyed_lock(f"oib-file:{name}"):
        existing = corpus_store.get_file(name)
        if existing is not None and existing.sha256 == hashlib.sha256(data).hexdigest():
            return "unchanged"
        if existing is not None:
            logger.warning("Skipping %s: the corpus keeps other bytes under this name", name)
            return "skipped"
        try:
            corpus_store.put(name, data)
        except corpus_store.CorpusStoreError as e:
            logger.error("Could not store %s: %s", name, e)
            return "failed"
        return "stored"


def import_legacy_corpus(root: Path, operator_dir: Path | None = None) -> dict[str, int]:
    counts = {"stored": 0, "unchanged": 0, "skipped": 0, "failed": 0}
    for name, pdf in legacy_pdfs(root, operator_dir).items():
        if not corpus_store.is_valid_name(name):
            logger.warning("Skipping %s: not a corpus file name", name)
            counts["skipped"] += 1
            continue
        counts[_import_one(name, pdf.read_bytes())] += 1
    return counts


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) not in (1, 2):
        print("usage: python -m agent.legacy_corpus_import <old /app/data> [operator oib dir]", file=sys.stderr)
        return 2
    logging.basicConfig(level=logging.INFO)
    counts = import_legacy_corpus(Path(args[0]), Path(args[1]) if len(args) == 2 else None)
    print(f"[legacy-corpus-import] {json.dumps(counts, sort_keys=True)}", flush=True)
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    sys.exit(main())
