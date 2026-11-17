from __future__ import annotations

from .score_definition import ScoreDefinition

LAW_SOURCE_SCORE_DEFINITIONS: tuple[ScoreDefinition, ...] = (
    ScoreDefinition(
        name="law-cited-from-web",
        data_type="BOOLEAN",
        description=(
            "On an answered chat turn: true when the answer cites a web page that is a copy of a work the "
            "records hold (a host a source record lists under `copy_hosts`) or that only names one (its "
            "designation in the page's title or address), instead of the legal database or the knowledge base. "
            "The comment counts the works. Target: false."
        ),
    ),
    ScoreDefinition(
        name="binding-claim-without-records",
        data_type="BOOLEAN",
        description=(
            "On an answered chat turn: true when a sentence states law the turn's records do not carry: it "
            "cites only web sources and names law, or the gate may not bind and it says a text binds or is "
            "required (words from `configs/norms/*/claim_terms.yml`). The comment counts the sentences per "
            "rule (`web_only`, `gate_may_not_bind`). The turn's confidence is then capped (`law_unsettled`)."
        ),
    ),
    ScoreDefinition(
        name="web-sources-withheld",
        data_type="NUMERIC",
        description=(
            "Per web search: how many hits it did not hand on as sources: the product's own site, an address "
            "that cannot be cited (not https, a local or internal host), a copy of law a readable legal "
            "database holds, a document copy of a work the knowledge base holds. Zero is a measurement."
        ),
        min_value=0,
    ),
)
