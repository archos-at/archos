from __future__ import annotations

import logging
from functools import lru_cache

from agent.common.knowledge_context import LawSource as TurnSource
from agent.common.knowledge_context import turn_knowledge_context
from agent.knowledge.law_lookup.source import LawSource
from agent.knowledge.law_lookup.source import law_source_from_record

logger = logging.getLogger(__name__)

_FELL_BACK: set[str] = set()


def turn_source() -> TurnSource | None:
    context = turn_knowledge_context()
    usable = [source for source in context.sources if "lookup" in source.config]
    if context.site_country:
        return next((source for source in usable if source.country == context.site_country), None)
    return usable[0] if len(usable) == 1 else None


def released_law_source(source: TurnSource) -> LawSource:
    return _released(source.revision_id, source)


@lru_cache(maxsize=32)
def _released(_revision_id: str, source: TurnSource) -> LawSource:
    from public_sources.source import parse_released_source

    return law_source_from_record(parse_released_source(dict(source.config)))


_UNREADABLE: set[str] = set()


def note_unreadable(key: str, revision_id: str) -> None:
    if revision_id in _UNREADABLE:
        return
    _UNREADABLE.add(revision_id)
    logger.exception(
        "[law_source_record_unreadable=true] the turn's source %s (revision %s) could not be read", key, revision_id
    )


def note_fallback(law: LawSource) -> None:
    if law.source.id in _FELL_BACK:
        return
    _FELL_BACK.add(law.source.id)
    logger.warning(
        "[law_source_from_repository=true] no released source record with a lookup block reached this turn; "
        "reading the repository record %s",
        law.source.id,
    )


def dropped_note(law: LawSource) -> str:
    country = law.source.territory[:2].lower()
    dropped = [key for key in turn_knowledge_context().sources_dropped if key.split("-", 1)[0] == country]
    if not dropped:
        return ""
    return (
        f"Note: the released source record(s) {', '.join(dropped)} could not be carried by this turn (too large, "
        f"or past the number a turn carries), so {law.wording.source} was read from its fallback record. Say in one "
        "sentence that the published source could not be read for this answer."
    )


WITHHELD_PREFIX = "Not executed:"


def withheld_note(law: LawSource) -> str:
    from agent.common.knowledge_context import get_turn_knowledge_context
    from agent.common.law_gate import withheld_notice_for_country

    if get_turn_knowledge_context() is None:  # a script or a door call: the turn's gate is not this call's
        return ""
    return withheld_notice_for_country(law.source.territory[:2], law.wording.source) or ""
