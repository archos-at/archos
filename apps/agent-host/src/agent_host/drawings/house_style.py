"""The brand on the drawing sheet: its type, its ink, its name (ADR-0152).

Quietly. The sheet is the office's document, so the brand shows only where a
plotted sheet carries its maker anyway: the title block is set in the brand's
General Sans, its colours are the brand's ink and ink-muted (``tokens.json``:
``ink`` #0f0e0d, ``ink-muted`` #5e5b57: warm near-black, never pure black), and a
line in the margin under the frame says „Erstellt mit …“ beside the app icon.
That is the brand's own rule for a PDF's foot: the wordmark needs 20 mm in print,
and below that the icon stands in for it, the name's initial in Switzer Semibold
on an ink tile (``packages/brand/docs/brand-basis.md``, „App icon“).

The fonts and the name are copied here by ``node packages/brand/sync.mjs`` (into
``brand/``), so a rename or a new typeface reaches the sheet on the next sync and
no name is typed into this code. The fonts ship as WOFF2; they are unpacked once
per process into a temporary folder for matplotlib, and the variable General Sans
is cut into the three weights the sheet uses. If anything there fails, the sheet
falls back to DejaVu Sans and says so in the log: a missing font never fails a
rendition.
"""

from __future__ import annotations

import json
import logging
import tempfile
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from matplotlib.font_manager import FontProperties

logger = logging.getLogger(__name__)

INK = "#0f0e0d"
INK_MUTED = "#5e5b57"
#: The warm white of the app icon's letter on its ink tile.
ON_INK = "#fafaf9"

_BRAND = Path(__file__).with_name("brand")
_TEXT_FACE = "GeneralSans-Variable.woff2"
_MARK_FACE = "Switzer-Semibold.woff2"
_WEIGHTS = {"regular": 400, "medium": 500, "semibold": 600}


@dataclass(frozen=True)
class HouseStyle:
    """The type the sheet is set in, and the name it is made with."""

    regular: FontProperties
    medium: FontProperties
    semibold: FontProperties
    #: For the icon's initial.
    mark: FontProperties
    product_name: str
    #: The regular weight as a file, for a drawing's own labels (ezdxf reads fonts by file); None on the fallback.
    label_face_file: Path | None = None


@cache
def house_style() -> HouseStyle:
    """The brand's type and name, unpacked once per process, or DejaVu Sans when they cannot be."""
    name = _product_name()
    try:
        folder = Path(tempfile.mkdtemp(prefix="sheet-type-"))
        faces = {weight: _instance(_BRAND / "fonts" / _TEXT_FACE, value, folder) for weight, value in _WEIGHTS.items()}
        mark = _unpacked(_BRAND / "fonts" / _MARK_FACE, folder)
        return HouseStyle(
            regular=FontProperties(fname=faces["regular"]),
            medium=FontProperties(fname=faces["medium"]),
            semibold=FontProperties(fname=faces["semibold"]),
            mark=FontProperties(fname=mark),
            product_name=name,
            label_face_file=Path(faces["regular"]),
        )
    except Exception:  # noqa: BLE001 - any font fault falls back; a rendition must not fail on type
        logger.warning("dxf sheet: brand type unavailable, falling back to DejaVu Sans", exc_info=True)
        fallback = FontProperties(family="DejaVu Sans")
        bold = FontProperties(family="DejaVu Sans", weight="bold")
        return HouseStyle(regular=fallback, medium=fallback, semibold=bold, mark=bold, product_name=name)


def _product_name() -> str:
    try:
        return str(json.loads((_BRAND / "identity.json").read_text(encoding="utf-8"))["name"])
    except OSError, KeyError, ValueError:
        return ""


def _instance(source: Path, weight: int, folder: Path) -> str:
    """One weight of the variable face, as a static TrueType file matplotlib can embed."""
    from fontTools.ttLib import TTFont  # noqa: PLC0415 - only when a sheet is drawn
    from fontTools.varLib.instancer import instantiateVariableFont  # noqa: PLC0415

    font = TTFont(str(source))
    font.flavor = None
    static = instantiateVariableFont(font, {"wght": weight})
    path = folder / f"{source.stem}-{weight}.ttf"
    static.save(str(path))
    return str(path)


def _unpacked(source: Path, folder: Path) -> str:
    from fontTools.ttLib import TTFont  # noqa: PLC0415 - only when a sheet is drawn

    font = TTFont(str(source))
    font.flavor = None
    path = folder / f"{source.stem}.ttf"
    font.save(str(path))
    return str(path)
