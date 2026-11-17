from __future__ import annotations

import re

_FAMILY_ANCHOR_RE = re.compile(
    r"\b(?:oib[-\s]*(?:rl|richtlinie)?|rl|richtlinie)[-\s]*(\d+(?:\.\d+)?)\b",
    re.IGNORECASE,
)

_FAMILY_JOINED_KEY_RE = re.compile(
    r"\s*(?:,|/|&|\bund\b|\boder\b|\bbzw\.?)\s*(\d{1,2}(?:\.\d+)?)(?!\d|\.\d)",
    re.IGNORECASE,
)

_FAMILY_BLOCKER_RE = re.compile(
    "|".join(
        (
            r"\bpkt\.?\s*\d",
            r"\bpunkt\w*\s*\d",
            r"§",
            r"\babs\.?\s*\d",
            r"\bseite\s*\d",
            r"\bpage\s*\d",
            r"\btabelle",
            r"\banhang",
            r"\.pdf\b",
            r"oib-rl_",
            r"oib-richtlinie_",
        )
    ),
    re.IGNORECASE,
)

_FAMILY_QUERY_STOPWORDS = frozenset(
    """
    was wer wie wo welche welcher welches welchem welchen warum wieso weshalb worum wofuer wofür
    wozu ob der die das den dem des ein eine einer eines einem einen und oder aber in im zu zum
    zur von vom ueber über um an am auf aus bei fuer für mit nach es ich du mir mich dir dich sie
    man sich bitte mal denn noch schon alles etwas mehr kurz genau eigentlich ueberhaupt überhaupt
    gibt gibts gib ist sind war waren hat haben habe hast kannst kann koennen können sagen sagst
    sag sage erzaehl erzähl erzaehle erzähle zeig zeige zeigen weisst weiss wissen kennst kennen
    lies lesen geht gehts handelt steht regelt regeln behandelt enthaelt enthält umfasst
    beinhaltet beschreibt bedeutet sagt drin darin dazu davon nenn nenne liste fasse fass zusammen
    erklaer erklär erklaere erkläre brauche moechte möchte will
    ueberblick überblick uebersicht übersicht inhalt inhalte inhalts gliederung aufbau struktur
    thema themen punkte kapitel teil teile teilen zusammenfassung zusammenfassen allgemein
    allgemeine allgemeines
    ausgabe ausgaben edition fassung version aktuell aktuelle aktueller aktuellen gueltige gültige
    geltende stand rev revision
    jaenner jänner januar februar maerz märz april mai juni juli august september oktober november
    dezember
    oib rl richtlinie richtlinien
    what do you know about the tell me is of on a an and give show summarize summarise please it
    its overview summary contents scope
    """.split()
)

_FAMILY_TOKEN_RE = re.compile(r"[^\W\d_]+|\d+(?:[.,]\d+)?")


def _is_topic_free(text: str) -> bool:
    return all(
        token.isdigit() or token in _FAMILY_QUERY_STOPWORDS for token in _FAMILY_TOKEN_RE.findall(text.casefold())
    )


def _joined_keys(text: str, start: int) -> list[re.Match[str]]:
    found: list[re.Match[str]] = []
    while (joined := _FAMILY_JOINED_KEY_RE.match(text, start)) is not None:
        found.append(joined)
        start = joined.end()
    return found


def family_query_number(query: str) -> str | None:
    text = (query or "").strip()
    if not text or _FAMILY_BLOCKER_RE.search(text):
        return None
    keys: set[str] = set()
    rest: list[str] = []
    cursor = 0
    for match in _FAMILY_ANCHOR_RE.finditer(text):
        keys.add(match.group(1).split(".")[0])
        rest.append(text[cursor : match.start()])
        cursor = match.end()
        for joined in _joined_keys(text, cursor):
            keys.add(joined.group(1).split(".")[0])
            cursor = joined.end()
    rest.append(text[cursor:])
    if len(keys) != 1 or not _is_topic_free(" ".join(rest)):
        return None
    return keys.pop()
