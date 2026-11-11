"""The scores of a country's quality bar (ADR-0165 amendment), declared into ``SCORE_DEFINITIONS``.

Two groups. The golden run's own (``golden-*``), written by the BFF on the trace of each turn that answered a
golden case (``bff/langfuse/golden-run-score.ts``), under the dataset run of that golden run. And four of
the six citation scores the country-as-data review names as the bar for "better than before": what an
answer's citations must hold in any country. The golden run writes two of them today, on golden cases only,
by reading the case's expectation off the answer and its cited sources. The other two need a citation that
carries its edition and its role, which the answer pipeline does not write yet; they are declared here so the
name, the type and the meaning are fixed before the first writer exists. The remaining two,
``law-cited-from-web`` and ``binding-claim-without-records``, are the agent's on every answered turn and are
declared once, in ``law_source_scores``: the golden run does not write them, so a golden trace carries one
value per name.
"""

from __future__ import annotations

from .score_definition import ScoreDefinition

#: The Langfuse dataset a golden case is an item of; the golden run links each answer's trace to it.
GOLDEN_CASES_DATASET = "golden-cases"

GOLDEN_SCORE_DEFINITIONS: tuple[ScoreDefinition, ...] = (
    ScoreDefinition(
        name="golden-case-passed",
        data_type="BOOLEAN",
        description=(
            "Per golden case of a golden run: true when every deciding check held (each expected value present, "
            "the edition named, each citation resolving, no must-not violated). Its comment lists the checks that "
            "failed. An expectation no reviewer confirmed yet is scored and never decides."
        ),
        writer="bff",
    ),
    ScoreDefinition(
        name="golden-expected-values",
        data_type="NUMERIC",
        description="Per golden case that states expected values: the share of them the answer holds.",
        writer="bff",
        min_value=0,
        max_value=1,
    ),
    ScoreDefinition(
        name="golden-must-not-violations",
        data_type="NUMERIC",
        description=(
            "Per golden case: how many of its must-not rules the answer broke (a web copy cited where the corpus "
            "holds the text, high confidence whose reason names an open point, an edition called binding before "
            "the records are published). Zero is a measurement."
        ),
        writer="bff",
        min_value=0,
    ),
    ScoreDefinition(
        name="golden-seconds",
        data_type="NUMERIC",
        description="Per golden case: server seconds from the question to its answer.",
        writer="bff",
        min_value=0,
    ),
    ScoreDefinition(
        name="golden-cost-usd",
        data_type="NUMERIC",
        description=(
            "Per golden case: what the turn cost in USD, summed from the usage ledger; absent when the ledger holds "
            "no row for it."
        ),
        writer="bff",
        min_value=0,
    ),
    ScoreDefinition(
        name="claim-citation-resolves",
        data_type="BOOLEAN",
        description=(
            "Whether what the sentence cites is what opens. Written by the golden run on a case that states its "
            "citations: true when each expected instrument is among the cited sources and its locus is in the "
            "answer or on the source."
        ),
        writer="bff",
    ),
    ScoreDefinition(
        name="edition-agrees",
        data_type="BOOLEAN",
        description=(
            "Whether the edition the prose names is the edition of the cited passage. Declared, no writer yet: it "
            "needs citations that carry the edition they were read as."
        ),
    ),
)
