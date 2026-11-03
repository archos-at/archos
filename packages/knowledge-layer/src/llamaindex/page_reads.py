"""One file's page reads: a single bounded pool that OCR and vision share.

A file's scanned pages (transcription) and its drawings, images and embedded
rasters (visual analysis) are each one model call. They used to run in two
phases, one after the other, each on its own pool of ``VLM_BATCH_WORKERS``
(4) threads, and the OCR phase in batches of eight that waited for their
slowest call. Measured on 2026-11-02: a 458 s file made 115 vision calls
summing 1,219 s, an effective parallelism of 2.7, while the fleet's vision pool
had 25 of its 32 slots free.

Now every page read of one file draws from one pool of
``INGEST_PAGE_READ_PARALLELISM`` threads, opened for the file by
:func:`file_page_reads` and found by the readers through a context variable:

* **Streaming, no barriers.** A page is submitted as soon as it is rendered,
  and the pool takes the next as soon as a thread is free. At most twice the
  pool's size of rendered pages wait or run at once (:meth:`FilePageReads.room`),
  so a 500-page scan never holds 500 JPEGs.
* **OCR and vision at once.** The drawings the triage already knows are
  rendered and read on the pool (:meth:`FilePageReads.prefetch_drawings`)
  while the scans are transcribed. The later vision batch asks for the same
  bytes and gets the call already made (:meth:`FilePageReads.single_flight`),
  so the answer is the one the serial order would have given.
* **The fleet pool is the hard cap.** Every call still holds one of the
  ``VLM_FLEET_CONCURRENCY`` slots (``vision_calls._vlm_slot``), shared fairly
  between offices. This pool bounds one file's threads and memory, not the
  calls the provider sees.
* **Answers read elsewhere.** On the page fan-out (``INGEST_PAGE_FAN_OUT``,
  ``read_page``) each page is read by a task of its own before the file is
  assembled; :func:`answers_read_elsewhere` hands those answers, keyed as the
  vision cache keys them, to the file's pool, and a call for one of them is
  answered from it without a model call. An answer stored as failed stays
  failed: its page was already tried, and the second vision pass skips it.
"""

from __future__ import annotations

import contextlib
import contextvars
import copy
import hashlib
import logging
import threading
from collections.abc import Callable
from collections.abc import Iterator
from concurrent.futures import Future
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from .env import env_int

logger = logging.getLogger(__name__)

# @environment_variable INGEST_PAGE_READ_PARALLELISM
# @category Knowledge Layer
# @type int
# @default 16
# @required false
# Threads one file's page reads share: its scan transcriptions and its drawing,
# image and raster analyses, streamed through one pool. The fleet's vision pool
# (`VLM_FLEET_CONCURRENCY`) stays the cap on calls in flight; this bounds a
# file's threads and the rendered pages it holds (twice this many at most).
INGEST_PAGE_READ_PARALLELISM = env_int("INGEST_PAGE_READ_PARALLELISM", 16, minimum=1)

_CURRENT: contextvars.ContextVar[FilePageReads | None] = contextvars.ContextVar("file_page_reads", default=None)
#: Answers a page task already got for this file (``answers_read_elsewhere``), keyed by vision-cache key.
_READ_ELSEWHERE: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar(
    "page_reads_read_elsewhere", default=None
)


class FilePageReads:
    """The pool, the rendered-page budget and the in-flight calls of one file."""

    def __init__(self, parallelism: int | None = None) -> None:
        self.parallelism = max(1, parallelism or INGEST_PAGE_READ_PARALLELISM)
        self._executor = ThreadPoolExecutor(max_workers=self.parallelism, thread_name_prefix="page-read")
        self._room = threading.BoundedSemaphore(self.parallelism * 2)
        self._lock = threading.Lock()
        self._calls: dict[str, Future] = {}
        self.renders: dict[int, dict[str, Any]] = {}
        #: Every answer a call got, failures included, by key: what a page task stores.
        self.answers: dict[str, Any] = {}
        #: Answers read before this pool opened (``answers_read_elsewhere``); consulted before the model.
        self.read_elsewhere: dict[str, Any] = dict(_READ_ELSEWHERE.get() or {})
        #: Keys answered from ``read_elsewhere`` with a failure: tried already, never tried again here.
        self._settled_failures: set[str] = set()

    def submit(self, fn: Callable[..., Any], /, *args: Any, **kwargs: Any) -> Future:
        """``fn`` on the pool, in a copy of the caller's context (data policy, cost ledger, file trace)."""
        return self._executor.submit(contextvars.copy_context().run, fn, *args, **kwargs)

    @contextlib.contextmanager
    def room(self) -> Iterator[Callable[[Future], None]]:
        """Wait for room for one more rendered page; yields the callback that gives it back.

        The caller renders inside the block and hands the callback to its
        future (``add_done_callback``). A block left without a future gives
        the room back itself.
        """
        self._room.acquire()
        handed = threading.Event()

        def release(_future: Future | None = None) -> None:
            self._room.release()

        def hand(future: Future) -> None:
            handed.set()
            future.add_done_callback(release)

        try:
            yield hand
        finally:
            if not handed.is_set():
                release()

    def single_flight(self, key: str, live: Callable[[], Any], failed: Callable[[Any], bool]) -> Any:
        """``live()`` once per ``key`` for this file; a second caller waits for the first's result.

        A failed result is forgotten, so the batch's second pass asks again.
        """
        with self._lock:
            pending = self._calls.get(key)
            if pending is None:
                pending = self._calls[key] = Future()
                owner = True
            else:
                owner = False
        if not owner:
            # A copy: the two callers attach the result to two records.
            return copy.deepcopy(pending.result())
        try:
            result = self._answer(key, live, failed)
        except BaseException as exc:
            with self._lock:
                self._calls.pop(key, None)
            pending.set_exception(exc)
            raise
        with self._lock:
            self.answers[key] = result
        if failed(result) and key not in self._settled_failures:
            with self._lock:
                self._calls.pop(key, None)
        pending.set_result(result)
        return result

    def _answer(self, key: str, live: Callable[[], Any], failed: Callable[[Any], bool]) -> Any:
        """The answer a page task stored for ``key``, else ``live()``."""
        if key not in self.read_elsewhere:
            return live()
        result = copy.deepcopy(self.read_elsewhere[key])
        if failed(result):
            with self._lock:
                self._settled_failures.add(key)
        return result

    def settled_image(self, image_bytes: bytes) -> bool:
        """Whether a read of these bytes failed in a page task that spent its retries: no second pass asks again.

        A vision-cache key ends in the bytes' SHA-256 (``processing.vlm_cache_key``).
        """
        digest = hashlib.sha256(image_bytes).hexdigest()
        with self._lock:
            return any(key.rsplit(":", 1)[-1] == digest for key in self._settled_failures)

    def read_drawings_ahead(
        self, triage: Any, pdf_path: str, *, cap: int, max_dim: int, vision: dict[str, Any]
    ) -> None:
        """Render the triage's first ``cap`` drawing pages and start reading each, on the pool.

        The caller goes on to transcribe the scans meanwhile. What is rendered
        is kept in :attr:`renders`, so the vision batch's renderer does not
        render it again, and its call is the one :meth:`single_flight` hands
        the batch. ``triage`` ``None`` (an unmeasured PDF) reads nothing ahead.
        """
        pages = sorted(getattr(triage, "drawings", None) or ())[: max(0, cap)]
        if pages:
            self.submit(self._prefetch, pdf_path, pages, max_dim, vision)

    def _prefetch(self, pdf_path: str, pages: list[int], max_dim: int, vision: dict[str, Any]) -> None:
        from knowledge_layer.llamaindex import adapter as _adapter
        from knowledge_layer.llamaindex import processing as _processing

        doc = _processing._open_pdf(pdf_path, "Drawing prefetch")
        if doc is None:
            return
        try:
            for number in pages:
                image = _processing._render_numbered_page(doc, number, max_dim, pdf_path)
                if image is None:
                    continue
                image_bytes, width, height = _processing._encode_jpeg(image)
                with self._lock:
                    self.renders[number] = {
                        "image_bytes": image_bytes,
                        "width": width,
                        "height": height,
                        "max_dim": max_dim,
                    }
                self.submit(_adapter.analyze_visual, image_bytes, **vision)
        finally:
            _processing._close_pdf(doc)

    def rendered(self) -> dict[int, dict[str, Any]]:
        """A copy of the pages rendered ahead so far."""
        with self._lock:
            return dict(self.renders)

    def close(self) -> None:
        """Cancel what has not started; a call already running finishes on its own thread."""
        self._executor.shutdown(wait=False, cancel_futures=True)


def current() -> FilePageReads | None:
    """The file's page reads, inside :func:`file_page_reads`; ``None`` outside one."""
    return _CURRENT.get()


@contextlib.contextmanager
def file_page_reads(parallelism: int | None = None) -> Iterator[FilePageReads]:
    """Open one file's page-read pool for the block; every reader inside it shares it."""
    reads = FilePageReads(parallelism)
    token = _CURRENT.set(reads)
    try:
        yield reads
    finally:
        _CURRENT.reset(token)
        reads.close()


@contextlib.contextmanager
def pool_for_this_call(parallelism: int | None = None) -> Iterator[FilePageReads]:
    """The file's pool when one is open, else a private one of ``parallelism`` closed with the block."""
    reads = current()
    if reads is not None:
        yield reads
        return
    with file_page_reads(parallelism) as private:
        yield private


@contextlib.contextmanager
def answers_read_elsewhere(answers: dict[str, Any]) -> Iterator[None]:
    """Inside the block, every file pool opened starts with ``answers`` (the page tasks' reads, by key)."""
    token = _READ_ELSEWHERE.set(dict(answers))
    try:
        yield
    finally:
        _READ_ELSEWHERE.reset(token)


def ordered_results(futures: list[tuple[int, Future]]) -> list[tuple[int, Any]]:
    """``(page, result or exception)`` in page order, whatever order the calls finished in."""
    out: list[tuple[int, Any]] = []
    for number, future in sorted(futures, key=lambda item: item[0]):
        try:
            out.append((number, future.result()))
        except Exception as exc:  # noqa: BLE001 - the caller decides what a failed page costs
            out.append((number, exc))
    return out
