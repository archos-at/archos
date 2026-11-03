"""One file's page reads share one streaming pool (``page_reads``).

The transcriptions of a file's scans and the analyses of its drawings draw from
the same bounded pool, with no batch waiting for its slowest call, and come back
in page order. The drawings the triage knows are read while the scans are still
being transcribed, and the vision batch gets those calls rather than making them
again.
"""

from __future__ import annotations

import io
import threading
import time

import pytest
from knowledge_layer.llamaindex import adapter
from knowledge_layer.llamaindex import page_reads
from knowledge_layer.llamaindex import page_triage
from knowledge_layer.llamaindex import processing
from knowledge_layer.llamaindex import transcription
from knowledge_layer_testing.pdf_fixtures import build_drawing_sheets_pdf

VISION = {"vlm_model": "m", "vlm_base_url": "u", "vlm_api_key": "k"}


class _Meter:
    """Counts the calls in flight, and remembers which kinds ran at the same moment."""

    def __init__(self, delay: float) -> None:
        self.delay = delay
        self.lock = threading.Lock()
        self.now: dict[str, int] = {"ocr": 0, "vision": 0}
        self.peak = 0
        self.calls: list[str] = []
        self.overlapped = False

    def call(self, kind: str) -> None:
        with self.lock:
            self.now[kind] += 1
            self.calls.append(kind)
            self.peak = max(self.peak, sum(self.now.values()))
            self.overlapped = self.overlapped or (self.now["ocr"] > 0 and self.now["vision"] > 0)
        time.sleep(self.delay)
        with self.lock:
            self.now[kind] -= 1


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


def _mixed_pdf(tmp_path, *, sheets: int, scans: int) -> str:
    import pypdfium2 as pdfium

    out = pdfium.PdfDocument.new()
    for data in (build_drawing_sheets_pdf(sheets, 400), _scan_pdf(scans)):
        out.import_pages(pdfium.PdfDocument(data))
    path = tmp_path / "mixed.pdf"
    out.save(str(path))
    return str(path)


@pytest.fixture
def meter(monkeypatch):
    meter = _Meter(delay=0.05)
    monkeypatch.setattr(processing, "get_json", lambda key: None)
    monkeypatch.setattr(processing, "set_json", lambda *a, **k: None)

    def drawing(image_bytes, **kwargs):
        meter.call("vision")
        return ("Grundriss", {"analysis": {"page_kind": "drawing"}, "drawing_type": "Grundriss"})

    def transcribe(image_bytes, **kwargs):
        meter.call("ocr")
        return "# Bescheid\n" + "Auflage " * 40

    monkeypatch.setattr(adapter, "_analyze_drawing_page_with_vlm", drawing)
    monkeypatch.setattr(transcription, "_transcribe_live", transcribe)
    return meter


def _read_pages(path: str, parallelism: int):
    """The adapter's sequence: read the triage's drawings ahead, transcribe, render, analyse."""
    text_pages = adapter._extract_text_from_pdf(path)
    page_texts = adapter.page_texts_for_visual_heuristic(text_pages)
    triage = page_triage.triage_pdf(path, page_texts, min_text_chars=200, min_paths=300)
    with page_reads.file_page_reads(parallelism) as reads:
        reads.read_drawings_ahead(triage, path, cap=20, max_dim=1024, vision={**VISION, "extract_charts": True})
        routes = transcription.route_pdf_pages(
            path,
            text_pages,
            page_texts,
            vlm_api_key="k",
            model="m",
            base_url="u",
            min_text_chars=200,
            min_paths=300,
            max_ocr_pages=500,
            max_dim=1024,
            triage=triage,
        )
        raw = processing.render_visual_pages_no_vlm(
            path, max_pages=20, max_dim=1024, page_texts=page_texts, only_pages=routes.drawing_pages
        )
        _images, drawings = processing.enrich_vlm_batch([], raw, **VISION)
    return text_pages, routes, drawings


def test_scans_and_drawings_are_read_at_once_within_the_pool_bound(tmp_path, meter):
    path = _mixed_pdf(tmp_path, sheets=4, scans=12)

    text_pages, routes, drawings = _read_pages(path, parallelism=4)

    assert meter.overlapped, "a drawing page and a scan page must be in flight together"
    assert meter.peak <= 4
    assert sorted(routes.outcome.texts) == list(range(5, 17))
    assert [page["page_number"] for page in drawings] == [1, 2, 3, 4]
    # Each page is read once: the batch got the calls made ahead of it.
    assert meter.calls.count("vision") == 4 and meter.calls.count("ocr") == 12
    assert [page["page_number"] for page in text_pages][-12:] == list(range(5, 17))


def test_results_come_back_in_page_order_whatever_order_the_calls_finish(tmp_path, monkeypatch):
    path = tmp_path / "scan.pdf"
    path.write_bytes(_scan_pdf(8))
    monkeypatch.setattr(processing, "get_json", lambda key: None)
    monkeypatch.setattr(processing, "set_json", lambda *a, **k: None)
    replies = iter(range(8, 0, -1))
    lock = threading.Lock()

    def live(image_bytes, **kwargs):
        with lock:
            delay = next(replies)
        time.sleep(delay * 0.01)  # the first page answers last
        return f"Seite mit Verzögerung {delay}"

    monkeypatch.setattr(transcription, "_transcribe_live", live)

    outcome = transcription.transcribe_pdf_pages(
        str(path), list(range(1, 9)), model="m", base_url="u", api_key="k", max_pages=8, max_dim=400, workers=8
    )

    assert list(outcome.texts) == list(range(1, 9))


def test_a_stream_holds_at_most_twice_the_pool_in_rendered_pages(tmp_path, monkeypatch):
    path = tmp_path / "scan.pdf"
    path.write_bytes(_scan_pdf(12))
    monkeypatch.setattr(processing, "get_json", lambda key: None)
    monkeypatch.setattr(processing, "set_json", lambda *a, **k: None)
    held = {"now": 0, "peak": 0}
    lock = threading.Lock()
    render = processing._render_numbered_page

    def counted_render(*args, **kwargs):
        with lock:
            held["now"] += 1
            held["peak"] = max(held["peak"], held["now"])
        return render(*args, **kwargs)

    def live(image_bytes, **kwargs):
        time.sleep(0.02)
        with lock:
            held["now"] -= 1
        return "Text der Seite"

    monkeypatch.setattr(processing, "_render_numbered_page", counted_render)
    monkeypatch.setattr(transcription, "_transcribe_live", live)

    transcription.transcribe_pdf_pages(
        str(path), list(range(1, 13)), model="m", base_url="u", api_key="k", max_pages=12, max_dim=400, workers=2
    )

    assert held["peak"] <= 4


def test_a_second_caller_waits_for_the_first_and_a_failure_is_asked_again():
    reads = page_reads.FilePageReads(2)
    started = threading.Event()
    release = threading.Event()
    calls: list[int] = []

    def slow():
        calls.append(1)
        started.set()
        release.wait(2)
        return {"caption": "ok"}

    first = reads.submit(reads.single_flight, "k", slow, lambda result: False)
    started.wait(2)
    second = reads.submit(reads.single_flight, "k", slow, lambda result: False)
    release.set()
    assert first.result(2) == second.result(2) == {"caption": "ok"}
    assert first.result() is not second.result(), "each caller gets its own copy"
    assert len(calls) == 1

    reads.single_flight("f", lambda: "[Drawing - analysis failed]", lambda result: True)
    assert reads.single_flight("f", lambda: "again", lambda result: False) == "again"
    reads.close()
