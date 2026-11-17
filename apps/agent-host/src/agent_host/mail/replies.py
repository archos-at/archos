from __future__ import annotations

import re
from dataclasses import dataclass

from mailparser_reply.parser import EmailMessage

from . import limits

LANGUAGES = ("de", "en")

_LINE_BREAKS = re.compile("[\r\x0b\x0c\x1c\x1d\x1e\x85  ]")
_HORIZONTAL_SPACE = r"[^\S\n]"
_BLANK_RUN = re.compile(r"\n{3,}")
_QUOTE_MARKER = re.compile(r"^(?:> ?)+", re.MULTILINE)


@dataclass(frozen=True)
class Quoted:
    header: str
    text: str


@dataclass(frozen=True)
class SplitText:
    own: str
    quoted: tuple[Quoted, ...]
    signature_removed: bool
    split: bool


def split_replies(text: str) -> SplitText:
    if len(text) > limits.MAX_SPLIT_CHARS:
        return SplitText(own=text, quoted=(), signature_removed=False, split=False)
    prepared = _bounded_whitespace(text)
    if not prepared.strip():
        return SplitText(own="", quoted=(), signature_removed=False, split=True)
    message = EmailMessage(text=prepared, languages=list(LANGUAGES), keep_hyphen_lists=True).read()
    replies = message.replies
    own_reply = replies[0] if replies and not replies[0].headers else None
    quoted = replies[1:] if own_reply is not None else replies
    own = own_reply.body if own_reply is not None else ""
    signature_removed = own_reply is not None and bool(own_reply.signatures or own_reply.disclaimers)
    return SplitText(
        own=own,
        quoted=tuple(Quoted(header=reply.headers, text=_unquoted(reply.body)) for reply in quoted if reply.body),
        signature_removed=signature_removed,
        split=True,
    )


def _bounded_whitespace(text: str) -> str:
    text = _LINE_BREAKS.sub("\n", text.replace("\r\n", "\n"))
    run = limits.MAX_WHITESPACE_RUN
    text = re.sub(f"({_HORIZONTAL_SPACE}{{{run}}}){_HORIZONTAL_SPACE}+", r"\1", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    return _BLANK_RUN.sub("\n\n", text)


def _unquoted(text: str) -> str:
    return _QUOTE_MARKER.sub("", text).strip()
