from __future__ import annotations

import re
from datetime import UTC
from datetime import date
from datetime import datetime

_ISO = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
_ISO_TIMESTAMP = re.compile(r"(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?")
_DOTTED = re.compile(r"(\d{1,2})\.(\d{1,2})\.(\d{4})")


def parse_day(text: str) -> date | None:
    text = (text or "").strip()
    iso = _ISO.fullmatch(text) or _ISO_TIMESTAMP.fullmatch(text)
    dotted = _DOTTED.fullmatch(text)
    try:
        if iso:
            return date(int(iso[1]), int(iso[2]), int(iso[3]))
        if dotted:
            return date(int(dotted[3]), int(dotted[2]), int(dotted[1]))
    except ValueError:
        return None
    return None


def as_of_error(as_of: str) -> str:
    if not as_of:
        return ""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", as_of) or parse_day(as_of) is None:
        return f"Error: as_of must be a calendar day as YYYY-MM-DD, got {as_of!r}."
    return ""


def today() -> date:
    return datetime.now(UTC).date()


def reads_today(as_of: str, now: date) -> bool:
    day = parse_day(as_of)
    return day is not None and day >= now


def today_note(as_of: str, now: date) -> str:
    if parse_day(as_of) == now:
        return f"as_of {as_of} is today: the text in force today."
    return (
        f"as_of {as_of} is after today ({now.isoformat()}): the text in force today. An amendment already "
        "promulgated for a later day is not in it; say so when the answer depends on that day."
    )


def in_force_on(metadata: dict[str, str], day: date, engine) -> bool:
    since = parse_day(metadata.get(engine.in_force_from, "")) if engine.in_force_from else None
    if since is None or since > day:
        return False
    until_text = metadata.get(engine.in_force_until, "").strip() if engine.in_force_until else ""
    if not until_text:
        return True
    until = parse_day(until_text)
    return until is not None and day <= until
