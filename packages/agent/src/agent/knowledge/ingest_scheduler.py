"""The lane an ingestion job is fair in, and how much of the fleet one lane may hold.

Fairness between organisations used to be ours: a fair in-process pool and a
fair claim over the durable queue. It is Hatchet's now (ADR-0150): the
``ingest-document`` task's concurrency is keyed on the job's lane with
``GROUP_ROUND_ROBIN`` (``ingest_hatchet``). What stays here is the lane itself,
which the research queue shares, and the per-lane cap.

A job with no organisation (the base-corpus sync, a RIS fetch) is its own lane,
``PLATFORM_LANE``, and is scheduled like any organisation.
"""

from __future__ import annotations

import os

#: The lane of a job no organisation owns.
PLATFORM_LANE = "__platform__"

_CAP_ENV = "INGEST_MAX_PER_ORG"


# @environment_variable INGEST_MAX_PER_ORG
# @category Knowledge Layer
# @type int
# @default 0
# @required false
# Most ingestion jobs one organisation may have running across the fleet: the
# `max_runs` of the `ingest-document` task's per-organisation concurrency in
# Hatchet. 0 is the default, `ingest_hatchet.DEFAULT_MAX_RUNS_PER_ORG`.
def per_org_cap_from_env() -> int:
    """The per-organisation cap: ``INGEST_MAX_PER_ORG``, 0 when unset or not a number."""
    raw = os.environ.get(_CAP_ENV, "").strip()
    try:
        return max(0, int(raw))
    except ValueError:
        return 0


def lane_of(organization_id: str | None) -> str:
    """The lane a job with this organisation id waits in."""
    return organization_id or PLATFORM_LANE
