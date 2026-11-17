"""A web search's sources are its result records, never every address in its text.

The search tool states each hit as one record: ``<Document href="…">``, a ``<title>`` block, an optional
``<source_note>`` and the page's text (``tavily_web_search.register._record``). The record header is the
tool's own statement of what it returned; the text under it is the page's, and a link in a page's body is
an address the turn never read. Until this parser, a web result went to the generic extractor, which
registered every URL in the output as a citable source (the page's outbound links, the provider's summary).

The tool defuses record tags inside a page's text and title, so a page cannot write a record of its own.
An address that may not be shown as a source (``common.url_safety``: not https, a local or internal host)
states no source, and a signed query is taken off the address that is kept.
"""

from __future__ import annotations

import re
from html import unescape

from agent.citations.entries import SourceEntry
from agent.citations.entries import normalize_url
from agent.common.url_safety import is_citable_url
from agent.common.url_safety import strip_signed_query

#: One record header, at the start of a line: the address, then the title block the tool always prints.
_RECORD_RE = re.compile(
    r'^<Document href="(?P<url>[^"\n]*)">\n<title>\n(?P<title>.*?)\n</title>$',
    re.MULTILINE | re.DOTALL,
)


def is_web_search_tool(tool_name: str) -> bool:
    """Whether a (lower-cased) tool name is a web search: every configured instance carries ``web_search``."""
    return "web_search" in tool_name


def parse_web_results(content: str, tool_name: str) -> list[SourceEntry]:
    """The sources a web search's text states: one per result record, in order, each address once."""
    seen: set[str] = set()
    entries: list[SourceEntry] = []
    for record in _RECORD_RE.finditer(content):
        url = strip_signed_query(unescape(record.group("url")).strip())
        if not url or not is_citable_url(url):
            continue
        normalized = normalize_url(url)
        if normalized in seen:
            continue
        seen.add(normalized)
        title = record.group("title").strip()
        entries.append(
            SourceEntry(
                url=url,
                title=title if title and title != "None" else None,
                source_type="generic",
                tool_name=tool_name,
            )
        )
    return entries
