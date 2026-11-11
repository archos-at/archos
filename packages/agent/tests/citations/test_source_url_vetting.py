"""``sanitize_report`` keeps only source lines whose address may be shown (citations spec G28)."""

from __future__ import annotations

import pytest

from agent.citations.sanitize import sanitize_report


def _report(url: str) -> str:
    return (
        "Die Ausgabe 2025 ist genannt [1]. Ein zweiter Satz [2].\n\n"
        "## Quellen\n"
        f"- [1] [Web] Eine Seite – {url}\n"
        "- [2] [Web] Eine andere Seite – https://ok.example.org/a\n"
    )


@pytest.mark.parametrize(
    "url",
    [
        "http://www.oib.or.at/de/inkrafttreten-2015",  # the live case: a source over plain http
        "https://localhost/x",
        "https://frontend/api/internal/turn-context",
        "https://app.default.svc.cluster.local/x",
        "https://10.0.0.7/x",
        "https://[::1]/x",
        "https://[fe80::1]/x",
        "https://8.8.8.8/x",
    ],
)
def test_a_source_that_is_not_a_public_https_page_is_removed_with_its_number(url):
    result = sanitize_report(_report(url))
    assert len(result.unsafe_urls_removed) == 1 and url.startswith(result.unsafe_urls_removed[0])
    assert result.removed_citation_numbers == {1}
    assert url not in result.sanitized_report and "://[" not in result.sanitized_report
    # The surviving source closes the gap, and the wire is told which number died.
    assert "- [1] [Web] Eine andere Seite – https://ok.example.org/a" in result.sanitized_report
    assert result.renumber_map == {2: 1}


def test_a_public_https_source_stays():
    result = sanitize_report(_report("https://www.example.org/de/inkrafttreten"))
    assert result.unsafe_urls_removed == []
    assert result.removed_citation_numbers == set()
    assert "https://www.example.org/de/inkrafttreten" in result.sanitized_report


def test_a_signed_query_is_taken_off_a_source_that_stays():
    signed = "https://bucket.example.com/doc.pdf?X-Amz-Signature=abc&X-Amz-Expires=300"
    result = sanitize_report(_report(signed))
    assert result.removed_citation_numbers == set()
    assert "X-Amz-Signature" not in result.sanitized_report
    assert "- [1] [Web] Eine Seite – https://bucket.example.com/doc.pdf\n" in result.sanitized_report
