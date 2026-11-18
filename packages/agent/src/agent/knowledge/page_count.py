from __future__ import annotations

from collections.abc import Iterable
from collections.abc import Mapping
from typing import Any


def page_number(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        page = int(value)
    except TypeError, ValueError:
        return None
    return page if page >= 1 else None


def largest_page(payloads: Iterable[Mapping[str, Any]]) -> int | None:
    pages = [
        page
        for payload in payloads
        for page in (page_number(payload.get("page_label")), page_number(payload.get("page_end")))
        if page is not None
    ]
    return max(pages, default=None)
