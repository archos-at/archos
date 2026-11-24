from __future__ import annotations

import logging

from agent.common.residency import ProcessingPolicy
from agent.common.residency import parse_policy
from agent.common.residency import policy_to_json

logger = logging.getLogger(__name__)

_SHARED_TTL_SECONDS = 60.0


def shared_model_config_key(organization_id: str) -> str:
    return f"modelconfig:{organization_id}"


def read_shared(organization_id: str) -> tuple[dict[str, str], bool, ProcessingPolicy] | None:
    from agent.common import cache as shared_cache

    try:
        value = shared_cache.get_json(shared_model_config_key(organization_id))
    except Exception:  # noqa: BLE001 - the shared tier is a cache, never a dependency
        return None
    if not isinstance(value, dict):
        return None
    overrides = value.get("overrides")
    zdr_only = value.get("zdr_only")
    if not isinstance(overrides, dict) or not isinstance(zdr_only, bool) or "processing" not in value:
        return None  # an entry from before the processing policy (ADR-0167) is a miss, not an unreadable policy
    return overrides, zdr_only, parse_policy(value.get("processing"))  # the caller sanitizes the overrides


def write_shared(org_id: str, overrides: dict[str, str], zdr_only: bool, processing: ProcessingPolicy) -> None:
    from agent.common import cache as shared_cache

    if not processing.known:
        return
    try:
        shared_cache.set_json(
            shared_model_config_key(org_id),
            {"overrides": overrides, "zdr_only": zdr_only, "processing": policy_to_json(processing)},
            _SHARED_TTL_SECONDS,
        )
    except Exception:  # noqa: BLE001 - see read_shared
        logger.debug("Could not write org model config to the shared cache", exc_info=True)
