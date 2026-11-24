from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from dataclasses import field

MAX_REFERENCES = 60

KINDS = ("norm", "law", "plan", "document")

_PART = r"\d{1,5}(?:[-‑]\d{1,4})*(?:\s?[A-Z](?![A-Za-z]))?"

_NORMS = re.compile(
    rf"""
    \b(?P<designation>
        (?:ÖNORM|ONORM|OENORM|DIN)(?:\s+(?:EN|ISO|IEC|SPEC|CEN/TS))*\s+(?:[A-Z]\s?)?{_PART}
      | (?:EN|ISO)(?:\s+(?:ISO|IEC))*\s+{_PART}
      | OIB[-\s]?(?:Richtlinie|RL)\s*\d(?:\.\d)?
      | VDI\s+\d{{4}}(?:\s+Blatt\s+\d{{1,2}})?
      | TRVB\s+(?:[A-Z]\s?)?\d{{2,3}}(?:\s?[A-Z](?![a-z]))?
    )
    """,
    re.VERBOSE,
)

_LAWS = re.compile(
    r"""
    §§?\s*(?P<number>\d{1,4}[a-z]?)
    (?:\s*(?:Abs\.?|Absatz)\s*\d{1,3}[a-z]?)?
    (?:\s*(?:Z\.?|Ziff\.?|Nr\.?|lit\.?|Satz)\s*[\w.]{1,4})*
    \s+(?P<law>
        (?:[A-ZÄÖÜ][A-Za-zÄÖÜäöü]*)?
        (?:BauO|BO|BauG|BauGB|BauNVO|LBO|BauKG|BTV|TBO|ROG|WBTV|VO|G)
        (?:\s+(?:NRW|für\s+Wien|Bln|BW))?
    )\b
    """,
    re.VERBOSE,
)

_PLAN_TOKEN = r"(?:\d{1,3}\s?/\s?)?[A-Z]{1,4}[-_ .]?\d{1,4}(?:[-_./]\d{1,4})?[a-z]?"

_PLANS_DESIGNATED = re.compile(
    rf"\b(?:Plan(?:-?\s?Nr\.?)?|Blatt(?:-?Nr\.?)?|Zeichnung(?:s-?Nr\.?)?|Detail)\s*:?\s*(?:Nr\.?\s*)?"
    rf"(?P<token>{_PLAN_TOKEN})\b(?![:\d])"
)
_PLANS_CUED = re.compile(
    r"\b(?:siehe|s\.|vgl\.|gem\.|gemäß|lt\.|laut)\s+(?P<token>(?:\d{1,3}/)?[A-Z]{1,4}-\d{1,4}(?:[-./]\d{1,4})?[a-z]?)\b"
)

_DOCUMENT_WORDS: dict[str, str] = {
    r"Brandschutz(?:konzept|gutachten|nachweis)": "fire_safety_concept",
    r"(?:statische[nrs]?\s+(?:Berechnung|Nachweis|Vorbemessung)|Statik)": "structural_analysis",
    r"Energieausweis": "energy_certificate",
    r"(?:Bauphysik|bauphysikalische[nrs]?\s+(?:Gutachten|Nachweis)|Wärmeschutznachweis|Schallschutznachweis)": (
        "building_physics"
    ),
    r"(?:Boden|Baugrund)gutachten|geotechnische[nrs]?\s+(?:Gutachten|Bericht)": "soil_report",
    r"Baubeschreibung": "building_description",
    r"Lageplan": "site_plan",
    r"(?:Bebauungsplan|Flächenwidmungs(?:-\s?und\s+Bebauungs)?plan)": "zoning_plan",
    r"Leistungsverzeichnis": "specification",
    r"(?:Bau)?[Bb]escheid": "permit",
    r"(?:Besprechungs|Bau)?[Pp]rotokoll": "meeting_minutes",
}

_DOCUMENT_CUE = (
    r"(?:gem\.|gemäß|lt\.|laut|siehe|s\.|vgl\.|nach|im|in\s+der|in\s+dem|des|der|dem|beiliegende[nrs]?|"
    r"beigelegte[nrs]?|Beilage|Anlage|Anhang|aktuelle[nrs]?|vorliegende[nrs]?)"
)
_DOCUMENTS = re.compile(
    rf"\b{_DOCUMENT_CUE}\s+(?:[\w.\-]+\s+)?(?P<word>{'|'.join(f'(?:{p})' for p in _DOCUMENT_WORDS)})\b",
)
_DOCUMENT_KEYS = [(re.compile(rf"^(?:{pattern})$"), key) for pattern, key in _DOCUMENT_WORDS.items()]


@dataclass
class Reference:
    kind: str
    key: str
    label: str
    pages: list[int] = field(default_factory=list)

    def as_record(self) -> dict[str, object]:
        return {"kind": self.kind, "key": self.key, "label": self.label, "pages": sorted(set(self.pages))}


def _spaced(text: str) -> str:
    return " ".join(text.replace("‑", "-").split())


def norm_key(designation: str) -> str:
    spaced = _spaced(designation)
    spaced = re.sub(r"^(?:ONORM|OENORM)\b", "ÖNORM", spaced)
    spaced = re.sub(r"^OIB[-\s]?(?:Richtlinie|RL)\s*", "OIB-RL ", spaced)
    return spaced.casefold()


def plan_key(token: str) -> str:
    token = re.sub(r"\s*/\s*", "/", token.strip())
    return re.sub(r"[\s_]+", "-", token).casefold()


_NORM_LETTER_NUMBER = re.compile(r"(?<![^\W\d_])([^\W\d_]) ?(?=\d)")
_PLAN_PREFIX = re.compile(r"^((?:\d{1,3}/)?[^\W\d_]{1,4})[-.]?(?=\d)")


def spellings(kind: str, key: str) -> list[str]:
    if kind == "norm":
        variants = [_NORM_LETTER_NUMBER.sub(r"\1", key), _NORM_LETTER_NUMBER.sub(r"\1 ", key)]
    elif kind == "plan":
        variants = [_PLAN_PREFIX.sub(rf"\g<1>{separator}", key) for separator in ("", "-", ".")]
    else:
        variants = []
    return list(dict.fromkeys([key, *variants]))


def _document_type(word: str) -> str | None:
    folded = _spaced(word)
    return next((key for pattern, key in _DOCUMENT_KEYS if pattern.match(folded)), None)


def _found(text: str) -> Iterable[tuple[str, str, str]]:
    hits: list[tuple[int, str, str, str]] = []
    for match in _NORMS.finditer(text):
        label = _spaced(match.group("designation"))
        hits.append((match.start(), "norm", norm_key(label), label))
    for match in _LAWS.finditer(text):
        law = _spaced(match.group("law"))
        label = f"§ {match.group('number')} {law}"
        hits.append((match.start(), "law", label.casefold(), label))
    plan_spans: list[tuple[int, int]] = []
    for pattern in (_PLANS_DESIGNATED, _PLANS_CUED):
        for match in pattern.finditer(text):
            span = match.span("token")
            if any(start <= span[0] < end for start, end in plan_spans):
                continue
            token = match.group("token").strip()
            if not any(char.isdigit() for char in token) or not any(char.isalpha() for char in token):
                continue
            plan_spans.append(span)
            hits.append((match.start("token"), "plan", plan_key(token), _spaced(token)))
    for match in _DOCUMENTS.finditer(text):
        word = match.group("word")
        document_type = _document_type(word)
        if document_type:
            hits.append((match.start("word"), "document", document_type, _spaced(word)))
    for _, kind, key, label in sorted(hits, key=lambda hit: hit[0]):
        yield kind, key, label


def extract_references(
    passages: Iterable[tuple[str, int | None]], *, own_document_type: str | None = None
) -> list[dict[str, object]]:
    merged: dict[tuple[str, str], Reference] = {}
    for text, page in passages:
        if not text:
            continue
        for kind, key, label in _found(text):
            if kind == "document" and key == own_document_type:
                continue
            reference = merged.get((kind, key))
            if reference is None:
                if len(merged) >= MAX_REFERENCES:
                    continue
                reference = merged[(kind, key)] = Reference(kind, key, label)
            if page is not None:
                reference.pages.append(page)
    return [reference.as_record() for reference in merged.values()]


def drop_own_type(records: list[dict[str, object]], own_document_type: str | None) -> list[dict[str, object]]:
    if not own_document_type:
        return records
    return [r for r in records if not (r.get("kind") == "document" and r.get("key") == own_document_type)]


def reference_keys_for(text: str) -> list[tuple[str, str]]:
    text = " ".join((text or "").split())
    if not text:
        return []
    found = [(kind, key) for kind, key, _ in _found(text) if kind in ("norm", "law", "plan")]
    document_type = _document_type(text)
    if document_type:
        found.append(("document", document_type))
    if not found and any(char.isdigit() for char in text):
        found.append(("plan", plan_key(text)))
    return list(dict.fromkeys(found))
