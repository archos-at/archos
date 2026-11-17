from __future__ import annotations

from dataclasses import dataclass

PAPERS_MM: dict[str, tuple[float, float]] = {
    "A4": (297.0, 210.0),
    "A3": (420.0, 297.0),
    "A2": (594.0, 420.0),
    "A1": (841.0, 594.0),
    "A0": (1189.0, 841.0),
}

STANDARD_SCALES: tuple[int, ...] = (
    1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 25000,
)  # fmt: skip

FRAME_LEFT_MM = 20.0
FRAME_MM = 10.0
TITLE_BAND_MM = 30.0
DRAWING_INSET_MM = 3.0

WIDE_FRAME_MM = 300.0
NOTES_ROW_MM = 15.0

_SMALL_PAPERS = ("A4", "A3")
_SMALL_PAPER_COARSEST_SCALE = 2000
_LARGE_PAPERS = ("A2", "A1", "A0")


@dataclass(frozen=True)
class Sheet:
    paper: str
    page_mm: tuple[float, float]
    scale: int | None

    @property
    def frame_mm(self) -> tuple[float, float, float, float]:
        width, height = self.page_mm
        return FRAME_LEFT_MM, FRAME_MM, width - FRAME_MM, height - FRAME_MM

    @property
    def is_wide(self) -> bool:
        left, _bottom, right, _top = self.frame_mm
        return right - left >= WIDE_FRAME_MM

    @property
    def title_band_mm(self) -> float:
        return TITLE_BAND_MM if self.is_wide else TITLE_BAND_MM + NOTES_ROW_MM

    @property
    def drawing_box_mm(self) -> tuple[float, float, float, float]:
        left, bottom, right, top = self.frame_mm
        inset = DRAWING_INSET_MM
        return left + inset, bottom + self.title_band_mm + inset, right - inset, top - inset

    @property
    def drawing_area_mm(self) -> tuple[float, float]:
        left, bottom, right, top = self.drawing_box_mm
        return right - left, top - bottom


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
    if width_m is None or height_m is None or width_m <= 0 or height_m <= 0:
        return fitted_sheet(width_m or 1.0, height_m or 1.0)
    small_scales = tuple(scale for scale in STANDARD_SCALES if scale <= _SMALL_PAPER_COARSEST_SCALE)
    return (
        _first_fit(width_m, height_m, _SMALL_PAPERS, small_scales)
        or _first_fit(width_m, height_m, _LARGE_PAPERS, STANDARD_SCALES)
        or fitted_sheet(width_m, height_m)
    )


def fitted_sheet(width: float, height: float) -> Sheet:
    landscape, portrait = _orientations("A3")
    return Sheet("A3", landscape if width >= height else portrait, None)


def scale_bar_metres(scale: int) -> float:
    for metres in (
        0.01,
        0.02,
        0.05,
        0.1,
        0.2,
        0.25,
        0.5,
        1,
        2,
        4,
        5,
        8,
        10,
        20,
        25,
        40,
        50,
        100,
        200,
        250,
        400,
        500,
        1000,
    ):
        if 30.0 <= metres * 1000.0 / scale <= 45.0:
            return float(metres)
    return scale * 0.04  # 40 mm, for a scale outside the table
