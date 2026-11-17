from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from dataclasses import field
from urllib.parse import urlparse

from agent.citations.entries import normalize_url
from agent.citations.extraction import URL_TRIM_CHARS
from agent.citations.markdown_code import map_outside_code
from agent.citations.references import CITATION_LINE_RE
from agent.citations.references import REFERENCE_SECTION_RE
from agent.citations.report_layout import normalize_citation_syntax
from agent.citations.report_layout import normalize_source_section_layout
from agent.citations.report_layout import renumber_citations
from agent.common.url_safety import host_problem
from agent.common.url_safety import strip_signed_query

logger = logging.getLogger(__name__)


_SHORTENER_DOMAINS = frozenset(
    {
        "bit.ly",
        "tinyurl.com",
        "t.co",
        "goo.gl",
        "ow.ly",
        "is.gd",
        "buff.ly",
        "short.io",
        "rb.gy",
        "cutt.ly",
        "lnkd.in",
        "soo.gd",
        "s.coop",
        "cli.gs",
        "budurl.com",
        "yourls.org",
    }
)


_TRUNCATED_URL_RE = re.compile(r"\.\.\.$|…$")  # ends in ... or ellipsis


_SUSPICIOUS_SCHEMES_RE = re.compile(r"^(?:javascript|data|vbscript|file):", re.IGNORECASE)


_BARE_URL_RE = re.compile(r"https?://[^\s<>\"'\]]+")


_MD_LINK_RE = re.compile(r"\[([^\]]*)\]\(\s*\w+://[^\s)]+\)")


_BODY_URL_RE = re.compile(r"\w+://[^\s<>\"'\]]+")


_SPACE_BEFORE_PUNCTUATION_RE = re.compile(r"(?<=\S)[ \t]+(?=[.,;!?]|:(?![^\W\d_]|:))")


@dataclass
class ReportSanitizationResult:

    sanitized_report: str
    body_urls_removed: int
    body_urls_replaced: int
    shortened_urls_removed: list[str]
    truncated_urls_removed: list[str]
    unsafe_urls_removed: list[str]
    renumber_map: dict[int, int] = field(default_factory=dict)
    removed_citation_numbers: set[int] = field(default_factory=set)


def sanitize_report(report_text: str) -> ReportSanitizationResult:
    report_text = normalize_citation_syntax(report_text)

    ref_match = REFERENCE_SECTION_RE.search(report_text)
    if ref_match:
        body = report_text[: ref_match.start()]
        ref_section = normalize_source_section_layout(report_text[ref_match.start() :])
    else:
        body = report_text
        ref_section = ""

    body_urls = _BodyUrls(ref_section)
    cleaned_body = body_urls.clean(body)

    vetted = _vet_source_urls(ref_section)
    ref_section = vetted.ref_section
    for num in vetted.removed_numbers:
        cleaned_body = re.sub(rf"\[{num}\]", "", cleaned_body)

    renumber_map: dict[int, int] = {}
    if ref_section:
        cleaned_body, ref_section, renumber_map = renumber_citations(cleaned_body, ref_section)

    sanitized_report = _strip_tool_call_fragments(cleaned_body + ref_section)
    if ref_section:
        sanitized_report = _trim_after_last_citation(sanitized_report)

    return ReportSanitizationResult(
        sanitized_report=sanitized_report,
        body_urls_removed=body_urls.removed,
        body_urls_replaced=body_urls.replaced,
        shortened_urls_removed=vetted.shortened,
        truncated_urls_removed=vetted.truncated,
        unsafe_urls_removed=vetted.unsafe,
        renumber_map=renumber_map,
        removed_citation_numbers=vetted.removed_numbers,
    )


def _normalized(raw_url: str) -> str | None:
    try:
        return normalize_url(raw_url.rstrip(URL_TRIM_CHARS))
    except ValueError:
        return None


class _BodyUrls:

    def __init__(self, ref_section: str) -> None:
        self.removed = 0
        self.replaced = 0
        self._url_to_citation: dict[str, int] = {}
        for m in CITATION_LINE_RE.finditer(ref_section):
            url_m = _BARE_URL_RE.search(m.group(2))
            normalized = _normalized(url_m.group(0)) if url_m else None
            if normalized is not None:
                self._url_to_citation[normalized] = int(m.group(1))

    def clean(self, body: str) -> str:
        cleaned = map_outside_code(
            body,
            lambda segment: _MD_LINK_RE.sub(r"\1", segment),
            include_inline=False,
            unterminated_fence_is_code=False,
        )
        cleaned = map_outside_code(cleaned, self._clean_prose, unterminated_fence_is_code=False)
        if self.replaced:
            logger.debug("[ReportSanitize] Replaced %d body URL(s) with citation numbers", self.replaced)
        if self.removed:
            logger.debug("[ReportSanitize] Removed %d unmatched URL(s) from report body", self.removed)
        return cleaned

    def _replace_url(self, match: re.Match) -> str:
        normalized = _normalized(match.group(0))
        if normalized is not None and normalized in self._url_to_citation:
            self.replaced += 1
            return f"[{self._url_to_citation[normalized]}]"
        self.removed += 1
        return ""

    def _clean_prose(self, segment: str) -> str:
        segment = _BODY_URL_RE.sub(self._replace_url, segment)
        segment = re.sub(r"\(\s*\)", "", segment)
        segment = re.sub(r"(?<=\S)  +", " ", segment)
        return _SPACE_BEFORE_PUNCTUATION_RE.sub("", segment)


@dataclass
class _VettedSources:

    ref_section: str
    removed_numbers: set[int] = field(default_factory=set)
    shortened: list[str] = field(default_factory=list)
    truncated: list[str] = field(default_factory=list)
    unsafe: list[str] = field(default_factory=list)
    signed_queries_stripped: int = 0


def _url_problem(line: str, url_match: re.Match) -> tuple[str, str] | None:
    url = url_match.group(0).rstrip(URL_TRIM_CHARS)
    if _SUSPICIOUS_SCHEMES_RE.search(line):
        return "unsafe", url
    try:
        parsed = urlparse(url)
    except ValueError:  # an IPv6 literal the URL pattern cut at its bracket
        return "unsafe", url_match.group(0)
    bare_domain = parsed.netloc.lower().split(":")[0]
    if bare_domain.startswith("www."):
        bare_domain = bare_domain[4:]
    if bare_domain in _SHORTENER_DOMAINS:
        return "shortened", url
    raw_url = url_match.group(0)
    if _TRUNCATED_URL_RE.search(raw_url) or "…" in raw_url:
        return "truncated", raw_url
    if host_problem(url) is not None:
        return "unsafe", url
    return None


def _without_signed_query(line: str, url_match: re.Match, vetted: _VettedSources) -> str:
    url = url_match.group(0).rstrip(URL_TRIM_CHARS)
    stripped = strip_signed_query(url)
    if stripped == url:
        return line
    vetted.signed_queries_stripped += 1
    return line[: url_match.start()] + stripped + line[url_match.start() + len(url) :]


def _vet_source_urls(ref_section: str) -> _VettedSources:
    vetted = _VettedSources(ref_section=ref_section)
    if not ref_section:
        return vetted
    ref_lines = ref_section.split("\n")
    kept: list[str] = []
    for line in ref_lines:
        url_match = _BARE_URL_RE.search(line)
        problem = _url_problem(line, url_match) if url_match else None
        if problem is None:
            kept.append(_without_signed_query(line, url_match, vetted) if url_match else line)
            continue
        kind, url = problem
        getattr(vetted, kind).append(url)
        if line_m := CITATION_LINE_RE.match(line):
            vetted.removed_numbers.add(int(line_m.group(1)))
    if kept != ref_lines:
        vetted.ref_section = "\n".join(kept)
    for kind, what in (("shortened", "shortened"), ("truncated", "truncated/incomplete"), ("unsafe", "unsafe")):
        if urls := getattr(vetted, kind):
            logger.debug("[ReportSanitize] Removed %d %s URL(s) from references: %s", len(urls), what, urls)
    return vetted


def _strip_tool_call_fragments(report: str) -> str:
    return re.sub(
        r"</?(parameter|function|tool_call|tool_use|invoke|antml:[\w]+)[\s>].*",
        "",
        report,
        flags=re.DOTALL,
    )


def _trim_after_last_citation(report: str) -> str:
    last_citation_end = None
    for m in CITATION_LINE_RE.finditer(report):
        last_citation_end = m.end()
    if last_citation_end is None:
        return report
    return report[:last_citation_end].rstrip() + "\n"
