from __future__ import annotations

import re

from agent.common.content_screen import DETECTORS_ONLY
from agent.common.content_screen import find_spans

SECRET_KINDS = (
    "iban",
    "at_svnr",
    "credit_card",
    "de_svnr",
    "de_tax_id",
    "private_key",
    "api_key",
    "credential",
    "identity_number",
)
CONTACT_KINDS = ("email", "phone")

_WORD = "A-Za-z0-9ÄÖÜäöüß"
_LETTER = "A-Za-zÄÖÜäöüß"
_SP = r"[ \t ]"
_TOKEN = r"[^ \t\r\n ]+"

_PRIVATE_KEY = re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")

_API_KEY = re.compile(
    r"(?<![A-Za-z0-9])(?:"
    r"sk[-_](?:live|test|proj|ant|or)[-_][A-Za-z0-9_-]{3,}"
    r"|(?:rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}"
    r"|gh[pousr]_[A-Za-z0-9]{20,}"
    r"|github_pat_[A-Za-z0-9_]{20,}"
    r"|glpat-[A-Za-z0-9_-]{20,}"
    r"|(?:AKIA|ASIA)[0-9A-Z]{16}"
    r"|xox[abprs]-[A-Za-z0-9-]{10,}"
    r"|AIza[0-9A-Za-z_-]{35}"
    r"|hf_[A-Za-z0-9]{30,}"
    r"|npm_[A-Za-z0-9]{36}"
    r"|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"
    r")"
)
_LONG_TOKEN = re.compile(r"(?<![A-Za-z0-9+=_-])[A-Za-z0-9+=_-]{24,}(?![A-Za-z0-9+=_-])")
_TOKEN_SPLIT = re.compile(r"[-_]")
_RANDOM_MIN_CHARS = 24
_RANDOM_MIN_EACH = 6

_STRONG_LABEL = (
    r"(?:(?:passwor[dt]|passwd|kennwort|passphrase|losungswort|api[ _-]?key|api[ _-]?schl(?:ü|ue)ssel"
    rf"|client[ _-]?secret)|(?<![{_WORD}])(?:pw|pwd|secret|token))(?![{_WORD}])"
)
_LABELLED_VALUE = re.compile(
    rf"{_STRONG_LABEL}(?:{_SP}*([:=]){_SP}*|{_SP}+(?:(?:ist|lautet|is){_SP}+)?)({_TOKEN})",
    re.IGNORECASE,
)
_WEAK_LABEL = re.compile(
    r"(?:zugang(?:sdaten)?|log-?in|anmeld(?:ung|edaten)|account)[^:=\r\n]{0,30}[:=]([^\r\n]{0,80})",
    re.IGNORECASE,
)
_ACCESS_CODE = re.compile(
    rf"(?:(?<![{_WORD}])pin(?:-?code)?"
    rf"|(?<![{_LETTER}])(?:haust(?:ü|ue)r|t(?:ü|ue)r|tor|garagen|tresor|alarm|zugangs|safe|schl(?:ü|ue)sselbox)-?code)"
    rf"{_SP}*[:=]?{_SP}*[0-9]{{4,8}}(?![0-9])",
    re.IGNORECASE,
)
_BEARER = re.compile(rf"(?<![{_WORD}])bearer{_SP}+[A-Za-z0-9._~+/=-]{{16,}}", re.IGNORECASE)
_SPLIT_SPACE = re.compile(r"[ \t ]+")
_LEADING_QUOTES = "\"'`„“”‚‘’«»("
_TRAILING_MARKS = "\"'`“”‘’«»).,;:"
_STRONG_SIGNS = frozenset("!#$%&*+?@^~<>|\\")
_URL_START = re.compile(r"(?:https?://|www\.)", re.IGNORECASE)
_EMAIL_TOKEN = re.compile(r"[^@]+@[^@]+\.[A-Za-z]{2,}")
_LOWER = re.compile(r"[a-zäöüß]")
_UPPER = re.compile(r"[A-ZÄÖÜ]")
_DIGIT = re.compile(r"[0-9]")
_ALL_DIGITS = re.compile(r"[0-9]+")

_IDENTITY_LABEL = re.compile(
    rf"(?:steuernummer|steuer-?nr|(?<![{_WORD}])st\.?-?nr|personalausweis|reisepass|ausweisn(?:ummer|r)"
    r"|passn(?:ummer|r)|f(?:ü|ue)hrerschein|sozialversicherungsn(?:ummer|r)"
    rf"|(?<![{_WORD}])sv-?n(?:ummer|r))([^\r\n]{{0,40}})",
    re.IGNORECASE,
)
_IDENTITY_MIN_DIGITS = 6
_US_SSN = re.compile(r"(?<![0-9-])[0-9]{3}-[0-9]{2}-[0-9]{4}(?![0-9-])")

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
_DATE_SHAPE = re.compile(r"(?<![0-9])(?:[0-9]{1,2}[./-][0-9]{1,2}[./-][0-9]{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2})(?![0-9])")
_PHONE_INTERNATIONAL = re.compile(r"(?<![A-Za-z0-9])(?:\+|00)[1-9][0-9 ()/-]{5,}[0-9]")
_PHONE_NATIONAL = re.compile(
    r"(?<![A-Za-z0-9.,/-])0[1-9](?:[0-9]{7,12}|[0-9]{0,4}[ /-]{1,3}\(?[0-9][0-9 ()/-]{3,}[0-9])(?![0-9])"
)
_PHONE_LABELLED = re.compile(
    rf"(?<![{_LETTER}])(?:tel(?:efon)?|mobil(?:tel(?:efon)?)?|handy|fax|phone|mobile)\.?(?:nr\.?|nummer)?"
    rf"{_SP}*:?{_SP}*\+?[0-9][0-9 ()/-]{{4,}}[0-9]",
    re.IGNORECASE,
)
_PHONE_MIN_DIGITS = 8
_PHONE_MAX_DIGITS = 17
_LABELLED_PHONE_MIN_DIGITS = 6


def _count(pattern: re.Pattern[str], text: str) -> int:
    return len(pattern.findall(text))


def _value_of(token: str) -> str:
    return token.lstrip(_LEADING_QUOTES).rstrip(_TRAILING_MARKS)


def _character_classes(value: str) -> tuple[bool, bool, bool, bool]:
    return (
        bool(_LOWER.search(value)),
        bool(_UPPER.search(value)),
        bool(_DIGIT.search(value)),
        any(char in _STRONG_SIGNS for char in value),
    )


def _is_labelled_password(token: str, *, explicit: bool) -> bool:
    value = _value_of(token)
    if len(value) < 4 or _URL_START.match(value):
        return False
    if explicit and _ALL_DIGITS.fullmatch(value):
        return True
    lower, upper, digit, sign = _character_classes(value)
    return (digit or sign) and sum((lower, upper, digit, sign)) >= 2


def _is_unlabelled_password(token: str) -> bool:
    value = _value_of(token)
    if len(value) < 6 or _URL_START.match(value) or _EMAIL_TOKEN.fullmatch(value):
        return False
    lower, upper, digit, sign = _character_classes(value)
    return (lower or upper) and digit and sign


def _is_random_token(run: str) -> bool:
    for part in _TOKEN_SPLIT.split(run):
        letters = _count(_LOWER, part) + _count(_UPPER, part)
        if len(part) >= _RANDOM_MIN_CHARS and _count(_DIGIT, part) >= _RANDOM_MIN_EACH and letters >= _RANDOM_MIN_EACH:
            return True
    return False


def _has_credential(text: str) -> bool:
    if _ACCESS_CODE.search(text) or _BEARER.search(text):
        return True
    if any(
        _is_labelled_password(match.group(2), explicit=match.group(1) is not None)
        for match in _LABELLED_VALUE.finditer(text)
    ):
        return True
    return any(
        _is_unlabelled_password(token)
        for match in _WEAK_LABEL.finditer(text)
        for token in _SPLIT_SPACE.split(match.group(1))
    )


def secret_kind(content: str) -> str | None:
    text = content or ""
    spans = find_spans(text, DETECTORS_ONLY)
    if spans:
        return spans[0].kind
    if _PRIVATE_KEY.search(text):
        return "private_key"
    if _API_KEY.search(text) or any(_is_random_token(match.group(0)) for match in _LONG_TOKEN.finditer(text)):
        return "api_key"
    if _has_credential(text):
        return "credential"
    if any(_count(_DIGIT, match.group(1)) >= _IDENTITY_MIN_DIGITS for match in _IDENTITY_LABEL.finditer(text)):
        return "identity_number"
    return "identity_number" if _US_SSN.search(text) else None


def _digits_between(match: re.Match[str], low: int, high: int) -> bool:
    return low <= _count(_DIGIT, match.group(0)) <= high


def contact_kind(content: str) -> str | None:
    text = content or ""
    if _EMAIL.search(text):
        return "email"
    scrubbed = _DATE_SHAPE.sub(" ", text)
    unlabelled = [*_PHONE_INTERNATIONAL.finditer(scrubbed), *_PHONE_NATIONAL.finditer(scrubbed)]
    if any(_digits_between(match, _PHONE_MIN_DIGITS, _PHONE_MAX_DIGITS) for match in unlabelled):
        return "phone"
    labelled = _PHONE_LABELLED.finditer(scrubbed)
    if any(_digits_between(match, _LABELLED_PHONE_MIN_DIGITS, _PHONE_MAX_DIGITS) for match in labelled):
        return "phone"
    return None


def note_refusal(content: str, *, shared: bool) -> str | None:
    return secret_kind(content) or (contact_kind(content) if shared else None)
