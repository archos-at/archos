"""The shared tier (Dragonfly) of an organization's model configuration, below ``model_overrides``' in-process memo.

Its own module so ``model_overrides`` stays a reader of the configuration, not also its cache codec. The BFF
deletes the key on every save (``lib/model-config/service.ts``); a replica that misses its memo reads here before
it asks the BFF, which is what keeps a fresh replica off the BFF on a cold start.
"""

from __future__ import annotations

import logging

from agent.common.residency import ProcessingPolicy
from agent.common.residency import parse_policy
from agent.common.residency import policy_to_json

logger = logging.getLogger(__name__)

# Bounds the write-after-delete race window: a fetch that started BEFORE an
# admin save (reading the pre-save rows) can complete AFTER the BFF's delete
# and re-populate L2 with the stale record, which then serves every replica
# until this TTL expires. 60s caps that staleness; it cannot be zero because
# L2 is also the cold-start path that keeps a fresh replica off the BFF.
#
# RESIDUAL RACE (accepted): delete-then-repopulate as above, plus a replica
# whose L1 still holds the pre-save entry serves it for up to L1 10s after the
# save regardless of L2. Worst case after an admin save is therefore ~L1 + L2
# staleness on a replica that lost the race; the common case is seconds via
# the delete. Direct-SQL or out-of-band writes skip the delete entirely and
# always pay the full TTLs — see docs/architecture/org-model-configuration.md.
_SHARED_TTL_SECONDS = 60.0


def shared_model_config_key(organization_id: str) -> str:
    """The Dragonfly key the BFF invalidates; keep in step with `lib/model-config/service.ts`."""
    return f"modelconfig:{organization_id}"


def read_shared(organization_id: str) -> tuple[dict[str, str], bool, ProcessingPolicy] | None:
    """The org's config from the shared tier, or ``None`` on a miss or a bad value; the overrides unsanitized."""
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
    """Share the org's config with every replica; never an unreadable policy.

    An unreadable placement is a failure, not an answer: ``policy_to_json`` keeps no ``known`` bit, so another
    replica would read it back as a known, unplaced organization and serve it inside a cell (ADR-0167).
    """
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
