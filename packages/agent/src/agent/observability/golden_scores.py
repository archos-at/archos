from __future__ import annotations

from .score_definition import ScoreDefinition

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
