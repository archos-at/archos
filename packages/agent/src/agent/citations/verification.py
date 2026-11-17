from __future__ import annotations

import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass
from dataclasses import field

from agent.citations.citation_keys import parse_citation_key
from agent.citations.citation_keys import path_in_citation
from agent.citations.entries import DUPLICATE_REASON_PREFIX
from agent.citations.entries import LOCUS_MISMATCH_REASON
from agent.citations.entries import NO_SOURCE_REASON
from agent.citations.entries import CitationVerificationResult
from agent.citations.entries import SourceEntry
from agent.citations.extraction import URL_TRIM_CHARS
from agent.citations.references import CITATION_LINE_RE
from agent.citations.references import INLINE_CITATION_RE
from agent.citations.references import REFERENCE_SECTION_RE
from agent.citations.references import URL_IN_LINE_RE
from agent.citations.references import document_identity
from agent.citations.references import drop_url
from agent.citations.references import is_digest_shaped_line
from agent.citations.references import is_knowledge_citation
from agent.citations.registry import SourceRegistry
from agent.citations.report_layout import ORIGIN_TOKEN_RE
from agent.citations.report_layout import drop_inline_citations_not_in
from agent.citations.report_layout import drop_locus_mismatches
from agent.citations.report_layout import format_registry_reference
from agent.citations.report_layout import inject_origin_token
from agent.citations.report_layout import inline_citation_numbers
from agent.citations.report_layout import normalize_citation_syntax
from agent.citations.report_layout import normalize_source_section_layout
from agent.citations.source_identity import source_origin_token

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _LineSource:
    url: str | None = None
    citation_key: str | None = None
    line_url: str | None = None
    reason: str | None = None

    def entry(self, registry: SourceRegistry) -> SourceEntry | None:
        if self.url:
            return registry.entry_for_url(self.url)
        return registry.entry_for_citation_key(self.citation_key) if self.citation_key else None


def resolve_source_line(match_text: str, registry: SourceRegistry) -> _LineSource:
    if is_digest_shaped_line(match_text):
        return _LineSource(reason="digest_line_not_citable")
    url_match = URL_IN_LINE_RE.search(match_text)
    if url_match:
        url = url_match.group(0).rstrip(URL_TRIM_CHARS)
        if canonical := registry.resolve_url(url):
            return _LineSource(url=canonical, line_url=url)
        is_kl, citation_key = is_knowledge_citation(drop_url(match_text, url), registry)
        if is_kl and citation_key and registry.has_citation_key(citation_key):
            return _LineSource(citation_key=citation_key, line_url=url)
        return _LineSource(reason="url_not_in_registry")
    is_kl, citation_key = is_knowledge_citation(match_text, registry)
    if not (is_kl and citation_key):
        return _LineSource(reason="unverifiable")
    if not registry.has_citation_key(citation_key):
        return _LineSource(reason="citation_key_not_in_registry")
    return _LineSource(citation_key=citation_key)


def _rewrite_numbers(body: str, rewrites: dict[int, int]) -> str:
    for old_num, canonical_num in rewrites.items():
        body = re.sub(rf"\[{old_num}\]", f"[{canonical_num}]", body)
    return body


def _drop_without_sources(report_text: str) -> CitationVerificationResult:
    ref_match = REFERENCE_SECTION_RE.search(report_text)
    body = report_text[: ref_match.start()].rstrip() if ref_match else report_text
    numbers = sorted({int(number) for number in INLINE_CITATION_RE.findall(body)})
    if not numbers and ref_match is None:
        return CitationVerificationResult(verified_report=report_text)
    removed = [{"number": number, "line": "", "reason": NO_SOURCE_REASON} for number in numbers]
    return CitationVerificationResult(
        verified_report=drop_inline_citations_not_in(body, set()), removed_citations=removed
    )


def verify_citations(
    report_text: str,
    registry: SourceRegistry,
    *,
    reference_sources: Sequence[SourceEntry | None] | None = None,
    drop_unresolved: bool = False,
    check_locus: bool = False,
) -> CitationVerificationResult:
    report_text = normalize_citation_syntax(report_text)

    all_sources = registry.all_sources()
    if not all_sources:
        logger.debug("[CitationVerify] Skipping — registry is empty (no tool calls captured)")
        if drop_unresolved:
            return _drop_without_sources(report_text)
        return CitationVerificationResult(verified_report=report_text)

    logger.info(
        "[CitationVerify] Starting verification against %d registered source(s)",
        len(all_sources),
    )
    logger.debug(
        "[CitationVerify] Registered URLs: %s",
        [s.url for s in all_sources if s.url],
    )

    located = _locate_source_section(report_text, reference_sources)
    if isinstance(located, CitationVerificationResult):
        return located
    report_text, ref_start = located
    body = report_text[:ref_start]
    ref_section = normalize_source_section_layout(report_text[ref_start:])

    lines = _parse_source_lines(ref_section, registry)
    duplicate_rewrites = lines.dedupe()

    body = _rewrite_numbers(body, duplicate_rewrites)
    removed_numbers_for_locus: set[int] = set()
    if check_locus:
        body, removed_numbers_for_locus = lines.check_locus(body, registry)

    ref_section = _repair_urls(ref_section, lines.url_replacements)

    removed_numbers = {
        c["number"] for c in lines.removed if c.get("reason") != LOCUS_MISMATCH_REASON
    } | removed_numbers_for_locus
    cleaned_ref_section = lines.clean_section(ref_section, removed_numbers)
    if drop_unresolved and not CITATION_LINE_RE.search(cleaned_ref_section):
        cleaned_ref_section = ""
        body = body.rstrip()

    valid_numbers = {c["number"] for c in lines.valid}
    cleaned_body = drop_inline_citations_not_in(body, valid_numbers)

    logger.debug("[CitationVerify] Result: kept %d, removed %d", len(lines.valid), len(lines.removed))
    return CitationVerificationResult(
        verified_report=cleaned_body + cleaned_ref_section,
        removed_citations=lines.removed,
        valid_citations=lines.valid,
    )


def _locate_source_section(
    report_text: str, reference_sources: Sequence[SourceEntry | None] | None
) -> tuple[str, int] | CitationVerificationResult:
    ref_match = REFERENCE_SECTION_RE.search(report_text)
    if ref_match:
        return report_text, ref_match.start()
    if not INLINE_CITATION_RE.search(report_text):
        logger.warning("[CitationVerify] No source section found in report; skipping")
        return CitationVerificationResult(verified_report=report_text)

    if reference_sources is None:
        logger.warning(
            "[CitationVerify] No source section found; cannot safely synthesize sources "
            "without the writer-facing source list"
        )
        return CitationVerificationResult(verified_report=report_text)

    writer_sources = list(reference_sources)
    cited_numbers = sorted(inline_citation_numbers(report_text))
    reference_lines = [
        line
        for i in cited_numbers
        if 1 <= i <= len(writer_sources)
        if (entry := writer_sources[i - 1]) is not None and (line := format_registry_reference(i, entry))
    ]
    if not reference_lines:
        logger.warning("[CitationVerify] No source section found and no renderable writer-facing sources")
        return CitationVerificationResult(verified_report=drop_inline_citations_not_in(report_text, set()))

    logger.warning(
        "[CitationVerify] No source section found; appending %d inline-cited registered source(s)",
        len(reference_lines),
    )
    report_text = report_text.rstrip() + "\n\n## Sources\n" + "\n".join(reference_lines)
    ref_match = REFERENCE_SECTION_RE.search(report_text)
    if ref_match is None:
        return CitationVerificationResult(verified_report=report_text)
    return report_text, ref_match.start()


@dataclass
class _SourceLines:
    valid: list[dict] = field(default_factory=list)
    removed: list[dict] = field(default_factory=list)
    url_replacements: dict[str, str] = field(default_factory=dict)  # garbled_url -> canonical_url
    origin_tokens: dict[int, str] = field(default_factory=dict)
    dropped_urls: dict[int, str] = field(default_factory=dict)  # key-verified line -> the link it carried
    cited_paths: dict[int, tuple[str, str]] = field(default_factory=dict)

    def dedupe(self) -> dict[int, int]:
        seen_keys: dict[str, int] = {}  # canonical_key -> kept citation number
        duplicate_rewrites: dict[int, int] = {}  # duplicate_num -> canonical_num
        deduped_valid: list[dict] = []
        for c in self.valid:
            key = c["url"] or c["citation_key"]
            if key is None:
                deduped_valid.append(c)
                continue
            canonical_num = seen_keys.get(key)
            if canonical_num is None:
                seen_keys[key] = c["number"]
                deduped_valid.append(c)
                continue
            duplicate_rewrites[c["number"]] = canonical_num
            self.removed.append(
                {"number": c["number"], "line": c["line"], "reason": f"{DUPLICATE_REASON_PREFIX}{canonical_num}"}
            )
            logger.debug("[CitationVerify]   [%d] REMOVE — duplicate of [%d]: %s", c["number"], canonical_num, key)
        self.valid = deduped_valid
        return duplicate_rewrites

    def check_locus(self, body: str, registry: SourceRegistry) -> tuple[str, set[int]]:
        body, locus_removed, locus_gone = drop_locus_mismatches(body, self.valid, registry)
        self.removed.extend(
            {**record, "line": next((c["line"] for c in self.valid if c["number"] == record["number"]), "")}
            for record in locus_removed
        )
        self.valid = [c for c in self.valid if c["number"] not in locus_gone]
        return body, locus_gone

    def clean_section(self, ref_section: str, removed_numbers: set[int]) -> str:
        cleaned_ref_lines: list[str] = []
        for line in ref_section.split("\n"):
            line_match = CITATION_LINE_RE.match(line)
            if line_match:
                num = int(line_match.group(1))
                if num in removed_numbers:
                    continue
                if (dropped := self.dropped_urls.get(num)) is not None:
                    line = drop_url(line, dropped)
                if (cited := self.cited_paths.get(num)) is not None:
                    line = line.replace(*cited, 1)
                if (token := self.origin_tokens.get(num)) is not None:
                    line = inject_origin_token(line, token)
            cleaned_ref_lines.append(line)
        return "\n".join(cleaned_ref_lines)


def _parse_source_lines(ref_section: str, registry: SourceRegistry) -> _SourceLines:
    lines = _SourceLines()
    for line_match in CITATION_LINE_RE.finditer(ref_section):
        num = int(line_match.group(1))
        ref_text = line_match.group(2).strip()
        full_line = line_match.group(0)

        token_match = ORIGIN_TOKEN_RE.match(ref_text)
        already_tokenized = token_match is not None
        match_text = ref_text[token_match.end() :] if token_match else ref_text

        source = resolve_source_line(match_text, registry)
        if source.reason is not None:
            log = logger.info if source.reason == "url_not_in_registry" else logger.debug
            log("[CitationVerify]   [%d] REMOVE — %s: %s", num, source.reason, ref_text[:80])
            lines.removed.append({"number": num, "line": full_line, "reason": source.reason})
            continue
        logger.debug("[CitationVerify]   [%d] VALID  — %s", num, source.url or source.citation_key)
        lines.valid.append({"number": num, "url": source.url, "citation_key": source.citation_key, "line": full_line})
        if source.url and source.line_url and source.line_url != source.url:
            lines.url_replacements[source.line_url] = source.url
        if source.citation_key and source.line_url:
            lines.dropped_urls[num] = source.line_url
        if source.citation_key and (cited_path := path_in_citation(match_text)):
            lines.cited_paths[num] = (cited_path, parse_citation_key(source.citation_key)[0])
        if not already_tokenized and (entry := source.entry(registry)):
            if token := source_origin_token(entry):
                lines.origin_tokens[num] = token
    return lines


def _repair_urls(ref_section: str, url_replacements: dict[str, str]) -> str:
    for garbled, canonical in url_replacements.items():
        ref_section = re.sub(
            re.escape(garbled) + r"(?![\w\-./?=&%#~+])",
            lambda _m, url=canonical: url,
            ref_section,
        )
    return ref_section


def cited_document_entries(text: str, registry: SourceRegistry) -> list[SourceEntry]:
    if not text:
        return []
    normalized = normalize_citation_syntax(text)
    section_match = REFERENCE_SECTION_RE.search(normalized)
    if section_match is None:
        return []
    section = normalize_source_section_layout(normalized[section_match.start() :])
    cited: dict[tuple[str | None, str], SourceEntry] = {}
    for line in CITATION_LINE_RE.finditer(section):
        ref_text = line.group(2).strip()
        token = ORIGIN_TOKEN_RE.match(ref_text)
        source = resolve_source_line(ref_text[token.end() :] if token else ref_text, registry)
        if source.url or not source.citation_key:
            continue
        entry = registry.entry_for_citation_key(source.citation_key)
        if entry is not None:
            cited.setdefault(document_identity(entry), entry)
    order = {id(entry): index for index, entry in enumerate(registry._citation_keys)}
    return sorted(cited.values(), key=lambda entry: order.get(id(entry), len(order)))
