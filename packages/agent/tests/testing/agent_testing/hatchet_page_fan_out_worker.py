"""An ingest worker for the real-engine tests of the page fan-out (ADR-0151): our steps, scripted work.

``python -m agent_testing.hatchet_page_fan_out_worker <dir>`` serves the real
``ingest-document`` in steps and ``read-page`` (``INGEST_PAGE_FAN_OUT=on``,
``agent.knowledge.ingest_hatchet.serve``) against the engine the
``HATCHET_CLIENT_*`` variables name. The step functions of ``ingest_steps`` are
scripted, since reading a document needs Qdrant, a model and an object store;
the declaration, the limits, the durable fan-out and the retries are the
production code's.

The job id says what the scripted job holds:

* ``pages<N>-…``: ``N`` pages to read, each ``PAGE_SECONDS`` long.
* ``flaky<N>-…``: ``N`` pages; page 2 fails on its first attempt.
* ``text-…``: no page to fan out; ``read-pages`` is skipped.

Each step writes ``<step> <job id> <page or -> <attempt> <start> <end>`` to
``<dir>/events.log``, read by the tests.
"""

from __future__ import annotations

import contextlib
import os
import re
import sys
import threading
import time
from pathlib import Path

from agent.knowledge import ingest_hatchet
from agent.knowledge import ingest_steps
from agent_testing import hatchet_engine_worker as scripted

PAGE_SECONDS = 0.5
_attempts: dict[tuple[str, int], int] = {}
_lock = threading.Lock()


def _log(directory: Path, step: str, job: str, page: object, attempt: int, start: float) -> None:
    with _lock, (directory / "events.log").open("a") as handle:
        handle.write(f"{step} {job} {page} {attempt} {start:.3f} {time.time():.3f}\n")


def _job_of(payload: str) -> str:
    return scripted.decode(payload).job_id


def install(directory: Path) -> None:
    """Replace the step functions with scripted ones; the declaration around them stays ours."""

    def extract(payload: str) -> dict:
        job, start = _job_of(payload), time.time()
        count = int((re.match(r"(?:pages|flaky)(\d+)-", job) or [None, "0"])[1])
        pages = [{"page": n, "kind": "transcribe"} for n in range(1, count + 1)]
        _log(directory, "extract", job, "-", 1, start)
        return {"fan_out": bool(pages), "reason": None, "content_hash": "h" * 64, "pages": pages}

    def read_page(payload: str, *, page: int, kind: str, content_hash: str, final: bool) -> dict:
        from knowledge_layer.llamaindex.read_page import PageNotRead

        job, start = _job_of(payload), time.time()
        with _lock:
            attempt = _attempts[(job, page)] = _attempts.get((job, page), 0) + 1
        time.sleep(PAGE_SECONDS)
        _log(directory, "page", job, page, attempt, start)
        if job.startswith("flaky") and page == 2 and attempt == 1:
            raise PageNotRead("model_failed")
        return {"page": page, "read": True, "reason": None, "stored": True}

    @contextlib.contextmanager
    def scope(prepared):
        yield {"answers": 0, "pages_read_here": 0, "enrichment_stored": 1}

    def assembly(extracted: dict, counts: dict):
        @contextlib.contextmanager
        def counted(prepared):
            with scope(prepared) as inner:
                yield inner
                counts.update(inner)

        return counted

    def enrich(payload: str, name: str, content_hash: str | None) -> dict:
        _log(directory, f"enrich-{name}", _job_of(payload), "-", 1, time.time())
        return {"part": name, "found": True, "permit": name == "tags"}

    def permit(payload: str, content_hash: str | None) -> dict:
        _log(directory, "permit", _job_of(payload), "-", 1, time.time())
        return {"permit": True}

    def write_rows(payload: str, content_hash: str | None) -> dict:
        _log(directory, "write", _job_of(payload), "-", 1, time.time())
        return {"written": True}

    for name, fn in {
        "extract": extract,
        "read_page": read_page,
        "assembly": assembly,
        "enrich": enrich,
        "permit": permit,
        "write_rows": write_rows,
    }.items():
        setattr(ingest_steps, name, fn)


def main(directory: str) -> None:
    os.environ["INGEST_PAGE_FAN_OUT"] = "on"
    path = Path(directory)
    install(path)

    @contextlib.asynccontextmanager
    async def lifespan():
        yield scripted.ScriptedIngestor(path / "assemble.log")

    ingest_hatchet.serve(lifespan, scripted.decode, slots=8)


if __name__ == "__main__":
    main(sys.argv[1])
