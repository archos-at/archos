"""Which source a lookup reads this turn: the released record the turn carries, by its country.

The BFF puts the released source records with a ``lookup`` block of the
countries the turn reads into its knowledge context (``context/sources.ts``).
The lookup reads the one for the site's country, else the only one the turn
carries. A record is parsed once per revision (records do not change under a
revision id), into the same :class:`LawSource` a repository record becomes.

With none, the lookup reads the repository record it is configured with, the
fallback while a country's record is not yet published (ADR-0174, amendment
2026-11-11), and logs that it did, once per process and source. A source the
turn could not carry (``sources_dropped``) is said in the answer path, never
dropped silently.
"""

from __future__ import annotations

import logging
from functools import lru_cache

from agent.common.knowledge_context import LawSource as TurnSource
from agent.common.knowledge_context import turn_knowledge_context
from agent.knowledge.law_lookup.source import LawSource
from agent.knowledge.law_lookup.source import law_source_from_record

logger = logging.getLogger(__name__)

#: Repository records a lookup fell back to in this process (the log line is said once per source).
_FELL_BACK: set[str] = set()


def turn_source() -> TurnSource | None:
    """The released source this turn reads: the site country's, else the only one carried; None without one."""
    context = turn_knowledge_context()
    usable = [source for source in context.sources if "lookup" in source.config]
    if context.site_country:
        # A site's law is its own country's: another country's record never answers for it.
        return next((source for source in usable if source.country == context.site_country), None)
    return usable[0] if len(usable) == 1 else None


def released_law_source(source: TurnSource) -> LawSource:
    """The turn's record as a lookup reads it, built once per revision."""
    return _released(source.revision_id, source)


@lru_cache(maxsize=32)
def _released(_revision_id: str, source: TurnSource) -> LawSource:
    from public_sources.source import parse_released_source

    return law_source_from_record(parse_released_source(dict(source.config)))


def note_fallback(law: LawSource) -> None:
    """Log, once per process and source, that a lookup read the repository record for want of a released one."""
    if law.source.id in _FELL_BACK:
        return
    _FELL_BACK.add(law.source.id)
    logger.warning(
        "[law_source_from_repository=true] no released source record with a lookup block reached this turn; "
        "reading the repository record %s",
        law.source.id,
    )


def dropped_note(law: LawSource) -> str:
    """The line an answer carries when the turn could not carry a released source of this source's country."""
    country = law.source.territory[:2].lower()
    dropped = [key for key in turn_knowledge_context().sources_dropped if key.split("-", 1)[0] == country]
    if not dropped:
        return ""
    return (
        f"Note: the released source record(s) {', '.join(dropped)} could not be carried by this turn (too large, "
        f"or past the number a turn carries), so {law.wording.source} was read from its fallback record. Say in one "
        "sentence that the published source could not be read for this answer."
    )


#: How a refusal of the fallback begins: the call is answered with it, not run.
WITHHELD_PREFIX = "Not executed:"


def withheld_note(law: LawSource) -> str:
    """The refusal when the fallback record's own country is one this turn may not read; empty otherwise.

    The chat binding is not withheld by country where the turn carries a released source (``law_gate``), so the
    fallback is checked here, by its record's territory: it is never a way past the gate.
    """
    from agent.common.knowledge_context import get_turn_knowledge_context
    from agent.common.law_gate import withheld_notice_for_country

    if get_turn_knowledge_context() is None:  # a script or a door call: the turn's gate is not this call's
        return ""
    return withheld_notice_for_country(law.source.territory[:2], law.wording.source) or ""
