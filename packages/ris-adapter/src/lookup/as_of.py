"""A lookup on a past day: only RIS version documents in force on it (ADR-0171).

An architect is judged by the law in force when the submission was filed, so
``as_of`` asks for the text of that day. RIS holds every consolidated version
of a paragraph as its own document with ``Inkrafttretensdatum`` and
``Ausserkrafttretensdatum``; the federal search takes ``Fassung.FassungVom``
(the record's ``date_from`` table). For Land law the record names no date
parameter [verify the OGD API], so a Land search may return only today's
versions.

Fail closed, whatever the search returns: a hit is read only when its own
in-force window covers the day. RIS prints ``Ausserkrafttretensdatum`` as the
last day in force (the Bauproduktegesetz 1997 ends ``2018-12-31``, its
successor starts ``2019-01-01``, OGD API checked 2026-11-10), shown here as
``In Kraft bis``; that day is in force. Base knowledge stores the same end one
day later, half-open (ADR-0171, migration 0216). The whole-law document is today's consolidation and is never read
for a past day, nor is the catalog's pointer to it. Nothing found is a miss
that says the version was not found, never today's text under a past date.
"""

from __future__ import annotations

import re
from datetime import date

from public_sources.engines import RIS_IN_FORCE_UNTIL

_ISO = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
#: An ISO timestamp, read as its day: OGD-RIS may state a date as one. Nothing else after a date is accepted.
_ISO_TIMESTAMP = re.compile(r"(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?")
_GERMAN = re.compile(r"(\d{1,2})\.(\d{1,2})\.(\d{4})")


def parse_day(text: str) -> date | None:
    """An ISO (``2023-01-01``) or German (``01.01.2023``) date, or None for anything else."""
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
    """Why ``as_of`` cannot be used, or an empty string when it can (or is not given)."""
    if not as_of:
        return ""
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", as_of) or parse_day(as_of) is None:
        return f"Error: as_of must be a calendar day as YYYY-MM-DD, got {as_of!r}."
    return ""


def in_force_on(metadata: dict[str, str], day: date) -> bool:
    """Whether a RIS version document was in force on ``day``; unknown dates are not."""
    since = parse_day(metadata.get("In Kraft seit", ""))
    if since is None or since > day:
        return False
    until_text = metadata.get(RIS_IN_FORCE_UNTIL, "").strip()
    if not until_text:
        return True
    until = parse_day(until_text)
    return until is not None and day <= until
