import re
from collections.abc import Callable
from collections.abc import Sequence

_FENCE_RE = re.compile(r"^[ \t]{0,3}(`{3,}|~{3,})")


_INLINE_CODE_RE = re.compile(r"(?<!`)(`+)(?!`)(.+?)(?<!`)\1(?!`)", re.DOTALL)


def code_spans(
    text: str,
    *,
    include_inline: bool = True,
    unterminated_fence_is_code: bool = True,
) -> list[tuple[int, int]]:
    spans: list[tuple[int, int]] = []
    offset = 0
    fence: str | None = None
    fence_start = 0
    for line in text.splitlines(keepends=True):
        match = _FENCE_RE.match(line)
        marker = match.group(1) if match else None
        if fence is None:
            if marker is not None:
                fence, fence_start = marker, offset
        elif marker is not None and marker[0] == fence[0] and len(marker) >= len(fence):
            spans.append((fence_start, offset + len(line)))
            fence = None
        offset += len(line)
    if fence is not None and unterminated_fence_is_code:
        spans.append((fence_start, len(text)))

    if include_inline:
        for match in _INLINE_CODE_RE.finditer(text):
            if not any(start <= match.start() < end for start, end in spans):
                spans.append((match.start(), match.end()))
    return spans


def map_outside_code(
    text: str,
    transform: Callable[[str], str],
    *,
    include_inline: bool = True,
    unterminated_fence_is_code: bool = True,
) -> str:
    spans = sorted(
        code_spans(
            text,
            include_inline=include_inline,
            unterminated_fence_is_code=unterminated_fence_is_code,
        )
    )
    if not spans:
        return transform(text)
    out: list[str] = []
    cursor = 0
    for start, end in spans:
        if start > cursor:
            out.append(transform(text[cursor:start]))
        out.append(text[max(cursor, start) : end])
        cursor = max(cursor, end)
    if cursor < len(text):
        out.append(transform(text[cursor:]))
    return "".join(out)


def inside(offset: int, spans: Sequence[tuple[int, int]]) -> bool:
    return any(start <= offset < end for start, end in spans)
