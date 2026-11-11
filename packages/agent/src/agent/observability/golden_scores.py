"""The scores of a country's quality bar (ADR-0165 amendment), declared into ``SCORE_DEFINITIONS``.

Two groups. The golden run's own (``golden-*``), written by the BFF on the trace of each turn that answered a
golden case (``bff/langfuse/golden-run-score.ts``), under the dataset run of that golden run. And the six
citation scores the country-as-data review names as the bar for "better than before": what an answer's
citations must hold in any country. The golden run writes three of them today, on golden cases only, by
reading the case's expectation off the answer and its cited sources. The other three need a citation that
carries its edition and its role, which the answer pipeline does not write yet; they are declared here so the
name, the type and the meaning are fixed before the first writer exists, and a chart built on them does not
change when the pipeline starts writing them on every answer.
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
        name="edition-named",
        data_type="BOOLEAN",
        description=(
            "Whether the answer names the edition it rests on. Written by the golden run on a case that states "
            "the expected edition: true when the answer or a cited source names it."
        ),
        writer="bff",
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
        name="law-cited-from-web",
        data_type="BOOLEAN",
        description=(
            "Whether law was cited from a web page instead of the law's own source. Written by the golden run on "
            "a case that states its citations: true when a cited source is of kind web. False is the good value."
        ),
        writer="bff",
    ),
    ScoreDefinition(
        name="citation-role-resolved",
        data_type="BOOLEAN",
        description=(
            "Whether a citation carries the role of its edition at the site (binding, guidance, interpretation, "
            "authority practice, information). Declared, no writer yet: it needs citations that carry the edition "
            "they were read as."
        ),
    ),
    ScoreDefinition(
        name="edition-agrees",
        data_type="BOOLEAN",
        description=(
            "Whether the edition the prose names is the edition of the cited passage. Declared, no writer yet: it "
            "needs citations that carry the edition they were read as."
        ),
    ),
    ScoreDefinition(
        name="binding-claim-without-records",
        data_type="BOOLEAN",
        description=(
            "Whether the answer calls an edition binding where the records do not say so. Declared, no writer yet "
            "on every answer; a golden case holds it today as a must-not phrase. False is the good value."
        ),
    ),
)
