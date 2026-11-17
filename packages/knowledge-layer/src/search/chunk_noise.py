from __future__ import annotations

import os
from dataclasses import dataclass

from knowledge_layer.ingest import MIN_JUDGEABLE_CHARS
from knowledge_layer.ingest import text_quality

MIN_DEBRIS_SHARE = 0.5
MAX_FRAGMENT_GLYPHS = 4
MIN_ALNUM_SHARE = 0.5
MIN_SHREDDED_TOKENS = 4
MIN_SINGLE_GLYPH_SHARE = 0.6
MIN_JUDGEABLE_GLYPHS = MIN_JUDGEABLE_CHARS
_VALUE_MARKS = frozenset("≤≥±×÷%°²³‰")

_JUDGED_CONTENT_TYPES = frozenset({"text"})


@dataclass(frozen=True)
class NoiseVerdict:

    glyphs: int
    debris_glyphs: int
    garbled: bool = False

    @property
    def debris_share(self) -> float:
        return self.debris_glyphs / self.glyphs if self.glyphs else 0.0

    @property
    def is_noise(self) -> bool:
        if self.glyphs < MIN_JUDGEABLE_GLYPHS:
            return False
        return self.garbled or self.debris_share >= MIN_DEBRIS_SHARE


def _is_debris_line(tokens: list[str], glyphs: int) -> bool:
    if glyphs <= MAX_FRAGMENT_GLYPHS:
        return True
    alnum = sum(ch.isalnum() or ch in _VALUE_MARKS for token in tokens for ch in token)
    if alnum / glyphs < MIN_ALNUM_SHARE:
        return True
    if len(tokens) < MIN_SHREDDED_TOKENS:
        return False
    single = sum(1 for token in tokens if len(token) == 1 and not token.isdigit())
    return single / len(tokens) >= MIN_SINGLE_GLYPH_SHARE


def judge_text(text: str | None) -> NoiseVerdict:
    glyphs = 0
    debris = 0
    for line in (text or "").splitlines():
        tokens = line.split()
        line_glyphs = sum(len(token) for token in tokens)
        glyphs += line_glyphs
        if line_glyphs and _is_debris_line(tokens, line_glyphs):
            debris += line_glyphs
    return NoiseVerdict(glyphs=glyphs, debris_glyphs=debris, garbled=text_quality(text).garbled)


def _content_type(chunk) -> str:
    value = getattr(chunk, "content_type", None)
    return str(getattr(value, "value", value) or "")


def is_noise_chunk(chunk) -> bool:
    if _content_type(chunk) not in _JUDGED_CONTENT_TYPES:
        return False
    return judge_text(getattr(chunk, "content", None)).is_noise


def without_noise(chunks) -> tuple[list, int]:
    kept = [chunk for chunk in chunks if not is_noise_chunk(chunk)]
    return kept, len(chunks) - len(kept)


def noise_notice(dropped: int) -> str:
    if dropped <= 0:
        return ""
    return (
        f"Left out {dropped} passage(s) whose text is OCR debris from a drawing's text layer; "
        "a literal search still returns every passage.\n\n"
    )


DROP_OCR_NOISE_ENV = "DROP_OCR_NOISE"

_TRUE_VALUES = frozenset({"1", "true", "yes", "on"})


def noise_filter_enabled(configured: bool | None) -> bool:
    if configured is not None:
        return configured
    return os.environ.get(DROP_OCR_NOISE_ENV, "").strip().lower() in _TRUE_VALUES
