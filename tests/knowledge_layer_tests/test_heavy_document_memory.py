from __future__ import annotations

import contextlib
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from knowledge_layer.ingest import limits
from knowledge_layer_testing import pdf_fixtures

_OVER_CAP_PAGES = 8

_OVER_CAP_RASTER_PX = (800, 600)

_BYTES_PER_PIXEL = 3


@dataclass
class _Decode:
    metadata: tuple[int, int]
    bitmap: tuple[int, int]


class _Tally:
    def __init__(self) -> None:
        self.decodes: list[_Decode] = []
        self.bitmaps_alive = 0
        self.peak_bitmaps_alive = 0
        self.held_bytes = 0
        self.peak_held_bytes = 0
        self._open_bitmap_bytes: dict[int, int] = {}
        self._detached_bytes: list[int] = []

    @property
    def sizes(self) -> list[tuple[int, int]]:
        return [decode.metadata for decode in self.decodes]

    def bitmap_opened(self, bitmap: Any) -> None:
        pixels = bitmap.width * bitmap.height * _BYTES_PER_PIXEL
        self._open_bitmap_bytes[id(bitmap)] = pixels
        self.bitmaps_alive += 1
        self.peak_bitmaps_alive = max(self.peak_bitmaps_alive, self.bitmaps_alive)
        self._hold(pixels)

    def bitmap_closed(self, bitmap: Any) -> None:
        self.bitmaps_alive -= 1
        self._release(self._open_bitmap_bytes.pop(id(bitmap), 0))

    def raster_detached(self, pixels: int) -> None:
        self._detached_bytes.append(pixels)
        self._hold(pixels)

    def raster_consumed(self) -> None:
        if self._detached_bytes:
            self._release(self._detached_bytes.pop(0))

    def _hold(self, pixels: int) -> None:
        self.held_bytes += pixels
        self.peak_held_bytes = max(self.peak_held_bytes, self.held_bytes)

    def _release(self, pixels: int) -> None:
        self.held_bytes -= pixels


@contextlib.contextmanager
def _counting_decodes(pdf_rasters: Any) -> Iterator[_Tally]:
    pdfium = pytest.importorskip("pypdfium2")
    tally = _Tally()
    real_get_bitmap = pdfium.PdfImage.get_bitmap
    real_close = pdfium.PdfBitmap.close
    real_detached_pil = pdf_rasters.detached_pil
    real_raster_record = pdf_rasters._raster_record

    def get_bitmap(self: Any, *args: Any, **kwargs: Any) -> Any:
        metadata = tuple(self.get_px_size())
        bitmap = real_get_bitmap(self, *args, **kwargs)
        tally.decodes.append(_Decode(metadata=metadata, bitmap=(bitmap.width, bitmap.height)))
        tally.bitmap_opened(bitmap)
        return bitmap

    def close(self: Any) -> Any:
        tally.bitmap_closed(self)
        return real_close(self)

    def detached_pil(bitmap: Any) -> Any:
        pixels = getattr(bitmap, "width", 0) * getattr(bitmap, "height", 0) * _BYTES_PER_PIXEL
        image = real_detached_pil(bitmap)
        tally.raster_detached(pixels)
        return image

    def raster_record(*args: Any, **kwargs: Any) -> Any:
        tally.raster_consumed()
        return real_raster_record(*args, **kwargs)

    pdfium.PdfImage.get_bitmap = get_bitmap
    pdfium.PdfBitmap.close = close
    pdf_rasters.detached_pil = detached_pil
    pdf_rasters._raster_record = raster_record
    try:
        yield tally
    finally:
        pdfium.PdfImage.get_bitmap = real_get_bitmap
        pdfium.PdfBitmap.close = real_close
        pdf_rasters.detached_pil = real_detached_pil
        pdf_rasters._raster_record = real_raster_record


@pytest.fixture(scope="module")
def pdf_rasters() -> Any:
    return pytest.importorskip("knowledge_layer.ingest.pdf_rasters")


@pytest.fixture(scope="module")
def heavy_plan_set(tmp_path_factory: pytest.TempPathFactory) -> Path:
    path = tmp_path_factory.mktemp("heavy-plan-set") / "plan-set.pdf"
    return pdf_fixtures.write_plan_set(path)


@pytest.fixture(scope="module")
def heavy_run(heavy_plan_set: Path, pdf_rasters: Any) -> tuple[list[dict[str, Any]], int, _Tally]:
    with _counting_decodes(pdf_rasters) as tally:
        kept, over_cap, _ = pdf_rasters._embedded_images_for_analysis(
            str(heavy_plan_set), rendered_pages=set(), enabled=True
        )
    return kept, over_cap, tally


@pytest.fixture
def over_cap_run(pdf_rasters: Any, tmp_path: Path) -> tuple[list[dict[str, Any]], int, _Tally]:
    path = pdf_fixtures.write_plan_set(
        tmp_path / "over-cap.pdf",
        raster_pages=limits.MAX_IMAGES_PER_DOCUMENT,
        rasters_per_page=1,
        raster_px=_OVER_CAP_RASTER_PX,
        small_raster_pages=_OVER_CAP_PAGES,
        include_undersized_raster=True,
    )
    with _counting_decodes(pdf_rasters) as tally:
        kept, over_cap, _ = pdf_rasters._embedded_images_for_analysis(str(path), rendered_pages=set(), enabled=True)
    return kept, over_cap, tally


def test_the_cap_and_the_icon_filter_bite_before_any_decode(over_cap_run: Any, pdf_rasters: Any) -> None:
    kept, over_cap, tally = over_cap_run
    candidates = limits.MAX_IMAGES_PER_DOCUMENT + _OVER_CAP_PAGES

    assert len(tally.decodes) == min(limits.MAX_IMAGES_PER_DOCUMENT, candidates)
    assert len(kept) == limits.MAX_IMAGES_PER_DOCUMENT
    assert over_cap == _OVER_CAP_PAGES

    decoded = set(tally.sizes)
    assert decoded == {_OVER_CAP_RASTER_PX}
    assert pdf_fixtures.PLAN_SET_SMALL_RASTER_PX not in decoded, "a raster the cap dropped was decoded"
    assert pdf_fixtures.PLAN_SET_UNDERSIZED_PX not in decoded, "a raster the icon filter dropped was decoded"


def test_px_size_agrees_with_the_decoded_bitmap(heavy_run: Any) -> None:
    _, _, tally = heavy_run

    assert tally.decodes, "the fixture produced no decodes to check"
    for decode in tally.decodes:
        assert decode.metadata == decode.bitmap, f"{decode.metadata} != {decode.bitmap}"
    assert pdf_fixtures.PLAN_SET_RASTER_PX in set(tally.sizes)


def test_a_full_resolution_raster_is_never_carried_past_its_decode(heavy_run: Any) -> None:
    _, _, tally = heavy_run
    one_raster_bytes = pdf_fixtures.PLAN_SET_RASTER_PX[0] * pdf_fixtures.PLAN_SET_RASTER_PX[1] * _BYTES_PER_PIXEL

    assert tally.decodes, "the fixture produced no decodes to check"
    assert tally.peak_bitmaps_alive == 1, "two full-resolution bitmaps were open at once"
    assert tally.bitmaps_alive == 0, "a full-resolution bitmap was left open"
    assert tally.peak_held_bytes <= one_raster_bytes, (
        f"the extraction held {tally.peak_held_bytes} bytes of full-resolution pixels, "
        f"more than one {one_raster_bytes}-byte raster: the peak grew with the sheet"
    )
