from __future__ import annotations

import functools
import re
from collections.abc import Sequence
from typing import NamedTuple

from langchain_core.messages import BaseMessage
from langchain_core.messages import HumanMessage

from agent.common.message_utils import content_to_text

DEFAULT_LANGUAGE = "de"

LANGUAGE_NAMES: dict[str, str] = {
    "ar": "Arabic",
    "bg": "Bulgarian",
    "cs": "Czech",
    "da": "Danish",
    "de": "German",
    "el": "Greek",
    "en": "English",
    "es": "Spanish",
    "fi": "Finnish",
    "fr": "French",
    "hr": "Croatian",
    "hu": "Hungarian",
    "it": "Italian",
    "ja": "Japanese",
    "ko": "Korean",
    "nl": "Dutch",
    "no": "Norwegian",
    "pl": "Polish",
    "pt": "Portuguese",
    "ro": "Romanian",
    "ru": "Russian",
    "sk": "Slovak",
    "sl": "Slovenian",
    "sr": "Serbian",
    "sv": "Swedish",
    "tr": "Turkish",
    "uk": "Ukrainian",
    "zh": "Chinese",
}

MIN_CONFIDENCE = 0.9

MIN_WORDS = 2

MAX_CHARS = 1000

_WORD = re.compile(r"[^\W\d_]{2,}")
_UNSPACED = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]{4,}")


class QuestionLanguage(NamedTuple):
    code: str
    confidence: float

    @property
    def instructs(self) -> bool:
        return self.code != DEFAULT_LANGUAGE and self.confidence >= MIN_CONFIDENCE


UNDECIDED = QuestionLanguage(code=DEFAULT_LANGUAGE, confidence=0.0)


@functools.cache
def _identifier():  # noqa: ANN202 — py3langid ships no type information
    from py3langid.langid import MODEL_FILE
    from py3langid.langid import LanguageIdentifier

    identifier = LanguageIdentifier.from_model_file(MODEL_FILE, norm_probs=True)
    identifier.set_languages(list(LANGUAGE_NAMES))
    return identifier


def warm() -> None:
    _identifier()


def detect(text: str) -> QuestionLanguage:
    sample = text[:MAX_CHARS]
    if len(_WORD.findall(sample)) < MIN_WORDS and not _UNSPACED.search(sample):
        return UNDECIDED
    try:
        code, confidence = _identifier().classify(sample)
    except Exception:  # noqa: BLE001 — a failed call is the default language, never a failed turn
        return UNDECIDED
    return QuestionLanguage(code=str(code), confidence=round(float(confidence), 3))


def newest_question(messages: Sequence[BaseMessage]) -> str:
    for message in reversed(messages):
        if isinstance(message, HumanMessage):
            return content_to_text(message.content)
    return ""


def question_language(messages: Sequence[BaseMessage]) -> QuestionLanguage:
    return detect(newest_question(messages))


def answer_language_line(language: QuestionLanguage) -> str | None:
    if not language.instructs:
        return None
    name = LANGUAGE_NAMES.get(language.code, language.code)
    return (
        f"Answer in {name}: the person's newest message is in {name}. "
        "The context above and the files may be German; quote them as written, and write everything else, "
        f"headings and the references label included, in {name}."
    )


def trace_metadata(language: QuestionLanguage) -> dict[str, object]:
    return {
        "question_language": language.code if language.confidence > 0 else "undetermined",
        "question_language_confidence": language.confidence,
        "answer_language_instructed": language.instructs,
    }
