"""Which paper, which way round and which standard scale a drawing goes on (ADR-0152).

A rendition that is "fit to page" is what an online converter hands out, and an
architect cannot measure on it. So a drawing whose unit is known is placed at a
STANDARD scale on a standard sheet, the most detailed scale first and the
smaller sheet first: a Kataster extract of 150 × 100 m lands on A3 at 1:500, a
40 × 30 m parcel on A4 at 1:200. A4 and A3 are tried up to 1:2000 before a
larger sheet is, because those are what an office prints and attaches; A2 to A0
take what does not fit them. Only a drawing too large for A0 at 1:25000, or one
that names no unit, is fitted, and the page then says it is not to scale.

Pure: no ezdxf, no matplotlib, so it is tested on numbers alone.
"""

from __future__ import annotations

from dataclasses import dataclass

#: ISO 216 sheets, landscape, in millimetres.
PAPERS_MM: dict[str, tuple[float, float]] = {
    "A4": (297.0, 210.0),
    "A3": (420.0, 297.0),
    "A2": (594.0, 420.0),
    "A1": (841.0, 594.0),
    "A0": (1189.0, 841.0),
}

#: Standard scale denominators, most detailed first.
STANDARD_SCALES: tuple[int, ...] = (
    1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 25000,
)  # fmt: skip

#: Margin on every side, and the band at the foot that holds the title block.
MARGIN_MM = 10.0
TITLE_BAND_MM = 24.0

#: The sheets an office prints and attaches, and the coarsest scale tried on them
#: before a larger sheet is.
_SMALL_PAPERS = ("A4", "A3")
_SMALL_PAPER_COARSEST_SCALE = 2000
_LARGE_PAPERS = ("A2", "A1", "A0")


@dataclass(frozen=True)
class Sheet:
    """A page and how the drawing sits on it."""

    paper: str
    page_mm: tuple[float, float]
    #: The denominator of 1:n, or ``None`` when the drawing is fitted, not scaled.
    scale: int | None

    @property
    def drawing_area_mm(self) -> tuple[float, float]:
        """Width and height left for the drawing, inside the margins, above the title band."""
        width, height = self.page_mm
        return width - 2 * MARGIN_MM, height - 2 * MARGIN_MM - TITLE_BAND_MM


def _orientations(paper: str) -> tuple[tuple[float, float], tuple[float, float]]:
    width, height = PAPERS_MM[paper]
    return (width, height), (height, width)


def _fits(page_mm: tuple[float, float], size_mm: tuple[float, float]) -> bool:
    area = Sheet("", page_mm, None).drawing_area_mm
    return size_mm[0] <= area[0] and size_mm[1] <= area[1]


def _first_fit(width_m: float, height_m: float, papers: tuple[str, ...], scales: tuple[int, ...]) -> Sheet | None:
    for scale in scales:
        size_mm = (width_m * 1000.0 / scale, height_m * 1000.0 / scale)
        for paper in papers:
            for page_mm in _orientations(paper):
                if _fits(page_mm, size_mm):
                    return Sheet(paper, page_mm, scale)
    return None


def choose_sheet(width_m: float | None, height_m: float | None) -> Sheet:
    """The sheet for a drawing of this real size, or a fitted A3 when its size is unknown."""
    if width_m is None or height_m is None or width_m <= 0 or height_m <= 0:
        return fitted_sheet(width_m or 1.0, height_m or 1.0)
    small_scales = tuple(scale for scale in STANDARD_SCALES if scale <= _SMALL_PAPER_COARSEST_SCALE)
    return (
        _first_fit(width_m, height_m, _SMALL_PAPERS, small_scales)
        or _first_fit(width_m, height_m, _LARGE_PAPERS, STANDARD_SCALES)
        or fitted_sheet(width_m, height_m)
    )


def fitted_sheet(width: float, height: float) -> Sheet:
    """A3 the way round the drawing's proportions suit, not to scale."""
    landscape, portrait = _orientations("A3")
    return Sheet("A3", landscape if width >= height else portrait, None)


def scale_bar_metres(scale: int) -> float:
    """A round length whose bar is between 25 and 60 mm long on paper at this scale."""
    for metres in (0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000):
        if 25.0 <= metres * 1000.0 / scale <= 60.0:
            return float(metres)
    return scale * 0.05  # 50 mm, for a scale outside the table
