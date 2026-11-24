from __future__ import annotations

from .score_definition import ScoreDefinition

ADVICE_POLICY_TRACE_TAG = "advice_policy:carried"

ONBOARDING_SCORE_DEFINITIONS: tuple[ScoreDefinition, ...] = (
    ScoreDefinition(
        name="advice-policy-held",
        data_type="BOOLEAN",
        description=(
            "LLM judge, on an answered turn that carried the site's advice policy (ADR-0174): true when the "
            "answer kept every hedge code (`topic:mode`) the trace metadata lists, false when it asserted where "
            "the policy hedges or declines, or answered a declined topic."
        ),
        writer="judge",
    ),
    ScoreDefinition(
        name="freshness-lag-days",
        data_type="NUMERIC",
        description=(
            "Per watched public source, on the source monitor's run (ADR-0174): days since the source was last "
            "checked successfully. Zero is a measurement; a source the monitor cannot reach grows by a day a day."
        ),
        writer="bff",
        min_value=0,
    ),
)
