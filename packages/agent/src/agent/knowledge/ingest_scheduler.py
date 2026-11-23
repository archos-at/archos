from __future__ import annotations

import os

PLATFORM_LANE = "__platform__"

_CAP_ENV = "INGEST_MAX_PER_ORG"


def per_org_cap_from_env() -> int:
    raw = os.environ.get(_CAP_ENV, "").strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return 0


def lane_of(organization_id: str | None) -> str:
    return organization_id or PLATFORM_LANE
