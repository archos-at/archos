"""The offline ingest harness the page-read pool was measured on: ``INGEST_PAGE_FAN_OUT`` off against on (ADR-0151).

``python -m knowledge_layer_testing.page_fan_out_bench`` builds the 52-page PDF of
the first step's measurement (12 CAD sheets of ``build_drawing_sheets_pdf`` and
40 scanned pages), stubs every model call to a fixed delay (``MODEL_SECONDS``,
1 s: each transcription, each drawing reading, each enrichment call), keeps
Qdrant, the object store, the vision cache and the summary database in memory
or on local disk, and runs the production code: ``_ingest_job`` for ``off``;
``extract`` and ``read_page``, the assembly around ``_ingest_job`` and
``enrich`` for ``on``. The orchestrator is emulated
(:class:`EmulatedEngine`): each task start costs ``DISPATCH_SECONDS``, a failed
page is retried after Hatchet's backoff (``factor ** retry``), and the page tasks
run ``page_slots`` at once, what one page-read worker (16 slots) or two give.

It prints, per scenario: the wall time, the time the chunks were written (the
document is searchable from there), the model calls, and for a crash the
seconds and calls the retry spent. Not a test: its numbers are what ADR-0151
quotes. ``tests/knowledge_layer_tests/test_page_fan_out.py`` runs the same
harness with a short delay to hold the behaviour.
"""

from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from dataclasses import field
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest import mock

MODEL_SECONDS = 1.0
#: What one task start costs on the engine (assumed; hatchet-lite's measured scheduling latency is not ours to quote).
DISPATCH_SECONDS = 0.05
BACKOFF_FACTOR = 2.0


class Killed(BaseException):
    """The worker died: not an ``Exception``, so nothing in the pipeline catches it."""


@dataclass
class Meter:
    """The stubbed model: counts calls, can kill the worker after ``kill_after`` answers."""

    delay: float
    calls: int = 0
    answered: int = 0
    kill_after: int | None = None
    fail_once: set[int] = field(default_factory=set)
    #: When the worker died; a call in flight then never answers.
    kill_at: float | None = None
    #: Whether the dead worker's process is still the one calling (``off``: until the retry starts).
    dead: bool = False
    #: Whether the whole process dies (``off``), or only the tasks in flight on it (``on``).
    kills_process: bool = True
    lock: threading.Lock = field(default_factory=threading.Lock)
    written_at: float | None = None
    written_ids: list[str] = field(default_factory=list)
    #: A call on a thread that set ``fails.now`` answers as a failed transcription would.
    fails: threading.local = field(default_factory=threading.local)
    started: float = 0.0

    def call(self, reply: Any) -> Any:
        started = time.monotonic()
        with self.lock:
            if self.dead:
                raise Killed()
            self.calls += 1
        time.sleep(self.delay)
        with self.lock:
            if self.dead or (self.kill_at is not None and started <= self.kill_at):
                raise Killed()
            self.answered += 1
            if self.kill_after is not None and self.answered >= self.kill_after:
                self.kill_after = None
                self.kill_at = time.monotonic()
                self.dead = self.kills_process
        return reply


def _scan_pdf(pages: int) -> bytes:
    from PIL import Image
    from PIL import ImageDraw

    images = []
    for number in range(pages):
        image = Image.new("RGB", (240, 340), "white")
        ImageDraw.Draw(image).text((10, 10), f"Seite {number + 1} Auflagen", fill="black")
        images.append(image)
    buf = io.BytesIO()
    images[0].save(buf, "PDF", resolution=30.0, save_all=True, append_images=images[1:])
    return buf.getvalue()


def mixed_pdf(directory: Path, *, sheets: int = 12, scans: int = 40) -> str:
    """The first step's 52-page PDF: ``sheets`` CAD sheets, then ``scans`` scanned pages."""
    import pypdfium2 as pdfium

    from knowledge_layer_testing.pdf_fixtures import build_drawing_sheets_pdf

    out = pdfium.PdfDocument.new()
    for data in (build_drawing_sheets_pdf(sheets, 400), _scan_pdf(scans)):
        out.import_pages(pdfium.PdfDocument(data))
    path = directory / "mixed.pdf"
    out.save(str(path))
    return str(path)


class ObjectStore:
    """The BFF's presign and SeaweedFS, in memory: one key per (document, part)."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.lock = threading.Lock()

    def presign(self, document_id, collection, part, organization_id=None):
        key = f"org/{document_id}/v1/_text/{part}"
        return SimpleNamespace(
            upload_url=key,
            storage_key=key,
            storage_bucket="docs",
            document_id=document_id,
            version=1,
            content_hash=None,
        )

    def fetch(self, bucket, key):
        with self.lock:
            return self.objects.get(key)

    def upload(self, url, body, content_type):
        with self.lock:
            self.objects[url] = body


@contextlib.contextmanager
def harness(meter: Meter, directory: Path):
    """Everything outside the pod stubbed; yields the ingestor."""
    from knowledge_layer.llamaindex import adapter
    from knowledge_layer.llamaindex import page_text_store
    from knowledge_layer.llamaindex import parsed_store
    from knowledge_layer.llamaindex import processing
    from knowledge_layer.llamaindex import revisions
    from knowledge_layer.llamaindex import transcription
    from knowledge_layer.qdrant import store as store_module
    from knowledge_layer.qdrant import writes as writes_module

    from agent.common.credential_resolution import ResolvedCredential
    from agent.knowledge import configure_summary_db
    from agent.knowledge import document_classification
    from agent.knowledge import dossier
    from agent.knowledge import factory
    from knowledge_layer_testing.qdrant import FakeEmbedder

    objects = ObjectStore()
    cache: dict[str, Any] = {}
    cred = ResolvedCredential(api_key="k", base_url="u", model="m", source="env")
    fake_store = mock.MagicMock()
    fake_store.scroll.return_value = []

    def write_chunks(collection, file_name, records, **kwargs):
        meter.written_at = time.monotonic()
        meter.written_ids = [record.chunk_id for record in records]

    def drawing(image_bytes, **kwargs):
        page_kind = {"analysis": {"page_kind": "drawing"}, "drawing_type": "Grundriss"}
        return meter.call(("Grundriss mit Abmessungen, Raum 1 bis 4", page_kind))

    def transcribe(image_bytes, **kwargs):
        if getattr(meter.fails, "now", False):
            return meter.call("[transcription - failed: ProviderError]")
        return meter.call("# Bescheid\n" + "Auflage " * 40)

    def enrichment(answer):
        return lambda *args, **kwargs: meter.call(answer)

    factory._document_metadata_store = None
    configure_summary_db(f"sqlite:///{directory / 'summaries.db'}")
    patches = [
        mock.patch.object(adapter, "resolve_vlm_credential", lambda organization_id=None: cred),
        mock.patch.object(adapter, "_resolve_vlm_model_override", lambda organization_id: None),
        mock.patch.object(adapter, "_analyze_drawing_page_with_vlm", drawing),
        mock.patch.object(transcription, "_transcribe_live", transcribe),
        mock.patch.object(processing, "get_json", lambda key: cache.get(key)),
        mock.patch.object(processing, "set_json", lambda key, value, ttl=None: cache.__setitem__(key, value)),
        mock.patch.object(processing, "VLM_SECOND_PASS_DELAY_SECONDS", -1.0),
        mock.patch.object(page_text_store, "request_slot", objects.presign),
        mock.patch.object(page_text_store, "put_part", objects.upload),
        mock.patch.object(parsed_store, "_fetch", objects.fetch),
        mock.patch.object(store_module, "get_store", lambda *a, **k: fake_store),
        mock.patch.object(writes_module, "get_store", lambda *a, **k: fake_store),
        mock.patch.object(writes_module, "write_chunks", write_chunks),
        mock.patch.object(writes_module, "refresh_facts", lambda *a, **k: None),
        mock.patch.object(adapter, "_generate_document_summary", enrichment("Ein Satz über den Bescheid.")),
        mock.patch.object(document_classification, "classify_document_tags", enrichment(["Bescheid"])),
        mock.patch.object(document_classification, "suggest_topics", enrichment(["Auflagen"])),
        mock.patch.object(dossier, "write_dossier", enrichment({"document_type": "bescheid"})),
        # The permit extraction is one model call for a Bescheid; no tags is no decision, and no call.
        mock.patch.object(
            adapter.LlamaIndexIngestor,
            "_remember_permit",
            lambda self, config, collection, name, tags, documents: meter.call(None) if tags else None,
        ),
        mock.patch.object(revisions, "record_revisions", lambda *a, **k: None),
    ]
    with contextlib.ExitStack() as stack:
        for patch in patches:
            stack.enter_context(patch)
        ingestor = adapter.LlamaIndexIngestor({"extract_images": False, "extract_charts": False})
        ingestor._embed_model = FakeEmbedder()
        ingestor._initialized = True
        ingestor.generate_summary_enabled = True
        ingestor.summary_llm = SimpleNamespace(model_name="fake/summary")
        ingestor.objects, ingestor.cache = objects, cache
        yield ingestor
    factory._document_metadata_store = None


def _prepare(ingestor: Any, path: str, job_id: str = "job-bench") -> Any:
    config = {
        "original_filenames": ["Bescheid.pdf"],
        "document_id": "00000000-0000-4000-8000-000000000001",
        "organization_id": "org-1",
        "extract_tables": True,
    }
    return ingestor.prepare_job([path], "proj_1", config=config, job_id=job_id)


# ---------------------------------------------------------------------------
# INGEST_PAGE_FAN_OUT off: one step
# ---------------------------------------------------------------------------


def run_off(ingestor: Any, path: str, meter: Meter) -> dict[str, Any]:
    meter.started = time.monotonic()
    prepared = _prepare(ingestor, path)
    try:
        ingestor.run_prepared(prepared)
    except Killed:
        return {"killed": True, "seconds": time.monotonic() - meter.started, "calls": meter.calls}
    status = ingestor.get_job_status(prepared.job_id)
    return {
        "status": status.status.value,
        "seconds": time.monotonic() - meter.started,
        "searchable": (meter.written_at or 0) - meter.started,
        "calls": meter.calls,
    }


# ---------------------------------------------------------------------------
# INGEST_PAGE_FAN_OUT on: the steps, on an emulated engine
# ---------------------------------------------------------------------------


@dataclass
class EmulatedEngine:
    """Starts tasks as Hatchet would: a dispatch cost each, a retry after backoff, ``page_slots`` at once."""

    page_slots: int
    dispatch: float = DISPATCH_SECONDS
    retries: int = 2
    lost: int = 0
    retried: int = 0

    def task(self, fn, *args, **kwargs):
        time.sleep(self.dispatch)
        return fn(*args, **kwargs)

    def page(self, fn, entry: dict[str, Any]) -> dict[str, Any]:
        from knowledge_layer.llamaindex.read_page import PageNotRead

        attempt = 1
        while True:
            time.sleep(self.dispatch)
            try:
                return fn(entry, final=attempt > self.retries)
            except PageNotRead:
                self.retried += 1
                time.sleep(BACKOFF_FACTOR**attempt)
            except Killed:
                # The worker died with this task on it: the engine hands it to another.
                self.lost += 1
            attempt += 1


def run_on(ingestor: Any, path: str, meter: Meter, engine: EmulatedEngine) -> dict[str, Any]:
    from knowledge_layer.llamaindex import assembly
    from knowledge_layer.llamaindex import enrich
    from knowledge_layer.llamaindex import extract
    from knowledge_layer.llamaindex import read_page

    meter.started = time.monotonic()
    prepared = _prepare(ingestor, path)
    extracted = engine.task(extract.extract, ingestor, prepared)
    extract_done = time.monotonic() - meter.started

    def page(entry, *, final):
        if entry["page"] in meter.fail_once:
            meter.fail_once.discard(entry["page"])
            raise read_page.PageNotRead("model_failed")
        return read_page.read_page(
            ingestor,
            prepared,
            page=entry["page"],
            kind=entry["kind"],
            content_hash=extracted["content_hash"],
            final=final,
        )

    with ThreadPoolExecutor(max_workers=engine.page_slots) as pool:
        results = list(pool.map(lambda entry: engine.page(page, entry), extracted["pages"]))
    pages_done = time.monotonic() - meter.started

    def assemble():
        with assembly.assembly(prepared, extracted) as counts:
            ingestor.run_prepared(prepared)
        return counts

    counts = engine.task(assemble)
    content_hash = extracted["content_hash"] if counts.get("enrichment_stored") else None
    with ThreadPoolExecutor(max_workers=4) as pool:
        parts = list(
            pool.map(
                lambda name: engine.task(enrich.enrich_part, ingestor, prepared, name, content_hash),
                ("summary", "tags", "topics", "dossier"),
            )
        )
    tags = next(part for part in parts if part["part"] == "tags")
    if tags["permit"]:
        engine.task(enrich.remember_permit, ingestor, prepared, content_hash)
    engine.task(enrich.write_rows, ingestor, prepared, content_hash)
    engine.task(lambda: None)  # settle
    status = ingestor.get_job_status(prepared.job_id)
    return {
        "status": status.status.value,
        "seconds": time.monotonic() - meter.started,
        "searchable": (meter.written_at or 0) - meter.started,
        "extract": extract_done,
        "pages_done": pages_done,
        "pages": len(results),
        "read": sum(1 for result in results if result.get("read")),
        "calls": meter.calls,
        "lost_tasks": engine.lost,
        "retried_pages": engine.retried,
        "assembly": counts,
    }


# ---------------------------------------------------------------------------
# The scenarios ADR-0151 quotes
# ---------------------------------------------------------------------------


def _fresh(delay: float):
    directory = Path(tempfile.mkdtemp(prefix="page-fan-out-bench-"))
    meter = Meter(delay)
    return directory, meter


def scenario_off(delay: float = MODEL_SECONDS) -> dict[str, Any]:
    directory, meter = _fresh(delay)
    path = mixed_pdf(directory)
    with harness(meter, directory) as ingestor:
        return run_off(ingestor, path, meter)


def scenario_on(delay: float = MODEL_SECONDS, page_slots: int = 16) -> dict[str, Any]:
    directory, meter = _fresh(delay)
    path = mixed_pdf(directory)
    with harness(meter, directory) as ingestor:
        return run_on(ingestor, path, meter, EmulatedEngine(page_slots))


def scenario_off_crash(delay: float = MODEL_SECONDS, after: int = 26) -> dict[str, Any]:
    """The worker dies after ``after`` page answers; the engine runs ``index`` again (the vision cache kept)."""
    directory, meter = _fresh(delay)
    path = mixed_pdf(directory)
    with harness(meter, directory) as ingestor:
        meter.kill_after = after
        first = run_off(ingestor, path, meter)
        calls_before = meter.calls
        time.sleep(delay + 0.5)  # the dead run's threads drain; none of them answers
        meter.dead = False
        meter.calls = 0
        meter.written_at = None
        retry = run_off(ingestor, path, meter)
        return {"first": first, "calls_before_crash": calls_before, "retry": retry}


def scenario_on_crash(delay: float = MODEL_SECONDS, after: int = 26, page_slots: int = 16) -> dict[str, Any]:
    """The page worker dies after ``after`` answers: only the tasks it held run again."""
    directory, meter = _fresh(delay)
    path = mixed_pdf(directory)
    with harness(meter, directory) as ingestor:
        meter.kill_after = after
        meter.kills_process = False
        return run_on(ingestor, path, meter, EmulatedEngine(page_slots))


def scenario_on_raise(delay: float = MODEL_SECONDS, page: int = 30, page_slots: int = 16) -> dict[str, Any]:
    """One page task raises once: it alone is tried again, after the engine's first backoff."""
    directory, meter = _fresh(delay)
    path = mixed_pdf(directory)
    with harness(meter, directory) as ingestor:
        meter.fail_once = {page}
        return run_on(ingestor, path, meter, EmulatedEngine(page_slots))


def main() -> None:
    import logging

    logging.basicConfig(level=logging.ERROR)
    report = {
        "off": scenario_off(),
        "on, 1 page worker (16 slots)": scenario_on(page_slots=16),
        "on, 2 page workers (32 slots)": scenario_on(page_slots=32),
        "off, worker killed after 26 page answers, then retried": scenario_off_crash(),
        "on, page worker killed after 26 page answers": scenario_on_crash(),
        "on, page 30 raises once": scenario_on_raise(),
    }
    json.dump(report, sys.stdout, indent=2, default=str)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
