from __future__ import annotations

import re

_FILLER = r"(?:ä+h+m*|ö+h+m*|e+h+m+|u+h+m*|e+r+m+|h+m{2,}|u+m{2,})"
_TRAIL = r"(?:\s*(?:,|…|\.{3}|\s[-–]))?"
_SENTENCE_START = r"(?:^|(?<=[.!?…])\s+)"

_FILLER_RE = re.compile(
    rf"(?P<lead>{_SENTENCE_START})?(?P<comma>,\s*)?(?<![\w-]){_FILLER}(?![\w-]){_TRAIL}\s*(?P<next>\w)?",
    re.IGNORECASE,
)
_UM_OPENING_RE = re.compile(rf"(?P<lead>{_SENTENCE_START})um(?:,|…|\.{{3}})\s*(?P<next>\w)?", re.IGNORECASE)
_UM_ASIDE_RE = re.compile(r"(?P<comma>,\s*)(?<![\w-])um\s*,\s*(?P<next>\w)?", re.IGNORECASE)

_KEEP_COMMA_BEFORE = frozenset(
    {"dass", "ob", "weil", "wenn", "als", "obwohl", "damit", "sodass", "bevor", "nachdem", "während", "falls"}
    | {"sondern", "aber", "denn", "welche", "welcher", "welches", "wie", "wo", "was", "wer"}
)

_AUDIO_EVENT_RE = re.compile(
    r"\[[^\[\]\d]{1,30}\]"
    r"|\((?:laughs?|laughter|coughs?|music|applause|silence|pause|noise|inaudible|lacht|hustet|musik|stille|pause)\)",
    re.IGNORECASE,
)

_SILENCE_HALLUCINATIONS = (
    "untertitel im auftrag des zdf",
    "untertitel der amaraorg-community",
    "untertitelung des zdf",
    "untertitelung aufgrund der amaraorg-community",
    "thanks for watching",
    "thank you for watching",
)


def _next_word(match: re.Match[str]) -> str:
    word = re.match(r"\w+", match.string[match.start("next") :])
    return word.group(0).lower() if word else ""


def _drop_filler(match: re.Match[str]) -> str:
    groups = match.groupdict()
    following = groups.get("next") or ""
    if groups.get("lead") is not None:
        return groups["lead"] + following.upper()
    if not following:
        return ""
    if groups.get("comma") and _next_word(match) in _KEEP_COMMA_BEFORE:
        return f", {following}"
    return f" {following}"


def _tidy(text: str) -> str:
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\s+([,.!?;:])", r"\1", text)
    text = re.sub(r",(?:\s*,)+", ",", text)
    text = re.sub(r",\s*([.!?])", r"\1", text)
    text = re.sub(r"(^|[.!?]\s+),\s*", r"\1", text)
    return text.strip(" \t,")


def is_silence_hallucination(text: str) -> bool:
    normalized = re.sub(r"[^\w\s-]", "", text.lower()).strip()
    normalized = re.sub(r"\s+", " ", normalized)
    return any(normalized.startswith(phrase) for phrase in _SILENCE_HALLUCINATIONS) and len(normalized) < 80


def clean_transcript(raw: str | None) -> str:
    text = _AUDIO_EVENT_RE.sub(" ", raw or "").strip()
    if not text or is_silence_hallucination(text):
        return ""
    for _ in range(3):
        before = text
        for pattern in (_FILLER_RE, _UM_OPENING_RE, _UM_ASIDE_RE):
            text = pattern.sub(_drop_filler, text)
        if text == before:
            break
    text = _tidy(text)
    return text if re.search(r"\w", text) else ""
