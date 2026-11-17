from __future__ import annotations

import re
from datetime import date

from public_sources.engines import RIS_IN_FORCE_UNTIL

_ISO = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
_ISO_TIMESTAMP = re.compile(r"(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?")
_GERMAN = re.compile(r"(\d{1,2})\.(\d{1,2})\.(\d{4})")


def parse_day(text: str) -> date | None:
    text = (text or "").strip()
    iso = _ISO.fullmatch(text) or _ISO_TIMESTAMP.fullmatch(text)
    german = _GERMAN.fullmatch(text)
    try:
        if iso:
            return date(int(iso[1]), int(iso[2]), int(iso[3]))
        if german:
            return date(int(german[3]), int(german[2]), int(german[1]))
    except ValueError:
        return None
    return None


def as_of_error(as_of: str) -> str:
    if not as_of:
        return ""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", as_of) or parse_day(as_of) is None:
        return f"Error: as_of must be a calendar day as YYYY-MM-DD, got {as_of!r}."
    return ""


def in_force_on(metadata: dict[str, str], day: date) -> bool:
    since = parse_day(metadata.get("In Kraft seit", ""))
    if since is None or since > day:
        return False
    until_text = metadata.get(RIS_IN_FORCE_UNTIL, "").strip()
    if not until_text:
        return True
    until = parse_day(until_text)
    return until is not None and day <= until
