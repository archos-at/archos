from __future__ import annotations

import logging
import re
from collections.abc import Iterator

from agent.citations.citation_keys import PAGE_RE
from agent.citations.citation_keys import SCOPE_QUALIFIER_TOKEN_RE
from agent.citations.citation_keys import TITLE_PAGE_RE
from agent.citations.citation_keys import parse_citation_key
from agent.citations.entries import SourceEntry
from agent.citations.markdown_code import code_spans
from agent.citations.markdown_code import inside
from agent.citations.registry import SourceRegistry
from agent.common.source_kinds import shelf_for_qualifier
from agent.common.source_kinds import shelf_qualifier

logger = logging.getLogger(__name__)


_GERMAN_REFERENCE_HEADING_LABEL_PATTERN = r"(?:Quellen(?:verzeichnis|angaben)?|Literatur(?:verzeichnis)?|Referenzen)"


_REFERENCE_HEADING_LABEL_PATTERN = (
    r"(?:Sources|References|Reference[^\S\n]+List|" + _GERMAN_REFERENCE_HEADING_LABEL_PATTERN + r")"
)


GERMAN_REFERENCE_HEADING_LABEL_RE = re.compile(
    rf"{_GERMAN_REFERENCE_HEADING_LABEL_PATTERN}[^\S\n]*:?[^\S\n]*\**[^\S\n]*$", re.IGNORECASE
)


_REFERENCE_HEADING_PATTERN = (
    r"^[^\S\n]*(?:"
    rf"#{{1,3}}[^\S\n]+{_REFERENCE_HEADING_LABEL_PATTERN}[^\S\n]*:?"
    rf"|\*\*{_REFERENCE_HEADING_LABEL_PATTERN}:?\*\*"
    rf"|{_REFERENCE_HEADING_LABEL_PATTERN}[^\S\n]*:?"
    r")[^\S\n]*$"
)


_REFERENCE_ENTRY_START_PATTERN = r"(?:[-*][^\S\n]*)?(?:\[\d+\]|\[\^\d+\]:?|\d+[.)])[^\S\n]+"


REFERENCE_SECTION_RE = re.compile(
    rf"{_REFERENCE_HEADING_PATTERN}(?=\n[^\S\n]*(?:\n[^\S\n]*)*{_REFERENCE_ENTRY_START_PATTERN})",
    re.MULTILINE | re.IGNORECASE,
)


REFERENCE_HEADING_LINE_RE = re.compile(_REFERENCE_HEADING_PATTERN, re.IGNORECASE)


CITATION_LINE_RE = re.compile(r"^\s*[-*]?\s*\[(\d+)\]\s*(.+)$", re.MULTILINE)


ORDERED_REFERENCE_LINE_RE = re.compile(r"^(\s*)(\d+)[.)]\s+(.+)$", re.MULTILINE)


COLLAPSED_SOURCE_BOUNDARY_RE = re.compile(r"\s+(?=\[(\d+)\]\s+)")


INLINE_CITATION_RE = re.compile(r"\[(\d+)\]")


_GROUPED_CITATION_RE = re.compile(r"(?<!\[)\[([1-9]\d{0,2}(?:\s*[,–-]\s*[1-9]\d{0,2})+)\](?![\](])")


_MAX_CITATION_RANGE = 20


def expand_grouped_citations(text: str, *, unterminated_fence_is_code: bool = False) -> str:
    code = code_spans(text, unterminated_fence_is_code=unterminated_fence_is_code)

    def expand(match: re.Match) -> str:
        if inside(match.start(), code):
            return match.group(0)
        numbers: list[int] = []
        for part in re.split(r"\s*,\s*", match.group(1)):
            bounds = [int(bound) for bound in re.split(r"\s*[–-]\s*", part)]
            if len(bounds) == 1:
                numbers.append(bounds[0])
                continue
            low, high = bounds[0], bounds[-1]
            if len(bounds) != 2 or not 0 < low < high or high - low > _MAX_CITATION_RANGE:
                return match.group(0)
            numbers.extend(range(low, high + 1))
        return "".join(f"[{number}]" for number in dict.fromkeys(numbers))

    return _GROUPED_CITATION_RE.sub(expand, text)


FOOTNOTE_REFERENCE_LINE_RE = re.compile(r"^\s*\[\^(\d+)\]:?\s*", re.MULTILINE)


FOOTNOTE_INLINE_CITATION_RE = re.compile(r"\[\^(\d+)\]")


SOURCE_LOCATION_CITATION_RE = re.compile(r"\[(\d+)\s*†[^\]]+\]")


URL_IN_LINE_RE = re.compile(r"https?://\S+")


KL_CITATION_PATTERN_RE = re.compile(r"^(.+\.\w{2,5})(?:,\s*(?:p\.?|page)\s*\d+)?$", re.IGNORECASE)


_FILENAME_INNER_CHARS = "_-."


def _filename_token_ends(haystack_lower: str, needle_lower: str) -> Iterator[int]:
    index = haystack_lower.find(needle_lower)
    while index != -1:
        end = index + len(needle_lower)
        before_ok = index == 0 or not (
            haystack_lower[index - 1].isalnum() or haystack_lower[index - 1] in _FILENAME_INNER_CHARS
        )
        after_ok = end >= len(haystack_lower) or not (haystack_lower[end].isalnum() or haystack_lower[end] in "_-")
        if before_ok and after_ok:
            yield end
        index = haystack_lower.find(needle_lower, index + 1)


def _filename_occurs_as_token(haystack_lower: str, needle_lower: str) -> int | None:
    return next(_filename_token_ends(haystack_lower, needle_lower), None)


def document_identity(entry: SourceEntry) -> tuple[str | None, str]:
    collection, filename, _page = SourceRegistry._identity(entry)
    return collection, filename


def _match_registry_filename(ref_text: str, registry: SourceRegistry) -> str | None:
    lowered = ref_text.lower()
    best_name: str | None = None
    best_end = 0
    for entry in registry._citation_keys:
        entry_file, _ = parse_citation_key(entry.citation_key or "")
        if not entry_file:
            continue
        end = _filename_occurs_as_token(lowered, entry_file.lower())
        if end is None:
            continue
        if best_name is None or len(entry_file) > len(best_name):
            best_name, best_end = entry_file, end
    if best_name is None:
        return None

    tail = ref_text[best_end:]
    qualifier = ""
    qualifier_match = SCOPE_QUALIFIER_TOKEN_RE.match(tail)
    if qualifier_match:
        label = shelf_qualifier(shelf_for_qualifier(qualifier_match.group(1)))
        if label:
            qualifier = f" ({label})"
            tail = tail[qualifier_match.end() :]
    page_match = PAGE_RE.search(tail)
    name = f"{best_name}{qualifier}"
    return f"{name}, p.{page_match.group(1)}" if page_match else name


_MIN_TITLE_HEAD_CHARS = 10


def _title_occurs_as_token(haystack_lower: str, title_lower: str) -> int | None:
    start = 0
    while True:
        at = haystack_lower.find(title_lower, start)
        if at == -1:
            return None
        end = at + len(title_lower)
        before_ok = at == 0 or not haystack_lower[at - 1].isalnum()
        after = haystack_lower[end : end + 1]
        after_ok = after == "" or after in ",;:)]" or after.isspace()
        if before_ok and after_ok:
            return end
        start = at + 1


def _registry_titles(entry: SourceEntry) -> list[str]:
    title = (entry.title or "").strip()
    if not title:
        return []
    names = [title]
    head = title.split(",", 1)[0].strip()
    if head != title and len(head) >= _MIN_TITLE_HEAD_CHARS:
        names.append(head)
    return names


def _match_registry_title(ref_text: str, registry: SourceRegistry) -> str | None:
    lowered = ref_text.lower()
    matches: dict[str, set[str]] = {}
    ends: dict[str, int] = {}
    for entry in registry._citation_keys:
        entry_file, _ = parse_citation_key(entry.citation_key or "")
        if not entry_file:
            continue
        for name in _registry_titles(entry):
            end = _title_occurs_as_token(lowered, name.lower())
            if end is None:
                continue
            matches.setdefault(name.lower(), set()).add(entry_file)
            ends[name.lower()] = end
    unambiguous = [(name, files) for name, files in matches.items() if len(files) == 1]
    if not unambiguous:
        return None
    name, files = max(unambiguous, key=lambda item: len(item[0]))
    entry_file = next(iter(files))
    page_match = TITLE_PAGE_RE.search(ref_text[ends[name] :])
    return f"{entry_file}, p.{page_match.group(1)}" if page_match else entry_file


_TITLE_PREFIX_SEPARATOR_RE = re.compile(r"\s+[-\u2013\u2014]\s+|:\s+")


def _title_prefix_tails(text: str) -> list[str]:
    tails: list[str] = []
    for match in _TITLE_PREFIX_SEPARATOR_RE.finditer(text):
        tail = text[match.end() :].strip()
        if tail:
            tails.append(tail)
    return sorted(set(tails), key=len)


def is_digest_shaped_line(ref_text: str) -> bool:
    parts = [part.strip() for part in ref_text.split("|")]
    if len(parts) < 5:
        return False
    lowered = [part.lower() for part in parts[-3:]]
    return lowered[0].startswith("seiten ") and lowered[1].startswith("punkte ") and lowered[2].startswith("turn ")


_LEADING_LINK_PREFIX = r"^(\s*(?:[-*]\s*)?(?:\[\d+\]\s*)?(?:\[(?:KB|RIS|Web)\]\s*)?)"


_LINK_LABEL = r"(?:(?:Source|Quelle|Fundstelle|Link)(?:[ \t]+URL)?|URL)[ \t]*:[ \t]*"


_LINK_SEPARATOR = r"[-–—:,|]"


def drop_url(text: str, url: str) -> str:
    escaped = re.escape(url)
    text = re.sub(rf"\[([^\]]*)\]\({escaped}\)", r"\1", text)
    text, leading = re.subn(
        rf"{_LEADING_LINK_PREFIX}[<(\[]?{escaped}[>)\]]?\s*(?:{_LINK_SEPARATOR}\s*)?", r"\1", text, flags=re.IGNORECASE
    )
    if leading:
        return text.rstrip()
    labelled = rf"(?:{_LINK_LABEL})?<?{escaped}>?"
    text, shared = re.subn(rf"\(\s*{labelled}\s*,\s*", "(", text, flags=re.IGNORECASE)
    if not shared:
        text, shared = re.subn(rf"\s*,\s*{labelled}\s*\)", ")", text, flags=re.IGNORECASE)
    if not shared:
        link = rf"(?:\(\s*{labelled}\s*\)|(?:{_LINK_LABEL})?[<(\[]?{escaped}[>)\]]?)"
        text = re.sub(rf"\s*(?:{_LINK_SEPARATOR}\s*)?{link}", "", text, flags=re.IGNORECASE)
    return text.rstrip()


def is_knowledge_citation(ref_text: str, registry: SourceRegistry | None = None) -> tuple[bool, str | None]:
    unemphasized = re.sub(r"\*+", "", ref_text).strip()

    if registry is not None:
        matched = _match_registry_filename(unemphasized, registry) or _match_registry_title(unemphasized, registry)
        if matched:
            return True, matched

    cleaned = re.sub(r"\s*\(.*?\)\s*$", "", unemphasized).strip()
    for segment in [*_title_prefix_tails(cleaned), cleaned]:
        if KL_CITATION_PATTERN_RE.match(segment):
            return True, segment

    return False, None
