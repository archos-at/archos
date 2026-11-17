from __future__ import annotations

_PARAGRAPH = "§"
_OIB_GUIDELINE_TOKEN = "oib-richtlinie"
_MIN_ALLCAPS_LEN = 3

_QUOTE_OPEN: dict[str, str] = {'"': '"', "'": "'", "„": "“", "‚": "‘"}

_EDGE_PUNCT = ".,;:!?()[]{}<>«»\"'„“‚‘"


def _iter_tokens(text: str) -> list[tuple[int, str]]:
    tokens: list[tuple[int, str]] = []
    index = 0
    while index < len(text):
        while index < len(text) and text[index].isspace():
            index += 1
        if index >= len(text):
            break
        start = index
        while index < len(text) and not text[index].isspace():
            index += 1
        tokens.append((start, text[start:index]))
    return tokens


def _extract_quoted_spans(query: str) -> tuple[list[tuple[int, str]], str]:
    spans: list[tuple[int, str]] = []
    chars = list(query)
    index = 0
    while index < len(query):
        closer = _QUOTE_OPEN.get(query[index])
        if closer is None:
            index += 1
            continue
        end = query.find(closer, index + 1)
        if end == -1:
            index += 1
            continue
        phrase = query[index + 1 : end].strip()
        if phrase:
            spans.append((index, phrase))
        for pos in range(index, end + 1):
            chars[pos] = " "
        index = end + 1
    return spans, "".join(chars)


def _is_paragraph_number(token: str) -> bool:
    body = token.rstrip(".")
    if body and body[-1].isalpha():
        body = body[:-1]
    if not body:
        return False
    head, _, tail = body.partition(".")
    return head.isdigit() and (not tail or tail.isdigit())


def _is_casefold_identifier(token: str, following: str) -> bool:
    has_alpha = any(char.isalpha() for char in token)
    if has_alpha and any(char.isdigit() for char in token):
        return True
    return token.isalpha() and _is_paragraph_number(following)


def extract_exact_terms(query: str, *, max_terms: int = 3) -> list[str]:
    if max_terms <= 0 or not query:
        return []

    spans, remainder = _extract_quoted_spans(query)
    tokens = _iter_tokens(remainder)

    found: list[tuple[int, str]] = list(spans)
    skip_next = False
    for position, (start, raw) in enumerate(tokens):
        if skip_next:
            skip_next = False
            continue
        token = raw.strip(_EDGE_PUNCT)
        if not token:
            continue
        following = tokens[position + 1][1].strip(_EDGE_PUNCT) if position + 1 < len(tokens) else ""

        if token == _PARAGRAPH and _is_paragraph_number(following):
            found.append((start, f"{_PARAGRAPH} {following.rstrip('.')}"))
            skip_next = True
        elif token.startswith(_PARAGRAPH) and _is_paragraph_number(token[len(_PARAGRAPH) :]):
            found.append((start, f"{_PARAGRAPH} {token[len(_PARAGRAPH) :].rstrip('.')}"))
        elif token.casefold() == _OIB_GUIDELINE_TOKEN and _is_paragraph_number(following):
            found.append((start, f"OIB-Richtlinie {following.rstrip('.')}"))
            skip_next = True
        elif len(token) >= _MIN_ALLCAPS_LEN and token.isupper():
            found.append((start, token))
        elif len(token) >= _MIN_ALLCAPS_LEN and _is_casefold_identifier(token, following):
            found.append((start, token.upper()))

    found.sort(key=lambda item: item[0])
    terms: list[str] = []
    for _, term in found:
        if term not in terms:
            terms.append(term)
        if len(terms) >= max_terms:
            break
    return terms
