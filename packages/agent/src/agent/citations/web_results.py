from __future__ import annotations

import re
from html import unescape

from agent.citations.entries import SourceEntry
from agent.citations.entries import normalize_url
from agent.common.url_safety import is_citable_url
from agent.common.url_safety import strip_signed_query

_RECORD_RE = re.compile(
    r'^<Document href="(?P<url>[^"\n]*)">\n<title>\n(?P<title>.*?)\n</title>$',
    re.MULTILINE | re.DOTALL,
)


def is_web_search_tool(tool_name: str) -> bool:
    return "web_search" in tool_name


def parse_web_results(content: str, tool_name: str) -> list[SourceEntry]:
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
