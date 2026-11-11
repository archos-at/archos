"""The small value records a citable passage carries beside its text (``GroundingHit``): where on the page it
sits, and which Fassung it is. Split from ``grounding_block.py``, which re-exports both."""

from __future__ import annotations

import math
from dataclasses import dataclass

from pydantic import BaseModel
from pydantic import ConfigDict


@dataclass(frozen=True)
class SourceRegion:
    """Where on a page a passage sits, as a box the viewer can draw (issue #433).

    ``box`` is ``(x0, y0, x1, y1)`` normalised 0-1 over the page AS THE VIEWER
    SHOWS IT: a whole rendered PDF page, or a whole uploaded image, top-left
    origin. That is the frame the visual analysis read the picture in, so the
    box needs no conversion, and it is why a region is only ever produced for
    those two frames (``knowledge_layer.search.grounding_hits._hit_regions``). An embedded
    raster's box is relative to the raster, whose placement on the page is not
    stored, so it gets none rather than a box in the wrong place.

    The box is the model's approximation of one depiction on the sheet (a
    Grundriss, a Schnitt), not a measurement and not the single object a query
    named. ``label`` is that depiction's title as read off the sheet, when it
    had one.

    A dataclass, not a model, because it rides on ``SourceEntry`` and
    ``dataclasses.asdict`` is how the session registry is cached.
    """

    box: tuple[float, float, float, float]
    label: str | None = None

    def to_wire(self) -> dict[str, object]:
        """The citation wire's spelling: ``{"box": [...], "label": ...}``, label omitted when unknown."""
        payload: dict[str, object] = {"box": list(self.box)}
        if self.label:
            payload["label"] = self.label
        return payload

    @classmethod
    def from_cached(cls, value: object) -> SourceRegion | None:
        """Rebuild one from its ``asdict`` form, or ``None`` for anything malformed."""
        if not isinstance(value, dict):
            return None
        box = value.get("box")
        if not isinstance(box, (list, tuple)) or len(box) != 4:
            return None
        try:
            x0, y0, x1, y1 = (float(part) for part in box)
        except TypeError, ValueError:
            return None
        if not all(math.isfinite(part) for part in (x0, y0, x1, y1)):
            return None
        label = value.get("label")
        return cls(box=(x0, y0, x1, y1), label=label if isinstance(label, str) and label else None)


class SourceRevision(BaseModel):
    """Which Fassung a passage's text is, as its producer knows it.

    For an office or project document, what its own name says (``revision_series``): ``Index C``,
    ``2026-08-14``. For a consolidated law read at its source, the day that text is in force from.
    """

    model_config = ConfigDict(frozen=True)

    #: The index as it reads to a person (``C``, ``12``); None when only a day is known.
    index: str | None = None
    #: ISO ``YYYY-MM-DD``; None when only an index is known.
    date: str | None = None
