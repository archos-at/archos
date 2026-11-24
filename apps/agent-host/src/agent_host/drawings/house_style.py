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
ON_INK = "#fafaf9"

_BRAND = Path(__file__).with_name("brand")
_TEXT_FACE = "GeneralSans-Variable.woff2"
_MARK_FACE = "Switzer-Semibold.woff2"
_WEIGHTS = {"regular": 400, "medium": 500, "semibold": 600}


@dataclass(frozen=True)
class HouseStyle:
    regular: FontProperties
    medium: FontProperties
    semibold: FontProperties
    mark: FontProperties
    product_name: str
    label_face_file: Path | None = None


@cache
def house_style() -> HouseStyle:
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
