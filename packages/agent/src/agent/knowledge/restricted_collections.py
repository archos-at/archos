from __future__ import annotations

import re
from collections.abc import Iterable

_RESTRICTED_NAME = re.compile(r"^(?P<base>.+)_r[0-9a-f]{12}$", re.IGNORECASE)


def is_restricted_collection(name: str | None) -> bool:
    return bool(name) and _RESTRICTED_NAME.match(name.strip()) is not None


def base_collection_of(name: str) -> str:
    match = _RESTRICTED_NAME.match(name.strip())
    return match.group("base") if match else name


def restricted_collections_in(names: Iterable[str | None] | None) -> list[str]:
    return [name for name in names or () if is_restricted_collection(name)]
