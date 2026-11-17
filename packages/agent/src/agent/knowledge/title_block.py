from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable
from collections.abc import Mapping
from collections.abc import Sequence
from datetime import date
from typing import Any

TITLE_BLOCK_FIELDS = ("document_number", "revision", "revision_date", "scale", "title")

_MAX_LENGTHS = {"document_number": 60, "revision": 16, "revision_date": 10, "scale": 40, "title": 200}

_MIN_KEY_CHARS = 3

_EMPTY_WORDS = frozenset({"-", "–", "—", "n/a", "na", "null", "none", "unbekannt", "unknown", "keine", "k.a."})

_REVISION_PREFIX = re.compile(r"^(?:index|idx|ind|revision|rev|version|ver|stand)\b\.?[\s:_-]*", re.IGNORECASE)
_ISO = re.compile(r"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)")
_DOTTED = re.compile(r"(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})(?!\d)")
_LETTER = re.compile(r"[A-Za-z]")
_NUMBER = re.compile(r"\d{1,3}")


def _text(value: Any, limit: int) -> str | None:
    if value is None or isinstance(value, (dict, list, bool)):
        return None
    text = " ".join(str(value).split())
    if not text or text.casefold() in _EMPTY_WORDS:
        return None
    return text[:limit].rstrip()


def normalise_date(value: Any) -> str | None:
    text = _text(value, 40)
    if text is None:
        return None
    if match := _ISO.search(text):
        year, month, day = (int(part) for part in match.groups())
    elif match := _DOTTED.search(text):
        day, month, raw_year = match.groups()
        day, month = int(day), int(month)
        year = int(raw_year) + (2000 if len(raw_year) == 2 else 0)
    else:
        return None
    try:
        return date(year, month, day).isoformat()
    except ValueError:
        return None


def normalise_revision(value: Any) -> str | None:
    text = _text(value, 40)
    if text is None:
        return None
    text = _REVISION_PREFIX.sub("", text).strip(" .:")
    if not text or text.casefold() in _EMPTY_WORDS:
        return None
    return text[: _MAX_LENGTHS["revision"]]


def normalise_revision_facts(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, Mapping):
        return None
    facts: dict[str, Any] = {}
    for key in TITLE_BLOCK_FIELDS:
        if key == "revision":
            value = normalise_revision(raw.get(key))
        elif key == "revision_date":
            value = normalise_date(raw.get(key))
        else:
            value = _text(raw.get(key), _MAX_LENGTHS[key])
        if value:
            facts[key] = value
    if not facts:
        return None
    page = raw.get("page")
    if isinstance(page, int) and not isinstance(page, bool) and page >= 1:
        facts["page"] = page
    return facts


def identifies_document(facts: Mapping[str, Any] | None) -> bool:
    return bool(facts) and any(facts.get(key) for key in ("document_number", "revision", "revision_date"))


def document_key(number: Any) -> str | None:
    if not isinstance(number, str):
        return None
    folded = unicodedata.normalize("NFKC", number).casefold()
    key = re.sub(r"[^0-9a-zäöüß]", "", folded)
    return key if len(key) >= _MIN_KEY_CHARS and any(ch.isdigit() for ch in key) else None


def same_document(first: Mapping[str, Any] | None, second: Mapping[str, Any] | None) -> bool:
    if not first or not second:
        return False
    key = document_key(first.get("document_number"))
    return key is not None and key == document_key(second.get("document_number"))


def revision_rank(revision: Any) -> tuple[str, int] | None:
    if not isinstance(revision, str):
        return None
    text = revision.strip()
    if len(text) == 1 and _LETTER.fullmatch(text):
        return "letter", ord(text.upper()) - ord("A") + 1
    if _NUMBER.fullmatch(text):
        return "number", int(text)
    return None


def _sign(left: Any, right: Any) -> int:
    return (left > right) - (left < right)


def compare_revisions(first: Mapping[str, Any] | None, second: Mapping[str, Any] | None) -> int | None:
    first, second = first or {}, second or {}
    rank_a, rank_b = revision_rank(first.get("revision")), revision_rank(second.get("revision"))
    by_index = _sign(rank_a[1], rank_b[1]) if rank_a and rank_b and rank_a[0] == rank_b[0] else None
    if by_index:
        return by_index
    date_a, date_b = first.get("revision_date"), second.get("revision_date")
    by_date = _sign(date_a, date_b) if date_a and date_b else None
    if by_date:
        return by_date
    return 0 if by_index == 0 or by_date == 0 else None


def newest_first[T](
    items: Sequence[T],
    facts_of: Callable[[T], Mapping[str, Any] | None],
    tiebreak: Callable[[T], str],
) -> list[T]:
    ranks = [revision_rank((facts_of(item) or {}).get("revision")) for item in items]
    kinds = {rank[0] if rank else None for rank in ranks}
    index_leads = len(kinds) == 1 and None not in kinds

    def key(item: T) -> tuple[int, str, int, str]:
        facts = facts_of(item) or {}
        rank = revision_rank(facts.get("revision"))
        value = rank[1] if rank else 0
        return (value if index_leads else 0, str(facts.get("revision_date") or ""), value, tiebreak(item))

    return sorted(items, key=key, reverse=True)


def display_date(iso: str) -> str:
    match = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", iso or "")
    return f"{match.group(3)}.{match.group(2)}.{match.group(1)}" if match else iso


def title_block_label(facts: Mapping[str, Any] | None) -> str:
    if not facts:
        return ""
    parts = []
    if facts.get("document_number"):
        parts.append(f"Nr. {facts['document_number']}")
    if facts.get("revision"):
        parts.append(f"Index {facts['revision']}")
    if facts.get("revision_date"):
        parts.append(f"Stand {display_date(str(facts['revision_date']))}")
    return ", ".join(parts)
