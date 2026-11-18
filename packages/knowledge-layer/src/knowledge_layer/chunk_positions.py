from __future__ import annotations

import re
from collections.abc import Iterator
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

BREADCRUMB_SEP = " › "

MAX_OVERLAP_CHARS = 1_200

MIN_OVERLAP_WORDS = 8
MIN_OVERLAP_CHARS = 40

MAX_LEGACY_PAGE_CHUNKS = 32

_MARKER = re.compile(r"\[(?:TABLE|DRAWING) from page \d+\](?: \(Teil \d+ von \d+\))?\n\n")
_PART_SUFFIX = re.compile(r" \(Teil \d+ von \d+\)$")


@dataclass(frozen=True)
class OwnText:
    text: str
    repeat_start: int = 0
    repeat_end: int = 0

    def counts(self, start: int, end: int) -> bool:
        if end <= start:
            return False
        return not (self.repeat_start <= start and end <= self.repeat_end and self.repeat_end > self.repeat_start)


def words_with_offsets(text: str) -> list[tuple[str, int]]:
    return [(match.group(), match.start()) for match in re.finditer(r"\S+", text)]


def repeated_head(previous: str, text: str) -> int:
    after = words_with_offsets(text[: MAX_OVERLAP_CHARS + 1])
    if len(after) <= MIN_OVERLAP_WORDS:
        return 0
    tail = previous[-(MAX_OVERLAP_CHARS * 2) :]
    before = [word for word, _ in words_with_offsets(tail)]
    if len(tail) < len(previous):
        before = before[1:]  # the slice may have cut its first word in two
    words = [word for word, _ in after]
    longest = min(len(before), len(after) - 1)
    for count in range(longest, MIN_OVERLAP_WORDS - 1, -1):
        if before[-count] != words[0] or before[-count:] != words[:count]:
            continue
        end = after[count][1]
        return end if MIN_OVERLAP_CHARS <= end <= MAX_OVERLAP_CHARS else 0
    return 0


def _metadata(chunk: Any) -> dict[str, Any]:
    return getattr(chunk, "metadata", None) or {}


def _int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    try:
        return int(str(value))
    except TypeError, ValueError:
        return None


def _first_part(metadata: dict[str, Any], key: str) -> bool:
    part = _int(metadata.get(key))
    return part is None or part == 1


def _section_prefix(text: str, metadata: dict[str, Any]) -> tuple[int, str]:
    path = str(metadata.get("clause_path") or "")
    if not path or not (text == path or text.startswith(f"{path}\n\n")):
        return 0, ""
    heading = path.rsplit(BREADCRUMB_SEP, 1)[-1] if _first_part(metadata, "section_part") else ""
    return min(len(text), len(path) + 2), heading


def _clause_prefix(text: str, metadata: dict[str, Any]) -> tuple[int, str]:
    path = str(metadata.get("clause_path") or "")
    clause_id = str(metadata.get("clause_id") or "")
    head, separator, rest = text.partition("\n\n")
    if not separator or not clause_id or not rest.lstrip().startswith(clause_id):
        return 0, ""
    lines = head.split("\n")
    ancestors = path.rsplit(BREADCRUMB_SEP, 1)[0] if BREADCRUMB_SEP in path else None
    if lines != lines[:1] + ([ancestors] if ancestors else []):
        return 0, ""
    return len(head) + 2, ""


def _table_prefix(text: str, metadata: dict[str, Any]) -> tuple[int, str]:
    caption = str(metadata.get("clause_path") or "")
    head, separator, _rest = text.partition("\n\n")
    if not separator or not caption:
        return 0, ""
    lines = head.split("\n")
    if len(lines) > 2 or _PART_SUFFIX.sub("", lines[-1]) != caption:
        return 0, ""
    return len(head) + 2, caption if _first_part(metadata, "table_part") else ""


def split_prefix(chunk: Any) -> tuple[int, str]:
    text = getattr(chunk, "content", "") or ""
    metadata = _metadata(chunk)
    chunking = metadata.get("chunking")
    if chunking == "section":
        return _section_prefix(text, metadata)
    if chunking == "clause":
        return _clause_prefix(text, metadata)
    if chunking == "table":
        return _table_prefix(text, metadata)
    marker = _MARKER.match(text)
    return (marker.end(), "") if marker else (0, "")


def body(chunk: Any) -> str:
    start, _heading = split_prefix(chunk)
    return (getattr(chunk, "content", "") or "")[start:]


def _is_text(chunk: Any) -> bool:
    kind = getattr(chunk, "content_type", None)
    return getattr(kind, "value", kind) in (None, "text")


def _key(chunk: Any) -> tuple[str, str, str]:
    metadata = _metadata(chunk)
    return (
        str(metadata.get("collection") or ""),
        str(getattr(chunk, "file_name", "") or ""),
        str(metadata.get("chunking")),
    )


def _ordinal(chunk: Any) -> int | None:
    return _int(_metadata(chunk).get("chunk_ordinal"))


def _predecessors(chunks: Sequence[Any]) -> dict[int, Any]:
    by_ordinal: dict[tuple[tuple[str, str, str], int], Any] = {}
    legacy: dict[tuple[tuple[str, str, str], Any], list[Any]] = {}
    for chunk in chunks:
        if not _is_text(chunk):
            continue
        ordinal = _ordinal(chunk)
        if ordinal is not None:
            by_ordinal[(_key(chunk), ordinal)] = chunk
        else:
            legacy.setdefault((_key(chunk), getattr(chunk, "page_number", None)), []).append(chunk)
    found: dict[int, Any] = {}
    for index, chunk in enumerate(chunks):
        if not _is_text(chunk):
            continue
        ordinal = _ordinal(chunk)
        if ordinal is not None:
            previous = by_ordinal.get((_key(chunk), ordinal - 1))
        else:
            previous = _legacy_predecessor(chunk, legacy.get((_key(chunk), getattr(chunk, "page_number", None)), []))
        if previous is not None:
            found[index] = previous
    return found


def _legacy_predecessor(chunk: Any, page: Sequence[Any]) -> Any:
    if len(page) > MAX_LEGACY_PAGE_CHUNKS:
        return None
    mine = body(chunk)
    best, longest = None, 0
    for other in page:
        if other is chunk:
            continue
        cut = repeated_head(body(other), mine)
        if cut > longest:
            best, longest = other, cut
    return best


def own_text(chunk: Any, previous: Any = None) -> OwnText:
    start, heading = split_prefix(chunk)
    text = (getattr(chunk, "content", "") or "")[start:]
    lead = f"{heading}\n" if heading else ""
    cut = repeated_head(body(previous), text) if previous is not None else 0
    return OwnText(f"{lead}{text}", len(lead), len(lead) + cut)


def own_texts(chunks: Sequence[Any]) -> list[OwnText]:
    previous = _predecessors(chunks)
    return [own_text(chunk, previous.get(index)) for index, chunk in enumerate(chunks)]


def own_matches(own: OwnText, pattern: Any, timeout: float | None = None) -> Iterator[Any]:
    found = pattern.finditer(own.text) if timeout is None else pattern.finditer(own.text, timeout=timeout)
    return (match for match in found if own.counts(match.start(), match.end()))
