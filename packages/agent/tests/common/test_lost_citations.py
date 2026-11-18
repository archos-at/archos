from __future__ import annotations

from agent.citations.entries import DUPLICATE_REASON_PREFIX
from agent.citations.entries import lost_citations
from agent.core.ledger import citations_removed_summary

MERGED = {"number": 5, "line": "- [5] a.pdf, p.4", "reason": f"{DUPLICATE_REASON_PREFIX}1"}
LOST = {"number": 6, "line": "- [6] b.pdf, p.9", "reason": "citation_key_not_in_registry"}


def test_a_merged_duplicate_is_not_lost():
    assert lost_citations([MERGED]) == []
    assert lost_citations([MERGED, LOST]) == [LOST]


def test_the_reader_is_not_told_a_merge_removed_anything():
    assert citations_removed_summary([MERGED]) is None
    assert citations_removed_summary([MERGED, LOST]) == {"count": 1, "reasons": ["citation_key_not_in_registry"]}


async def test_a_removed_citation_never_calls_the_repair():
    from unittest.mock import AsyncMock
    from unittest.mock import patch

    from agent.citations.entries import CitationVerificationResult
    from agent.citations.registry import SourceRegistry
    from agent.core import answer_pipeline

    removed = CitationVerificationResult(verified_report="x [1]", removed_citations=[MERGED, LOST], valid_citations=[])
    repair = AsyncMock()
    with (
        patch.object(answer_pipeline, "verify_citations", return_value=removed),
        patch.object(answer_pipeline, "verify_quoted_spans", return_value=[]),
    ):
        await answer_pipeline._verify_with_quote_patch("x [1] [5] [6]", SourceRegistry(), repair)
    repair.assert_not_awaited()
