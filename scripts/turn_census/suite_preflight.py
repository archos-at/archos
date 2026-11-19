from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from answer_checks import _family_number
from census import ROOT
from census import ensure_key
from census import run_python
from census import source_packages
from census import tree_pythonpath


def corpus_families() -> set[str] | None:
    from agent import corpus_store
    from agent.common.norm_registry import oib_family_member

    try:
        names = corpus_store.list_files()
    except Exception:  # noqa: BLE001 - no database configured is "unknown", not a failure
        return None
    return {member for name in names if (member := oib_family_member(name))}


def lacking_family(question: dict, families: set[str] | None) -> str | None:
    family = _family_number(question.get("family"))
    if family is None or families is None or family in families:
        return None
    return f"OIB-RL {family}"


def _ingest_corpus(poll_seconds: float = 5.0, timeout_seconds: float = 3600.0) -> str | None:
    from agent import corpus_store
    from agent import oib_sync

    def run_corpus_job_here(prepared) -> bool:
        oib_sync._get_oib_ingestor().run_prepared(prepared)
        return True

    print("ingesting the corpus:", oib_sync.sync(enqueue=run_corpus_job_here))
    unfinished = (oib_sync.JobProgress.WAITING, oib_sync.JobProgress.RUNNING)
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        result = oib_sync.sync(enqueue=run_corpus_job_here)
        rows = corpus_store.list_files()
        waiting = [
            name
            for name, row in rows.items()
            if row.needs_ingestion(oib_sync.CHUNK_FORMAT_VERSION) and oib_sync.progress_of(row) in unfinished
        ]
        if not waiting:
            print("ingested the corpus:", result)
            return f"{result.failed} file(s) could not be ingested" if result.failed else None
        print(f"ingesting: {len(waiting)} file(s) left")
        time.sleep(poll_seconds)
    return f"the corpus was not ingested within {timeout_seconds:.0f} s"


def use_local_corpus(directory: Path) -> int:
    import hashlib
    import shutil

    from agent import corpus_store

    prefix = "base-corpus/"

    def request_upload_url(name: str) -> tuple[str, str]:
        return name, prefix + name

    def put_object(name: str, data: bytes) -> None:
        stored = directory / name
        if hashlib.sha256(stored.read_bytes()).hexdigest() != hashlib.sha256(data).hexdigest():
            raise corpus_store.CorpusStoreError(f"{name} in {directory} is not the file being stored")

    def delete_object(name: str) -> None:
        raise corpus_store.CorpusStoreError(f"--corpus never deletes from {directory}")

    def download_object(storage_key: str, out) -> None:
        with (directory / storage_key.removeprefix(prefix)).open("rb") as source:
            shutil.copyfileobj(source, out)

    corpus_store._request_upload_url = request_upload_url
    corpus_store._put_object = put_object
    corpus_store._delete_object = delete_object
    corpus_store._download_object = download_object
    pdfs = sorted(path for path in directory.glob("*.pdf") if corpus_store.is_valid_name(path.name))
    for pdf in pdfs:
        corpus_store.put(pdf.name, pdf.read_bytes())
    return len(pdfs)


def _corpus_ready() -> bool:
    try:
        from knowledge_layer.vector_store import get_store

        from agent.oib_sync import COLLECTION_NAME

        return get_store().count(COLLECTION_NAME) > 0
    except Exception as exc:  # noqa: BLE001 - any failure is "not ready", said out loud
        print(f"corpus check failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return False


def inventory_database() -> Path | None:
    url = os.environ.get("SUMMARY_DB") or "sqlite+aiosqlite:///./summaries.db"
    prefix = "sqlite+aiosqlite:///"
    if not url.startswith(prefix):
        return None
    path = Path(url[len(prefix) :])
    return (path if path.is_absolute() else ROOT / path).resolve()


def foreign_imports(out: Path) -> list[str]:
    import subprocess

    names = ("agent", *source_packages())
    probe = f"import {', '.join(names)}; print({', '.join(f'{name}.__file__' for name in names)}, sep=chr(10))"
    env = {**os.environ, "PYTHONPATH": tree_pythonpath(out)}
    shown = subprocess.run(
        [run_python(), "-P", "-c", probe], cwd=ROOT, env=env, capture_output=True, text=True, check=False
    )
    if shown.returncode != 0:
        return [f"import failed: {shown.stderr.strip().splitlines()[-1] if shown.stderr.strip() else shown.returncode}"]
    root = ROOT.resolve()
    return [
        f"{name}: {path}"
        for name, path in zip(names, shown.stdout.splitlines(), strict=False)
        if not Path(path).resolve().is_relative_to(root)
    ]


def inventory_ready(path: Path | None) -> bool:
    if path is None:
        return True  # not SQLite: the deployment's own store, not ours to check
    import sqlite3
    from contextlib import closing

    try:
        with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
            (count,) = db.execute(
                "SELECT count(*) FROM document_metadata WHERE collection = 'oib_knowledge'"
            ).fetchone()
    except sqlite3.Error:
        return False
    return count > 0


def _preflight(out: Path, ingest: bool, corpus: Path | None = None, needs_corpus: bool = True) -> int:
    if not ensure_key():
        print("OPENROUTER_API_KEY is not set; the suite needs the real models.", file=sys.stderr)
        return 2
    foreign = foreign_imports(out)
    if foreign:
        print(
            "The runs would not measure this checkout: " + "; ".join(foreign) + ". Run the suite with this "
            "checkout's interpreter (task setup inside it), or measure from the checkout that holds the code.",
            file=sys.stderr,
        )
        return 2
    if not needs_corpus:
        return 0
    if ingest:
        if corpus is not None:
            print(f"the corpus is {use_local_corpus(corpus)} PDF(s) from {corpus}")
        problem = _ingest_corpus()
        if problem:
            print(problem, file=sys.stderr)
    if not _corpus_ready():
        print(
            "The OIB corpus is not ingested into the Qdrant at QDRANT_URL. Upload the PDFs "
            "(scripts/upload_oib_corpus.py) and run with --ingest.",
            file=sys.stderr,
        )
        return 2
    summary_db = os.environ.get("SUMMARY_DB", "")
    if summary_db and "://" not in summary_db:
        print(
            f"SUMMARY_DB is a path, not a database URL: {summary_db}. "
            "Use sqlite+aiosqlite:////absolute/path/summaries.db.",
            file=sys.stderr,
        )
        return 2
    database = inventory_database()
    if not inventory_ready(database):
        print(
            f"The document inventory at {database} lists no corpus documents: runs would have no inventory, "
            "no family overviews and no quote checks. Point SUMMARY_DB at the database the ingest wrote "
            "(sqlite+aiosqlite:////absolute/path/summaries.db).",
            file=sys.stderr,
        )
        return 2
    return 0
