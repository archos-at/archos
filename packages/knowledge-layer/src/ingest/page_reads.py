from __future__ import annotations

import contextlib
import contextvars
import copy
import logging
import threading
from collections.abc import Callable
from collections.abc import Iterator
from concurrent.futures import Future
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from knowledge_layer.env import env_int

logger = logging.getLogger(__name__)

INGEST_PAGE_READ_PARALLELISM = env_int("INGEST_PAGE_READ_PARALLELISM", 16, minimum=1)

_CURRENT: contextvars.ContextVar[FilePageReads | None] = contextvars.ContextVar("file_page_reads", default=None)


class FilePageReads:

    def __init__(self, parallelism: int | None = None) -> None:
        self.parallelism = max(1, parallelism or INGEST_PAGE_READ_PARALLELISM)
        self._executor = ThreadPoolExecutor(max_workers=self.parallelism, thread_name_prefix="page-read")
        self._room = threading.BoundedSemaphore(self.parallelism * 2)
        self._lock = threading.Lock()
        self._calls: dict[str, Future] = {}
        self.renders: dict[int, dict[str, Any]] = {}

    def submit(self, fn: Callable[..., Any], /, *args: Any, **kwargs: Any) -> Future:
        return self._executor.submit(contextvars.copy_context().run, fn, *args, **kwargs)

    @contextlib.contextmanager
    def room(self) -> Iterator[Callable[[Future], None]]:
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
        with self._lock:
            pending = self._calls.get(key)
            if pending is None:
                pending = self._calls[key] = Future()
                owner = True
            else:
                owner = False
        if not owner:
            return copy.deepcopy(pending.result())
        try:
            result = live()
        except BaseException as exc:
            with self._lock:
                self._calls.pop(key, None)
            pending.set_exception(exc)
            raise
        if failed(result):
            with self._lock:
                self._calls.pop(key, None)
        pending.set_result(result)
        return result

    def read_drawings_ahead(
        self, triage: Any, pdf_path: str, *, cap: int, max_dim: int, vision: dict[str, Any]
    ) -> None:
        pages = sorted(getattr(triage, "drawings", None) or ())[: max(0, cap)]
        if pages:
            self.submit(self._prefetch, pdf_path, pages, max_dim, vision)

    def _prefetch(self, pdf_path: str, pages: list[int], max_dim: int, vision: dict[str, Any]) -> None:
        from knowledge_layer.ingest import adapter as _adapter
        from knowledge_layer.ingest import processing as _processing

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
        with self._lock:
            return dict(self.renders)

    def close(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)


def current() -> FilePageReads | None:
    return _CURRENT.get()


@contextlib.contextmanager
def file_page_reads(parallelism: int | None = None) -> Iterator[FilePageReads]:
    reads = FilePageReads(parallelism)
    token = _CURRENT.set(reads)
    try:
        yield reads
    finally:
        _CURRENT.reset(token)
        reads.close()


@contextlib.contextmanager
def pool_for_this_call(parallelism: int | None = None) -> Iterator[FilePageReads]:
    reads = current()
    if reads is not None:
        yield reads
        return
    with file_page_reads(parallelism) as private:
        yield private


def ordered_results(futures: list[tuple[int, Future]]) -> list[tuple[int, Any]]:
    out: list[tuple[int, Any]] = []
    for number, future in sorted(futures, key=lambda item: item[0]):
        try:
            out.append((number, future.result()))
        except Exception as exc:  # noqa: BLE001 - the caller decides what a failed page costs
            out.append((number, exc))
    return out
