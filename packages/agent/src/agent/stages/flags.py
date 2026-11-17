"""What this turn is allowed to do: which stages run, and what may be offered.

The module started as the stage half alone and now carries one more thing, for
one reason: both are answered by the same internal endpoint, in the same
per-turn gather, under the same 1.5s budget. A second fetcher would buy a second
way to spend that budget and nothing else.

Which stages are switched on for this turn.

A stage's runtime gate is *flag ∧ capability*: the WorkOS flag (or its env
fallback) decides whether the tenant gets the stage at all, and the runner
decides separately whether a model is configured for it. This module owns the
first half.

The set is resolved **per turn**, not per connection. That is a deliberate
correction: the ``x-grid-feature-memory-reflection`` header is written once, at
the WebSocket upgrade, and is then frozen for the life of the socket — so an
operator reaching for the kill switch did not reach an already-open tab, which
is the opposite of what a kill switch is for. The resolution follows the pattern
the live memory digest already uses (``fetch_memory_digest``): ask the BFF at
the start of the turn, and fall back to the connection-time value only when the
call fails, so a BFF hiccup degrades to the previous behaviour rather than
silently disabling every stage.

Nothing here branches on a stage id: the legacy fallback is driven by the
``flag_slug`` a stage *declares*.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from agent.common import bff_http
from agent.stages.registry import iter_stages

logger = logging.getLogger(__name__)

MEMORY_REFLECTION_FLAG_SLUG = "memory-reflection"

DEEP_RESEARCH_FLAG_SLUG = "deep-research"


@dataclass(frozen=True)
class TurnFlags:
    """The BFF's answer for one turn: which stages run, what may be offered."""

    enabled_stages: frozenset[str]
    deep_research_allowed: bool = True
    tasks_allowed: bool = True
    folder_cards_allowed: bool = False
    licensed_text_allowed: bool = False


_TIMEOUT_SECONDS = 1.5


def stages_for_flag_slug(flag_slug: str) -> frozenset[str]:
    """Ids of the registered stages declaring ``flag_slug``."""
    return frozenset(spec.id for spec in iter_stages() if spec.flag_slug == flag_slug)


def legacy_enabled_stages(*, memory_reflection_enabled: bool) -> frozenset[str]:
    """The enabled set implied by the single connection-time boolean.

    Kept for one release so a mixed deployment — new backend, older BFF that
    only sends ``memoryReflectionEnabled`` — does not go dark.
    """
    if not memory_reflection_enabled:
        return frozenset()
    return stages_for_flag_slug(MEMORY_REFLECTION_FLAG_SLUG)


def fetch_turn_flags(*, organization_id: str | None, project_id: str | None = None) -> TurnFlags:
    """What this tenant's turn may do, read from the BFF for THIS turn.

    Raises on any configuration or transport problem so the caller can fall back
    to the connection-time value rather than silently disabling every stage —
    the same fail-open-to-the-frozen-value discipline ``fetch_memory_digest``
    uses. Blocking; call via ``asyncio.to_thread``.

    A body without ``features`` is an OLDER BFF, not a refusal: the field is
    read with a True default so a mixed deployment keeps the behaviour it had
    before deep research could be withdrawn at all.
    """
    params = {"organizationId": organization_id} if organization_id else {}
    if project_id:
        params["projectId"] = project_id
    body = bff_http.get_json("/api/internal/stages", timeout=_TIMEOUT_SECONDS, query=params)
    if not isinstance(body, dict):
        raise ValueError("the internal stages endpoint returned no object")
    enabled = body.get("enabled")
    if not isinstance(enabled, list):
        raise ValueError("the internal stages endpoint returned no 'enabled' list")
    features = body.get("features") if isinstance(body.get("features"), dict) else {}
    return TurnFlags(
        enabled_stages=frozenset(item for item in enabled if isinstance(item, str) and item),
        deep_research_allowed=features.get("deepResearch") is not False,
        tasks_allowed=features.get("tasks") is not False,
        folder_cards_allowed=features.get("folderCards") is True,
        licensed_text_allowed=features.get("licensedSeam") is True,
    )


async def resolve_turn_flags(
    *, organization_id: str | None, memory_reflection_enabled: bool, project_id: str | None = None
) -> TurnFlags:
    """This turn's flags, with the connection-time values as fallback.

    Fail-open to the frozen value rather than fail-closed to nothing: a BFF
    hiccup must degrade to the previous behaviour, not silently switch every
    stage off for as long as the blip lasts. The same reasoning keeps deep
    research allowed here — and it is not the last word on the job either way,
    since ``POST /api/jobs/async/submit`` re-checks the flag with the reader's
    own session.
    """
    try:
        return await asyncio.to_thread(fetch_turn_flags, organization_id=organization_id, project_id=project_id)
    except Exception:
        logger.warning("Live per-turn flags unavailable; using the connection-time value", exc_info=True)
        return TurnFlags(
            enabled_stages=legacy_enabled_stages(memory_reflection_enabled=memory_reflection_enabled),
            deep_research_allowed=True,
            tasks_allowed=True,
        )


def fetch_enabled_stages(*, organization_id: str | None) -> frozenset[str]:
    """The stages switched on for this tenant. See :func:`fetch_turn_flags`."""
    return fetch_turn_flags(organization_id=organization_id).enabled_stages


async def resolve_enabled_stages(*, organization_id: str | None, memory_reflection_enabled: bool) -> frozenset[str]:
    """The enabled stage set for THIS turn. See :func:`resolve_turn_flags`.

    Kept as the stage-only name the stage code and its tests read. It delegates
    rather than fetching: two fetchers against one endpoint would eventually
    disagree about what a missing field means.
    """
    flags = await resolve_turn_flags(
        organization_id=organization_id, memory_reflection_enabled=memory_reflection_enabled
    )
    return flags.enabled_stages
