from __future__ import annotations

from .score_definition import ScoreDefinition

RESIDENCY_SCORE_DEFINITIONS: tuple[ScoreDefinition, ...] = (
    ScoreDefinition(
        name="processing-location-compliant",
        data_type="BOOLEAN",
        description=(
            "For each distinct endpoint a trace's model calls reached (the score's item, `subprocessor:location`): "
            "true when the register places that endpoint inside the deployment's residency zone, or anywhere "
            "known when no cell is set; false for an unplaced host or one outside the zone (ADR-0167). With a "
            "cell set a false call was refused, so a false score there is a refusal, not a leak."
        ),
    ),
)
