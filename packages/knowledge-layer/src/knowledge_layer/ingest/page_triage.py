from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

logger = logging.getLogger(__name__)


class PageKind(StrEnum):
    TEXT = "text"
    SCAN = "scan"
    GARBLED = "garbled"
    DRAWING = "drawing"


TRANSCRIBED_KINDS = frozenset({PageKind.SCAN, PageKind.GARBLED})

_PAGEOBJ_PATH = 2
_PAGEOBJ_IMAGE = 3


_CID_TOKEN = re.compile(r"\(cid:\d+\)")
_MOJIBAKE = re.compile(r"Ã[\x80-\xbf¡-ÿ€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]|â€|Â[\xa0-\xbf]")

MIN_JUDGEABLE_CHARS = 40

MAX_CID_SHARE = 0.10
MAX_REPLACEMENT_SHARE = 0.02
MAX_MOJIBAKE_SHARE = 0.01
MIN_VOWEL_RATIO = 0.22
MIN_LETTERS_FOR_VOWELS = 100
_VOWELS = frozenset("aeiouyäöüAEIOUYÄÖÜ")


@dataclass(frozen=True)
class TextQuality:
    chars: int
    cid_share: float
    replacement_share: float
    mojibake_share: float
    vowel_ratio: float = 0.4
    letters: int = 0

    @property
    def garbled(self) -> bool:
        if self.chars < MIN_JUDGEABLE_CHARS:
            return False
        return (
            self.cid_share > MAX_CID_SHARE
            or self.replacement_share > MAX_REPLACEMENT_SHARE
            or self.mojibake_share > MAX_MOJIBAKE_SHARE
            or (self.letters >= MIN_LETTERS_FOR_VOWELS and self.vowel_ratio < MIN_VOWEL_RATIO)
        )


_SYMBOL_FONT_BULLETS = frozenset(
    "\uf020\uf02d\uf06c\uf06e\uf071\uf076\uf0a7\uf0a8\uf0b7\uf0d8\uf0e0\uf0e8\uf0f0\uf0fc\uf0fe"
)


def _is_private_use(ch: str) -> bool:
    return unicodedata.category(ch) == "Co"


def _is_replacement(ch: str) -> bool:
    if ch == "\ufffd":
        return True
    category = unicodedata.category(ch)
    return category in ("Co", "Cs") or (category == "Cc" and ch not in "\n\r\t")


def _without_bullets(text: str) -> str:
    lines = []
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped and _is_private_use(stripped[0]):
            stripped = stripped[1:]
        lines.append("".join(ch for ch in stripped if ch not in _SYMBOL_FONT_BULLETS))
    return "\n".join(lines)


def text_quality(text: str | None) -> TextQuality:
    body = "".join(_without_bullets(text or "").split())
    if not body:
        return TextQuality(0, 0.0, 0.0, 0.0)
    cid_tokens = len(_CID_TOKEN.findall(body))
    residue = _CID_TOKEN.sub("", body)
    glyphs = len(residue) + cid_tokens
    replacement = sum(1 for ch in residue if _is_replacement(ch))
    mojibake = len(_MOJIBAKE.findall(residue))
    letters = [ch for ch in residue if ch.isalpha()]
    vowels = sum(1 for ch in letters if ch in _VOWELS)
    return TextQuality(
        chars=glyphs,
        cid_share=cid_tokens / glyphs,
        replacement_share=replacement / glyphs,
        mojibake_share=mojibake / glyphs,
        vowel_ratio=vowels / len(letters) if letters else 0.4,
        letters=len(letters),
    )


def salvage_text(text: str | None) -> str:
    kept = _CID_TOKEN.sub("", text or "")
    return kept if len("".join(kept.split())) >= MIN_JUDGEABLE_CHARS else ""


MIN_SCAN_RASTER_COVERAGE = 0.5

MIN_SKETCH_PATHS = 20


@dataclass(frozen=True)
class PageSignals:
    page_number: int
    text: str
    path_count: int = 0
    raster_coverage: float = 0.0


def classify_page(signals: PageSignals, *, min_text_chars: int, min_paths: int) -> PageKind:
    quality = text_quality(signals.text)
    if quality.garbled:
        return PageKind.DRAWING if signals.path_count >= min_paths else PageKind.GARBLED
    if len(signals.text.strip()) >= min_text_chars:
        return PageKind.TEXT
    if signals.raster_coverage >= MIN_SCAN_RASTER_COVERAGE:
        return PageKind.SCAN
    if signals.path_count >= MIN_SKETCH_PATHS or signals.raster_coverage > 0:
        return PageKind.DRAWING
    return PageKind.TEXT


def _raster_coverage(page: Any, page_area: float) -> float:
    largest = 0.0
    for obj in page.get_objects():
        if obj.type != _PAGEOBJ_IMAGE:
            continue
        left, bottom, right, top = obj.get_bounds()
        largest = max(largest, max(0.0, right - left) * max(0.0, top - bottom))
    return min(1.0, largest / page_area) if page_area > 0 else 0.0


def _path_count(page: Any, ceiling: int) -> int:
    count = 0
    for obj in page.get_objects():
        if obj.type == _PAGEOBJ_PATH:
            count += 1
            if count >= ceiling:
                break
    return count


def _page_signals(page: Any, page_number: int, text: str, min_paths: int) -> PageSignals:
    width, height = page.get_size()
    return PageSignals(
        page_number=page_number,
        text=text,
        path_count=_path_count(page, max(1, min_paths)),
        raster_coverage=_raster_coverage(page, width * height),
    )


def _measure_page(doc: Any, index: int, text: str, min_paths: int) -> PageSignals:
    from knowledge_layer.ingest.pdfium_guard import pdfium_lock

    number = index + 1
    with pdfium_lock():
        try:
            page = doc[index]
        except Exception:  # noqa: BLE001 - one damaged page costs that page's signals
            return PageSignals(number, text)
        try:
            return _page_signals(page, number, text, min_paths)
        except Exception:  # noqa: BLE001
            return PageSignals(number, text)
        finally:
            page.close()


def _open_pdf(pdf_path: str) -> tuple[Any, int]:
    import pypdfium2 as pdfium

    from knowledge_layer.ingest.pdfium_guard import pdfium_lock

    with pdfium_lock():
        doc = pdfium.PdfDocument(pdf_path)
        try:
            return doc, len(doc)
        except Exception:
            doc.close()
            raise


def read_page_signals(pdf_path: str, page_texts: dict[int, str], *, min_paths: int) -> list[PageSignals] | None:
    from knowledge_layer.ingest.pdfium_guard import pdfium_lock

    try:
        doc, pages = _open_pdf(pdf_path)
    except Exception as exc:  # noqa: BLE001 - triage is advisory; text ingestion goes on
        logger.warning("Page triage unavailable for %s (%s: %s)", pdf_path, type(exc).__name__, exc)
        return None
    try:
        return [_measure_page(doc, index, page_texts.get(index + 1) or "", min_paths) for index in range(pages)]
    finally:
        with pdfium_lock():
            doc.close()


@dataclass(frozen=True)
class PdfTriage:
    kinds: dict[int, PageKind]

    def pages(self, *kinds: PageKind) -> list[int]:
        return [number for number, kind in self.kinds.items() if kind in kinds]

    @property
    def transcribed(self) -> list[int]:
        return self.pages(*TRANSCRIBED_KINDS)

    @property
    def drawings(self) -> list[int]:
        return self.pages(PageKind.DRAWING)


def triage_pdf(
    pdf_path: str,
    page_texts: dict[int, str],
    *,
    min_text_chars: int,
    min_paths: int,
) -> PdfTriage | None:
    signals = read_page_signals(pdf_path, page_texts, min_paths=min_paths)
    if signals is None:
        return None
    kinds = {s.page_number: classify_page(s, min_text_chars=min_text_chars, min_paths=min_paths) for s in signals}
    counts = {kind.value: sum(1 for k in kinds.values() if k is kind) for kind in PageKind}
    logger.info("Page triage for %s: %s", pdf_path, counts)
    return PdfTriage(kinds)
