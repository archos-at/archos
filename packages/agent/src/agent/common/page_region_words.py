from __future__ import annotations

from typing import Any


def where_on_the_page(region: Any) -> str:
    cx, cy = region.x + region.w / 2, region.y + region.h / 2
    row = "oben" if cy < 1 / 3 else ("unten" if cy > 2 / 3 else "")
    column = "links" if cx < 1 / 3 else ("rechts" if cx > 2 / 3 else "")
    if row and column:
        return f"{row} {column}"
    if row:
        return f"{row} in der Mitte"
    return f"in der Mitte {column}" if column else "in der Seitenmitte"


def where_on_the_page_en(region: Any) -> str:
    cx, cy = region.x + region.w / 2, region.y + region.h / 2
    row = "top" if cy < 1 / 3 else ("bottom" if cy > 2 / 3 else "")
    column = "left" if cx < 1 / 3 else ("right" if cx > 2 / 3 else "")
    if row and column:
        return f"{row} {column}"
    if row:
        return f"{row} centre"
    return f"centre {column}" if column else "page centre"


def percent(share: float) -> str:
    return f"{max(1, round(share * 100))} %"
