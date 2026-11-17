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

    enabled_stages: frozenset[str]
    deep_research_allowed: bool = True
    tasks_allowed: bool = True
    folder_cards_allowed: bool = False
    licensed_text_allowed: bool = False


_TIMEOUT_SECONDS = 1.5


def stages_for_flag_slug(flag_slug: str) -> frozenset[str]:
    return frozenset(spec.id for spec in iter_stages() if spec.flag_slug == flag_slug)


def legacy_enabled_stages(*, memory_reflection_enabled: bool) -> frozenset[str]:
    if not memory_reflection_enabled:
        return frozenset()
    return stages_for_flag_slug(MEMORY_REFLECTION_FLAG_SLUG)


def fetch_turn_flags(*, organization_id: str | None, project_id: str | None = None) -> TurnFlags:
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
    return fetch_turn_flags(organization_id=organization_id).enabled_stages


async def resolve_enabled_stages(*, organization_id: str | None, memory_reflection_enabled: bool) -> frozenset[str]:
    flags = await resolve_turn_flags(
        organization_id=organization_id, memory_reflection_enabled=memory_reflection_enabled
    )
    return flags.enabled_stages
