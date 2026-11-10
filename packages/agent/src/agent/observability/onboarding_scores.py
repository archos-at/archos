"""The scores the country onboarding tooling produces (ADR-0174), declared into ``SCORE_DEFINITIONS``.

- ``advice-policy-held``: the judge reads an answered turn that carried a site's advice policy (its hedge codes
  in the trace metadata, ``hedges``, and the tag :data:`ADVICE_POLICY_TRACE_TAG`) and says whether the answer
  kept to it. The rule runs only on such turns, so a turn without a policy is never graded against one.
- ``freshness-lag-days``: written by the BFF's source monitor (``bff/base-knowledge/platform/monitor.ts``) on its
  run's trace, one per watched source, its item the source's record id: days since the source's last
  successful check. The monitor writes it whether or not the source changed, so a silent source shows as lag.
"""

from __future__ import annotations

from .score_definition import ScoreDefinition

#: The tag a chat turn carries when its prompt held an advice policy's hedges (design §5.5).
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
