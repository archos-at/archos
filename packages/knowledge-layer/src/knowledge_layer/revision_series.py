import re
from collections.abc import Callable
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

_SEP = r"[ _.\-]"
_FLAGS = re.IGNORECASE | re.ASCII

_KEYWORD_INDEX = re.compile(
    rf"(^|{_SEP})(?:index|idx|ind|rev|revision|ver|version|v)\.?{_SEP}?([a-z]|[0-9]{{1,3}})(?=\Z|{_SEP})",
    _FLAGS,
)
_SHEET_NUMBER_LETTER = re.compile(r"^([A-Za-z]{1,3}[-_ ]?[0-9]{2,4})[ _.-]([A-Z])(?=[ _.-]\S)")
_ISO_DATE = re.compile(
    rf"(^|{_SEP})(?:stand{_SEP}*)?(20[0-9]{{2}})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12][0-9]|3[01])(?=\Z|{_SEP})",
    _FLAGS,
)
_DOTTED_DATE = re.compile(
    rf"(^|{_SEP})(?:stand{_SEP}*)?(0[1-9]|[12][0-9]|3[01])\.(0[1-9]|1[0-2])\.(20[0-9]{{2}})(?=\Z|{_SEP})",
    _FLAGS,
)
_SHORT_DATE_START = re.compile(r"^([0-9]{2})(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])(?=[ _.-])")
_SHORT_DATE_END = re.compile(rf"{_SEP}([0-9]{{2}})(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])\Z")
_EXTENSION = re.compile(r"^(.*)\.([a-z0-9]{1,5})\Z", _FLAGS)
_DIGITS = re.compile(r"[0-9]+")
_KEY_SEPARATORS = re.compile(r"[\s_.]+")
_DASH_BEFORE_SPACE = re.compile(r"\s*-\s*(?=\s|\Z)")
_DASH_AT_WORD_START = re.compile(r"(^|\s)-\s*")
_WHITESPACE = re.compile(r"\s+")


@dataclass(frozen=True)
class RevisionIndex:
    kind: Literal["letter", "number"]
    value: str
    rank: int


@dataclass(frozen=True)
class RevisionName:
    key: str
    index: RevisionIndex | None
    date: str | None


@dataclass(frozen=True)
class RevisionSeriesMember[T]:
    item: T
    revision: RevisionName


@dataclass(frozen=True)
class RevisionSeries[T]:
    key: str
    current: RevisionSeriesMember[T]
    older: list[RevisionSeriesMember[T]]


def _split_extension(filename: str) -> tuple[str, str]:
    name = filename.strip()
    match = _EXTENSION.match(name)
    if match is None:
        return name, ""
    return match.group(1), match.group(2).lower()


def _index_of(raw: str) -> RevisionIndex:
    if _DIGITS.fullmatch(raw):
        number = int(raw)
        return RevisionIndex(kind="number", value=str(number), rank=number)
    letter = raw.upper()
    return RevisionIndex(kind="letter", value=letter, rank=ord(letter) - ord("A") + 1)


def _series_key(stem: str) -> str:
    key = _KEY_SEPARATORS.sub(" ", stem.lower())
    key = _DASH_BEFORE_SPACE.sub(" ", key)
    key = _DASH_AT_WORD_START.sub(r"\1", key)
    return _WHITESPACE.sub(" ", key).strip()


def _cut(stem: str, match: re.Match[str], *, keep_lead: bool) -> str:
    lead = match.group(1) if keep_lead else ""
    return stem[: match.start()] + lead + " " + stem[match.end() :]


def parse_revision_name(filename: str) -> RevisionName | None:
    stem, _ = _split_extension(filename)
    index: RevisionIndex | None = None
    date: str | None = None

    if match := _ISO_DATE.search(stem):
        date = f"{match.group(2)}-{match.group(3)}-{match.group(4)}"
        stem = _cut(stem, match, keep_lead=True)
    elif match := _DOTTED_DATE.search(stem):
        date = f"{match.group(4)}-{match.group(3)}-{match.group(2)}"
        stem = _cut(stem, match, keep_lead=True)
    elif match := _SHORT_DATE_START.search(stem):
        date = f"20{match.group(1)}-{match.group(2)}-{match.group(3)}"
        stem = _cut(stem, match, keep_lead=False)
    elif match := _SHORT_DATE_END.search(stem):
        date = f"20{match.group(1)}-{match.group(2)}-{match.group(3)}"
        stem = _cut(stem, match, keep_lead=False)

    if match := _KEYWORD_INDEX.search(stem):
        index = _index_of(match.group(2))
        stem = _cut(stem, match, keep_lead=True)
    elif match := _SHEET_NUMBER_LETTER.match(stem):
        index = _index_of(match.group(2))
        stem = match.group(1) + " " + stem[match.end() :]

    if index is None and date is None:
        return None
    key = _series_key(stem)
    return RevisionName(key=key, index=index, date=date) if key else None


def series_key_of(filename: str) -> str:
    revision = parse_revision_name(filename)
    if revision is not None:
        return revision.key
    stem, _ = _split_extension(filename)
    return _series_key(stem)


def _newest_first[T](
    members: list[RevisionSeriesMember[T]], created_at: Callable[[T], str | None]
) -> list[RevisionSeriesMember[T]]:
    kinds = {member.revision.index.kind if member.revision.index is not None else "none" for member in members}
    index_leads = len(kinds) == 1 and "none" not in kinds

    def rank(member: RevisionSeriesMember[T]) -> int:
        return member.revision.index.rank if member.revision.index is not None else 0

    return sorted(
        members,
        key=lambda member: (
            rank(member) if index_leads else 0,
            member.revision.date or "",
            rank(member),
            created_at(member.item) or "",
        ),
        reverse=True,
    )


def _signature(revision: RevisionName) -> str:
    kind = revision.index.kind if revision.index is not None else ""
    value = revision.index.value if revision.index is not None else ""
    return f"{kind}:{value}:{revision.date or ''}"


def find_revision_series[T](
    items: Sequence[T],
    *,
    filename: Callable[[T], str],
    created_at: Callable[[T], str | None],
) -> list[RevisionSeries[T]]:
    groups: dict[str, list[RevisionSeriesMember[T]]] = {}
    for item in items:
        name = filename(item)
        revision = parse_revision_name(name)
        if revision is None:
            continue
        key = f"{revision.key}.{_split_extension(name)[1]}"
        groups.setdefault(key, []).append(RevisionSeriesMember(item=item, revision=revision))

    series: list[RevisionSeries[T]] = []
    for key, members in groups.items():
        if len({_signature(member.revision) for member in members}) < 2:
            continue
        ordered = _newest_first(members, created_at)
        series.append(RevisionSeries(key=key, current=ordered[0], older=ordered[1:]))
    return sorted(series, key=lambda entry: entry.key)


def revision_label(revision: RevisionName) -> str:
    parts: list[str] = []
    if revision.index is not None:
        parts.append(f"Index {revision.index.value}" if revision.index.kind == "letter" else f"v{revision.index.value}")
    if revision.date is not None:
        year, month, day = revision.date.split("-")
        parts.append(f"{day}.{month}.{year}")
    return " · ".join(parts)
