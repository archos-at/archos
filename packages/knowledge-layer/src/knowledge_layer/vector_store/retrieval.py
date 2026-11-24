from __future__ import annotations

import logging
import re
import time
from collections.abc import Mapping
from collections.abc import MutableMapping
from collections.abc import Sequence
from typing import Any

import regex
from qdrant_client import models

from .boost import parse_boost
from .payload import project_payload
from .schema import TEXT_FIELD
from .schema import TEXT_STEM_FIELD
from .scope import ScopeRead
from .scope import scope_filter
from .search import Hit
from .search import _alias as search_alias
from .search import exact_term
from .search import grouped_search
from .search import hybrid_search
from .store import get_store

BM25_FOLDED_STOPWORDS = frozenset({"daß", "für", "können", "könnte", "über", "während", "würde", "würden"})

_FILE_NAME = re.compile(
    r"[\w.-]+\.(?:pdf|docx?|xlsx?|pptx?|odt|ods|rtf|txt|md|csv|dwg|dxf|ifc|png|jpe?g|tiff?|eml|msg|zip)\b",
    re.IGNORECASE,
)


def bm25_candidates(query: str, extra_terms: Sequence[str] = ()) -> list[str]:
    from agent.common import german_text

    prose = _FILE_NAME.sub(" ", query)
    spellings = (german_text.umlaut_spellings(term) for term in german_text.query_terms(prose, extra_terms=extra_terms))
    kept = (spelling for each in spellings if BM25_FOLDED_STOPWORDS.isdisjoint(each) for spelling in each)
    return list(dict.fromkeys(kept))


def search_chunks(
    scope: str,
    *,
    office_id: str | None,
    vector: Sequence[float],
    lexical_text: str,
    top_k: int,
    filters: dict[str, Any] | None,
    exact_terms: Sequence[str],
    identity: Mapping[str, str],
) -> list[Hit]:
    store = get_store(identity)
    store.check_identity(scope)
    return hybrid_search(
        store,
        [scope],
        office_id=office_id,
        vector=vector,
        lexical_text=lexical_text,
        limit=top_k,
        filters=filters,
        exact_terms=exact_terms,
        candidates=top_k,
    )


def search_grouped(
    scopes: Sequence[str],
    *,
    office_id: str | None,
    vector: Sequence[float],
    lexical_text: str,
    groups: int,
    group_size: int,
    identity: Mapping[str, str],
    filters: dict[str, Any] | None = None,
    boost: Mapping[str, Any] | None = None,
    exact_terms: Sequence[str] = (),
) -> list[tuple[str, list[Hit]]]:
    if not scopes:
        return []
    store = get_store(identity)
    store.check_identity(scopes[0])
    return grouped_search(
        store,
        scopes,
        office_id=office_id,
        vector=vector,
        lexical_text=lexical_text,
        group_by="scope",
        groups=groups,
        group_size=group_size,
        filters=filters,
        boost=parse_boost(boost),
        exact_terms=exact_terms,
    )


def set_project_facts(scope: str, facts: Mapping[str, Any] | None, status: str) -> bool:
    return get_store().set_scope_payload(scope, project_payload(facts, status))


def term_frequencies(
    scopes: str | Sequence[str],
    terms: Sequence[str],
    cache: MutableMapping[tuple[str, int, str], int] | None = None,
) -> tuple[int, dict[str, int]]:
    names = [scopes] if isinstance(scopes, str) else list(dict.fromkeys(scopes))
    store = get_store()
    if not names or not store.exists(names[0]):
        return 0, dict.fromkeys(terms, 0)
    alias = search_alias(store, names)

    def count(*extra: models.Condition) -> int:
        return store.client.count(alias, count_filter=scope_filter(names, None, *extra), exact=True).count

    total = count()
    label = ",".join(sorted(names))
    counts: dict[str, int] = {}
    for term in dict.fromkeys(terms):
        key = (label, total, term)
        if cache is not None and key in cache:
            counts[term] = cache[key]
            continue
        counts[term] = count(exact_term(term))
        if cache is not None:
            cache[key] = counts[term]
    return total, counts


_SEPARATOR_CLASS = re.compile(r"\[((?:\\s|[^\]\w\\])+)\]\+")
_PLAIN_TOKEN = re.compile(r"[a-z0-9]+")


def _pieces(alternative: str) -> list[tuple[str, str]] | None:
    pieces: list[tuple[str, str]] = []
    index = 0
    while index < len(alternative):
        rest = alternative[index:]
        separator = _SEPARATOR_CLASS.match(rest)
        if separator:
            pieces.append(("sep", ""))
            index += separator.end()
        elif rest.startswith("\\b"):
            pieces.append(("sep", ""))
            index += 2
        elif rest.startswith("(?:"):
            close = rest.find(")")
            if close < 0 or "(" in rest[3:close]:
                return None
            pieces.append(("group", ""))
            index += close + 1
        elif rest[0] == "\\" and len(rest) > 1 and not rest[1].isalnum():
            pieces.append(("char", rest[1]))
            index += 2
        elif rest[0] in "\\.^$*+?{}()[]|":
            return None
        else:
            pieces.append(("char", rest[0]))
            index += 1
    return pieces


def _bounded_words(pieces: list[tuple[str, str]]) -> list[str]:
    words: list[str] = []
    run: list[tuple[str, str]] = []
    left_bounded = False
    for kind, char in [*pieces, ("end", "")]:
        if kind == "group" or (kind == "char" and (char.isalnum() or char == "_")):
            run.append((kind, char))
            continue
        bounded_right = kind == "sep" or (kind == "char" and not (char.isalnum() or char == "_"))
        word = "".join(char for _, char in run)
        if run and left_bounded and bounded_right and all(k == "char" for k, _ in run) and _PLAIN_TOKEN.fullmatch(word):
            words.append(word)
        run = []
        left_bounded = bounded_right
    return words


def _alternatives(body: str) -> list[str]:
    parts, start, depth, in_class, index = [], 0, 0, False, 0
    while index < len(body):
        char = body[index]
        if char == "\\":
            index += 2
            continue
        if in_class:
            in_class = char != "]"
        elif char == "[":
            in_class = True
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif char == "|" and depth == 0:
            parts.append(body[start:index])
            start = index + 1
        index += 1
    parts.append(body[start:])
    return parts


def literal_tokens(pattern: str) -> list[list[str]] | None:
    body = pattern.removeprefix("(?i)")
    alternatives: list[list[str]] = []
    for alternative in _alternatives(body):
        pieces = _pieces(alternative)
        words = _bounded_words(pieces) if pieces is not None else []
        if not words:
            return None
        alternatives.append(list(dict.fromkeys(words)))
    return alternatives


USER_REGEX_TIMEOUT = 0.2

USER_REGEX_SCAN_SECONDS = 3.0

USER_REGEX_SCAN_CHUNKS = 20_000

logger = logging.getLogger(__name__)


class PatternTooCostly(ValueError):
    def __init__(self, pattern: str, *, scan: bool = False) -> None:
        super().__init__(pattern)
        self.scan = scan


def compile_user_regex(pattern: str) -> regex.Pattern[str]:
    return regex.compile(pattern, regex.IGNORECASE)


def _user_pieces(alternative: str) -> list[tuple[str, str]] | None:
    pieces: list[tuple[str, str]] = []
    index, size = 0, len(alternative)
    while index < size:
        char = alternative[index]
        end = index + 1
        kind, text = "char", char.lower()
        if char == "\\":
            end = index + 2
            escaped = alternative[index + 1 : index + 2]
            if escaped == "b":
                kind, text = "sep", ""
            elif not escaped or escaped.isalnum() or escaped == "_":
                kind, text = "group", ""
            else:
                text = escaped
        elif char == "[":
            end = _class_end(alternative, index)
            kind, text = "group", ""
        elif char == "(":
            end = _group_end(alternative, index)
            if alternative.startswith("(?i)", index):
                index = end
                continue
            if alternative.startswith("(?", index) and re.match(r"\(\?[a-zA-Z-]+[:)]", alternative[index:]):
                return None
            kind, text = "group", ""
        elif char in "^$":
            kind, text = "sep", ""
        elif char in ".)":
            kind, text = "group", ""
        elif not char.isascii() and char.isalnum():
            kind, text = "group", ""
        if end < size and alternative[end] in "*+?{":
            kind, text = "group", ""
            end = _after_quantifier(alternative, end)
        pieces.append((kind, text))
        index = end
    return pieces


def _class_end(body: str, start: int) -> int:
    index = start + 1
    if body[index : index + 1] == "^":
        index += 1
    if body[index : index + 1] == "]":
        index += 1
    while index < len(body):
        if body[index] == "\\":
            index += 2
            continue
        if body[index] == "]":
            return index + 1
        index += 1
    return len(body)


def _group_end(body: str, start: int) -> int:
    depth, index = 0, start
    while index < len(body):
        char = body[index]
        if char == "\\":
            index += 2
            continue
        if char == "[":
            index = _class_end(body, index)
            continue
        depth += {"(": 1, ")": -1}.get(char, 0)
        index += 1
        if depth == 0:
            return index
    return len(body)


def _after_quantifier(body: str, start: int) -> int:
    if body[start] == "{":
        close = body.find("}", start)
        index = close + 1 if close >= 0 else start + 1
    else:
        index = start + 1
    return index + 1 if body[index : index + 1] in ("?", "+") else index


def user_literal_tokens(pattern: str) -> list[list[str]] | None:
    alternatives: list[list[str]] = []
    for alternative in _alternatives(pattern):
        pieces = _user_pieces(alternative)
        words = _bounded_words(pieces) if pieces is not None else []
        if not words:
            return None
        alternatives.append(list(dict.fromkeys(words)))
    return alternatives


def _text_prefilter(scope: str, pattern: str, *, user_regex: bool = False) -> list[models.Filter]:
    tokens = user_literal_tokens(pattern) if user_regex else literal_tokens(pattern)
    if not tokens or not get_store().text_index_sound(scope):
        return []
    return [
        models.Filter(
            should=[
                models.FieldCondition(key=TEXT_FIELD, match=models.MatchText(text=" ".join(words))) for words in tokens
            ]
        )
    ]


def stem_condition(phrases: Sequence[str]) -> models.Filter:
    conditions = []
    for phrase in dict.fromkeys(" ".join(str(phrase).split()) for phrase in phrases):
        if not phrase:
            continue
        match = models.MatchPhrase(phrase=phrase) if " " in phrase else models.MatchText(text=phrase)
        conditions.append(models.FieldCondition(key=TEXT_STEM_FIELD, match=match))
    if not conditions:
        raise ValueError("A stemmed search needs at least one phrase")
    return models.Filter(should=conditions)


def _stemmed_hits(
    scope: str, phrases: Sequence[str], filters: dict[str, Any] | None, limit: int, office: list[models.Filter]
) -> list[Hit]:
    hits: list[Hit] = []
    for record in get_store().scroll(scope, filters, stem_condition(phrases), *office):
        payload = dict(record.payload or {})
        hits.append(Hit(str(payload.get("chunk_id") or record.id), str(payload.get("text") or ""), payload, 0.0, 1.0))
        if len(hits) >= limit:
            break
    return hits


def find_text(
    scope: str,
    pattern: str,
    filters: dict[str, Any] | None,
    limit: int,
    *,
    office_id: str | None,
    user_regex: bool = False,
    stem_phrases: Sequence[str] | None = None,
) -> list[Hit]:
    office = ScopeRead((scope,), office_id).office()
    if stem_phrases:
        stemmed = _stemmed_hits(scope, stem_phrases, filters, limit, office)
        seen = {hit.chunk_id for hit in stemmed}
        literal = find_text(scope, pattern, filters, limit, office_id=office_id, user_regex=user_regex)
        return (stemmed + [hit for hit in literal if hit.chunk_id not in seen])[:limit]
    compiled = compile_user_regex(pattern) if user_regex else re.compile(pattern)
    hits: list[Hit] = []
    deadline = time.monotonic() + USER_REGEX_SCAN_SECONDS
    records = get_store().scroll(scope, filters, *_text_prefilter(scope, pattern, user_regex=user_regex), *office)
    for scanned, record in enumerate(records, start=1):
        payload = dict(record.payload or {})
        text = str(payload.get("text") or "")
        found = _user_search(compiled, text, pattern, scope, deadline, scanned) if user_regex else compiled.search(text)
        if found:
            hits.append(Hit(str(payload.get("chunk_id") or record.id), text, payload, 0.0, 1.0))
            if len(hits) >= limit:
                break
    return hits


def _user_search(compiled: Any, text: str, pattern: str, scope: str, deadline: float, scanned: int) -> Any:
    remaining = deadline - time.monotonic()
    if remaining <= 0 or scanned > USER_REGEX_SCAN_CHUNKS:
        logger.warning("regex search in %s stopped after %d chunks: the scan ran out of time", scope, scanned - 1)
        raise PatternTooCostly(pattern, scan=True)
    timeout = min(USER_REGEX_TIMEOUT, remaining)
    try:
        return compiled.search(text, timeout=timeout)
    except TimeoutError:
        logger.warning("regex search in %s stopped: a chunk took longer than %.3fs", scope, timeout)
        raise PatternTooCostly(pattern, scan=timeout < USER_REGEX_TIMEOUT) from None


def candidate_counts(
    scope: str, pattern: str, filters: dict[str, Any] | None, *, office_id: str | None, user_regex: bool = False
) -> dict[str, int] | None:
    office = ScopeRead((scope,), office_id).office()
    tokens = user_literal_tokens(pattern) if user_regex else literal_tokens(pattern)
    prefilter = _text_prefilter(scope, pattern, user_regex=user_regex)
    if not tokens or not prefilter:
        return None
    return get_store().facet_counts(scope, "file_name", filters, *prefilter, *office)


def healthy() -> bool:
    return get_store().health()
