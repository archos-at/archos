"""A lookup on a past day: only RIS version documents in force on it (ADR-0171).

An architect is judged by the law in force when the submission was filed, so
``as_of`` asks for the text of that day. RIS holds every consolidated version
of a paragraph as its own document with ``Inkrafttretensdatum`` and
``Ausserkrafttretensdatum``; the federal search takes ``Fassung.FassungVom``
(the record's ``date_from`` table). For Land law the record names no date
parameter [verify the OGD API], so a Land search may return only today's
versions.

Fail closed, whatever the search returns: a hit is read only when its own
in-force window covers the day. The day it went out of force is excluded, so
the reading holds whether RIS prints that date as the last day or as the first
day without. The whole-law document is today's consolidation and is never read
for a past day, nor is the catalog's pointer to it. Nothing found is a miss
that says the version was not found, never today's text under a past date.
"""

from __future__ import annotations

import asyncio
import os
import re
from datetime import date

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
    until_text = metadata.get("Außer Kraft seit", "").strip()
    if not until_text:
        return True
    until = parse_day(until_text)
    return until is not None and day < until


#: ``TIME_EDITIONS=on|off`` overrides the flag for a whole process: the answer suite runs without a BFF.
ENV_OVERRIDE = "TIME_EDITIONS"


def _allowed_for(organization_id: str | None) -> bool:
    """The ``time-editions`` flag for ``organization_id``; anything short of a yes is no. Blocking."""
    override = os.environ.get(ENV_OVERRIDE, "").strip().lower()
    if override in {"on", "off"}:
        return override == "on"
    if not organization_id:
        return False
    try:
        from agent.stages.flags import fetch_turn_flags

        return fetch_turn_flags(organization_id=organization_id).time_editions_allowed
    except Exception:  # noqa: BLE001 - off is the safe answer: the lookup then refuses as_of
        return False


async def as_of_allowed() -> bool:
    """Whether this turn's organization may ask for a past day; off the event loop."""
    try:
        from agent.project_context import get_organization_id_from_context
    except ImportError:  # adapter used standalone, without the agent package
        return _allowed_for(None)
    return await asyncio.to_thread(_allowed_for, get_organization_id_from_context())


AS_OF_REFUSED = (
    "Error: as_of is not enabled for this organization, so no version of a past day can be read. "
    "Ask without as_of for the version in force today, and say that the version of that day was not checked."
)
