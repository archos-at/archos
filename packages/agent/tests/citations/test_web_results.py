"""A web search's sources are its result records, never every address in its text (citations spec G26)."""

from __future__ import annotations

from agent.citations.extraction import extract_sources_from_tool_result
from agent.citations.web_results import parse_web_results

WEB_TOOL = "web_search_tool"


def _record(url: str, title: str, body: str) -> str:
    return f'<Document href="{url}">\n<title>\n{title}\n</title>\n{body}\n</Document>'


RESULT = (
    "Web results are unverified information.\n\n---\n\n"
    "<Answer>\nA summary that links https://summary.example.com/elsewhere.\n</Answer>\n\n---\n\n"
    + _record(
        "https://chamber.example.com/parking",
        "Parking obligations",
        "See also https://linked.example.net/a-page-the-turn-never-read and http://old.example.org/x.",
    )
    + "\n\n---\n\n"
    + _record("https://news.example.org/article", "An article", "Text without links.")
)


def test_a_url_in_a_page_s_body_is_not_a_source():
    entries = extract_sources_from_tool_result(WEB_TOOL, RESULT)
    assert [entry.url for entry in entries] == [
        "https://chamber.example.com/parking",
        "https://news.example.org/article",
    ]
    assert [entry.title for entry in entries] == ["Parking obligations", "An article"]


def test_the_provider_s_summary_names_no_source():
    urls = [entry.url for entry in extract_sources_from_tool_result(WEB_TOOL, RESULT)]
    assert "https://summary.example.com/elsewhere" not in urls


def test_the_deep_search_instance_is_read_the_same_way():
    entries = extract_sources_from_tool_result("advanced_web_search_tool", RESULT)
    assert len(entries) == 2


def test_a_web_result_with_no_record_states_no_source():
    """Its answer is final: text a web tool returned without a record is not mined for addresses."""
    assert extract_sources_from_tool_result(WEB_TOOL, "Nothing structured, but https://stray.example.com/x.") == []


def test_a_record_whose_address_cannot_be_cited_states_no_source():
    text = "\n\n---\n\n".join(
        [
            _record("http://www.oib.or.at/de/inkrafttreten-2015", "Inkrafttreten", "…"),
            _record("https://localhost/admin", "Local", "…"),
            _record("https://frontend/api/internal/x", "Internal", "…"),
            _record("https://10.0.0.7/x", "Private", "…"),
            _record("https://ok.example.org/a", "Fine", "…"),
        ]
    )
    assert [entry.url for entry in parse_web_results(text, WEB_TOOL)] == ["https://ok.example.org/a"]


def test_a_signed_query_never_reaches_the_registry():
    signed = "https://bucket.example.com/doc.pdf?X-Amz-Signature=abc&amp;X-Amz-Expires=300"
    (entry,) = parse_web_results(_record(signed, "A document", "…"), WEB_TOOL)
    assert entry.url == "https://bucket.example.com/doc.pdf"


def test_one_address_is_one_source():
    text = _record("https://a.example.org/x", "A", "…") + "\n\n---\n\n" + _record("https://a.example.org/x", "A", "…")
    assert len(parse_web_results(text, WEB_TOOL)) == 1


def test_another_tool_s_text_still_falls_to_the_generic_extractor():
    """Only the web path changed: a tool with no parser keeps registering the addresses it returns."""
    entries = extract_sources_from_tool_result("paper_search", "1. **A paper** (2024)\nhttps://papers.example.org/1")
    assert [entry.url for entry in entries] == ["https://papers.example.org/1"]
