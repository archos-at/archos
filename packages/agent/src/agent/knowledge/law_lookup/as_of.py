"""A lookup on a past day: only version documents in force on it (ADR-0171).

An architect is judged by the law in force when the submission was filed, so
``as_of`` asks for the text of that day. A source that holds every version of
a provision as its own document states each one's in-force window on its
search hits, under labels its format engine names (``Engine.in_force_from``,
``Engine.in_force_until``); the search takes the day through the record's
``date_from`` argument.

Fail closed, whatever the search returns: a hit is read only when its own
in-force window covers the day. The window's last day is in force (the source
prints the last day, not the first day out). The whole-law document is today's
consolidation and is never read for a past day, nor is the catalog's pointer
to it. Nothing found is a miss that says the version was not found, never
today's text under a past date.
"""

from __future__ import annotations

import re
from datetime import UTC
from datetime import date
from datetime import datetime

_ISO = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
#: An ISO timestamp, read as its day: an API may state a date as one. Nothing else after a date is accepted.
_ISO_TIMESTAMP = re.compile(r"(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?")
_DOTTED = re.compile(r"(\d{1,2})\.(\d{1,2})\.(\d{4})")


def parse_day(text: str) -> date | None:
    """An ISO (``2023-01-01``) or day-first dotted (``01.01.2023``) date, or None for anything else."""
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
    """Why ``as_of`` cannot be used, or an empty string when it can (or is not given)."""
    if not as_of:
        return ""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", as_of) or parse_day(as_of) is None:
        return f"Error: as_of must be a calendar day as YYYY-MM-DD, got {as_of!r}."
    return ""


def today() -> date:
    """The day the lookup reads as today: the UTC date, the one clock every replica shares."""
    return datetime.now(UTC).date()


def reads_today(as_of: str, now: date) -> bool:
    """Whether ``as_of`` asks for today's text: a day on or after today (``now``).

    Today's consolidated text IS the version in force today, so such a day takes
    the lookup's usual path (address, catalog, search). A later day reads today's
    text too, and the answer says so (:func:`today_note`): nothing in force later
    is known yet, and a version already promulgated for it is not in today's text.
    Only a past day is read from version documents of that day.
    """
    day = parse_day(as_of)
    return day is not None and day >= now


def today_note(as_of: str, now: date) -> str:
    """The line an answer carries when ``as_of`` was read as today."""
    if parse_day(as_of) == now:
        return f"as_of {as_of} is today: the text in force today."
    return (
        f"as_of {as_of} is after today ({now.isoformat()}): the text in force today. An amendment already "
        "promulgated for a later day is not in it; say so when the answer depends on that day."
    )


def in_force_on(metadata: dict[str, str], day: date, engine) -> bool:
    """Whether a version document was in force on ``day``; unknown dates are not."""
    since = parse_day(metadata.get(engine.in_force_from, "")) if engine.in_force_from else None
    if since is None or since > day:
        return False
    until_text = metadata.get(engine.in_force_until, "").strip() if engine.in_force_until else ""
    if not until_text:
        return True
    until = parse_day(until_text)
    return until is not None and day <= until
