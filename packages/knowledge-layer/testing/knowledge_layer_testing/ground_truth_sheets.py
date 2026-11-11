"""The ground-truth set: drawing sheets written at known dimensions, each with the true value of every probe.

The measuring engine is held to one rule on this set (the build
specification's release gate): no answer states a number whose true value lies
outside its stated interval. „No number“ always passes. So the set is built
from what makes a sheet say something false about itself, beside what every
sheet carries (wall hatching, a door swing, furniture, dimension chains):

* two views at different scales on one sheet, each in its own stored region,
  or under one printed scale note, or one of them without a dimension;
* a view turned on a turned page; a sheet dimensioned in centimetres;
* a printed scale note that is wrong, a stored region that is wrong;
* a sheet plotted again at another paper size with its viewports intact;
* dimension labels rounded to the centimetre or the half centimetre over spans
  drawn to the millimetre, equal bays whose labels all round the same way on a
  sheet plotted at 99.2 %, and a sheet with two dimensions and no more.

``hint_is_true`` says whether what the sheet states about its scale is how it
is drawn. These sheets measure the ENGINE, not anybody's drafting: what they
show about a constant holds for these sheets.
"""

from __future__ import annotations

import random
from collections.abc import Callable
from dataclasses import dataclass
from dataclasses import field
from dataclasses import replace
from typing import Any

from knowledge_layer_testing.ground_truth_views import FloorView
from knowledge_layer_testing.ground_truth_views import Truth
from knowledge_layer_testing.sheet_fixtures import A1_LANDSCAPE
from knowledge_layer_testing.sheet_fixtures import SheetPage

Box = tuple[float, float, float, float]

#: Where the first view's outer corner sits on an A1 page, and where a second view beside it does.
FIRST = (300.0, 900.0)
SECOND = (1250.0, 900.0)
#: Sizes drawn to the millimetre, with the wall thicknesses masonry really has: 36.5 and 11.5 cm.
MILLIMETRE_SIZE: dict[str, Any] = {"size": (9.764, 6.238, 4.317), "wall": 0.365, "partition": 0.115}


@dataclass(frozen=True)
class TruthRegion:
    """One view of a sheet: its box on the page as shown (points), its true scale, and a reference a person
    calibrating it would click (the longest dimension, in points)."""

    box: Box
    metres_per_point: float
    reference_pt: float


@dataclass
class TruthSheet:
    """A sheet of the set: the page, its views, the probes with their true values, and what it is here for."""

    name: str
    carries: str
    page: SheetPage
    hint_is_true: bool
    regions: list[TruthRegion] = field(default_factory=list)
    truths: list[Truth] = field(default_factory=list)
    views: list[FloorView] = field(default_factory=list)

    def add(self, **options: Any) -> FloorView:
        """Draw one more view on the page and take its probes."""
        view = FloorView(self.page, **options)
        view.draw()
        self.truths += view.truths(f"{self.name}/view{len(self.views) + 1}", len(self.regions))
        self.regions.append(TruthRegion(view.shown_box(), view.metres_per_point, view.size[0] / view.metres_per_point))
        self.views.append(view)
        return view

    def note(self, scale: int, at: tuple[float, float] = (1900.0, 120.0)) -> None:
        self.page.text(*at, f"M 1:{scale}", size=14)

    def across_views(self) -> None:
        """Probes from the first view into the second: they have no true value, and none may be stated."""
        first, second = self.views[0], self.views[1]
        ends = (first.share(first.size[0], 0.0), second.share(0.0, 0.0))
        why = "the probe runs from one view into another"
        self.truths.append(Truth(f"{self.name}/across/distance", "distance", ends, 0.0, 0, why))
        inside = (first.share(first.size[0] - 1.0, 2.0), second.share(1.0, 2.0))
        self.truths.append(Truth(f"{self.name}/across/clearance", "clearance", inside, 0.0, 0, why))


def _sheet(name: str, carries: str, hint_is_true: bool = True, rotate: int = 0) -> TruthSheet:
    return TruthSheet(name, carries, SheetPage(media_box=(0.0, 0.0, *A1_LANDSCAPE), rotate=rotate), hint_is_true)


def stored_region() -> TruthSheet:
    sheet = _sheet("stored_region", "hatched walls, a door swing, furniture, chains, a stored region at 1:100")
    sheet.add(origin=FIRST, drawn_scale=100, stored_scale=100)
    sheet.note(100)
    return sheet


def note_only() -> TruthSheet:
    sheet = _sheet("note_only", "a printed scale note 1:50 and no stored region, walls not hatched")
    sheet.add(origin=FIRST, drawn_scale=50, hatching=False)
    sheet.note(50)
    return sheet


def two_regions() -> TruthSheet:
    sheet = _sheet("two_regions", "two views, 1:100 and 1:50, each in its own stored region")
    sheet.add(origin=FIRST, drawn_scale=100, stored_scale=100)
    sheet.add(origin=SECOND, drawn_scale=50, stored_scale=50, size=(6.0, 4.4, 2.8))
    sheet.across_views()
    return sheet


def two_views_one_note() -> TruthSheet:
    sheet = _sheet("two_views_one_note", "a 1:100 view and a dimensioned 1:50 view under one note 1:100", False)
    sheet.add(origin=FIRST, drawn_scale=100)
    sheet.add(origin=SECOND, drawn_scale=50, size=(6.0, 4.4, 2.8))
    sheet.note(100)
    sheet.across_views()
    return sheet


def undimensioned_detail() -> TruthSheet:
    sheet = _sheet("undimensioned_detail", "a 1:50 view WITHOUT dimensions between two 1:100 views, one note", False)
    sheet.add(origin=FIRST, drawn_scale=100)
    sheet.add(origin=(1500.0, 900.0), drawn_scale=100)
    # Between the two: inside the extent their agreeing dimensions span, with no figure of its own.
    sheet.add(origin=(720.0, 900.0), drawn_scale=50, size=(3.0, 2.4, 1.4), dimensioned=False, hatching=False)
    sheet.note(100)
    return sheet


def rotated_view() -> TruthSheet:
    sheet = _sheet("rotated_view", "a view turned by 25 degrees on a page turned by 90, note 1:100", rotate=90)
    sheet.add(origin=(700.0, 500.0), drawn_scale=100, angle=25.0)
    sheet.note(100)
    return sheet


def centimetres() -> TruthSheet:
    sheet = _sheet("centimetres", "figures in centimetres with a raised half, a stored region in cm, 1:50")
    sheet.add(origin=FIRST, drawn_scale=50, stored_scale=50, stored_unit="cm", labels="centimetres", wall=0.365)
    return sheet


def centimetres_whole() -> TruthSheet:
    sheet = _sheet("centimetres_whole", "figures in whole centimetres only: cm and mm cannot be told apart")
    sheet.add(origin=FIRST, drawn_scale=50, labels="whole")
    sheet.note(50)
    return sheet


def wrong_note() -> TruthSheet:
    sheet = _sheet("wrong_note", "drawn at 1:50 under a printed note 1:100", False)
    sheet.add(origin=FIRST, drawn_scale=50)
    sheet.note(100)
    return sheet


def wrong_stored_region() -> TruthSheet:
    sheet = _sheet("wrong_stored_region", "a stored region that says 1:100 over a view drawn at 1:98", False)
    sheet.add(origin=FIRST, drawn_scale=98, stored_scale=100)
    return sheet


def replotted(name: str = "replotted_a2", factor: float = 0.7071) -> TruthSheet:
    """Everything drawn at ``factor`` of its size while the stored region and the note still say 1:100."""
    sheet = _sheet(name, f"plotted again at {factor:g} of its size, the stored region and the note intact", False)
    sheet.add(origin=FIRST, drawn_scale=100 / factor, stored_scale=100)
    sheet.note(100)
    return sheet


def replotted_to_fit() -> TruthSheet:
    return replotted("replotted_to_fit", 0.97)


def print_rounded() -> TruthSheet:
    sheet = _sheet("print_rounded", "spans drawn to the millimetre, labels rounded to the centimetre, 1:100")
    sheet.add(origin=FIRST, drawn_scale=100, labels="rounded", **MILLIMETRE_SIZE)
    sheet.note(100)
    return sheet


def print_rounded_long() -> TruthSheet:
    sheet = _sheet("print_rounded_long", "rounded labels over spans of a metre and more only, 1:100")
    sheet.add(origin=FIRST, drawn_scale=100, labels="rounded", size=(9.764, 6.238, 4.317), wall=1.004, partition=1.003)
    sheet.note(100)
    return sheet


def half_centimetre_labels() -> TruthSheet:
    sheet = _sheet(
        "half_centimetre_labels", "millimetre spans labelled to the half centimetre (a raised 5), a wrong note", False
    )
    sheet.add(origin=FIRST, drawn_scale=50, **MILLIMETRE_SIZE)
    sheet.note(100)
    return sheet


def equal_bays_to_fit() -> TruthSheet:
    """Thirteen equal bays of 1.254 m, all printed „1,25“, plotted at 99.2 % under a note that still says 1:100."""
    sheet = _sheet(
        "equal_bays_to_fit", "equal bays with labels rounded the same way, plotted at 99.2 % of the note's 1:100", False
    )
    sheet.add(origin=FIRST, drawn_scale=100 / 0.992, labels="rounded", size=(10.032, 6.27, 4.3), bays=(8, 5))
    sheet.note(100)
    return sheet


def two_dimensions_only() -> TruthSheet:
    sheet = _sheet("two_dimensions_only", "one dimension along each side and no other: too few to corroborate")
    sheet.add(origin=FIRST, drawn_scale=100, bays=(1, 1), overall=False, hatching=False)
    sheet.note(100)
    return sheet


BUILDERS: tuple[Callable[[], TruthSheet], ...] = (
    stored_region,
    note_only,
    two_regions,
    two_views_one_note,
    undimensioned_detail,
    rotated_view,
    centimetres,
    centimetres_whole,
    wrong_note,
    wrong_stored_region,
    replotted,
    replotted_to_fit,
    print_rounded,
    print_rounded_long,
    half_centimetre_labels,
    equal_bays_to_fit,
    two_dimensions_only,
)


def ground_truth_set() -> list[TruthSheet]:
    """Every sheet of the set, drawn."""
    return [build() for build in BUILDERS]


def jittered(sheet: TruthSheet, radius_pt: float, copies: int, seed: int) -> list[Truth]:
    """Each probe of ``sheet`` ``copies`` times over, every place moved by up to ``radius_pt`` each way.

    A model places points on a rendered crop, not on coordinates: this is its
    hand. The generator is seeded, so a run is the same run every time.
    """
    rng = random.Random(seed)
    width, height = sheet.page.shown_size()
    moved: list[Truth] = []
    for truth in sheet.truths:
        for copy in range(copies):
            places = tuple(
                (
                    x + rng.uniform(-radius_pt, radius_pt) / width,
                    y + rng.uniform(-radius_pt, radius_pt) / height,
                )
                for x, y in truth.places
            )
            moved.append(replace(truth, name=f"{truth.name}~{radius_pt:g}pt#{copy}", places=places))
    return moved
