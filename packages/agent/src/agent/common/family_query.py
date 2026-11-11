"""Family-shaped queries: a question that names a Richtlinie and nothing else.

"Was weißt du über die OIB 2?" asks for the family, not for a passage inside
it. Semantic search answers it with whatever two documents ranked highest,
and the model then opens the rest one at a time. Detected here, the retrieval
layer can answer it with every member the corpus holds in ONE round.

Detection is pure; :func:`agent.common.norm_registry.oib_families` turns the
number this returns into the members. It reads the anchor vocabulary the
requery gate reads (``knowledge_layer.search.requery._NARROW_ANCHOR_PATTERNS``) and
adds the bare ``OIB 2`` spelling, which is how the question is usually asked.
``norm_registry`` re-exports :func:`family_query_number`, its one public name.
"""

from __future__ import annotations

import re

#: An OIB Richtlinie named by number, however a question spells it: ``OIB 2``,
#: ``OIB-RL 2``, ``OIB-Richtlinie 2.1``, ``Richtlinie 2``, ``RL 4``. The number
#: is captured; :func:`family_query_number` reduces ``2.1`` to its family.
_FAMILY_ANCHOR_RE = re.compile(
    r"\b(?:oib[-\s]*(?:rl|richtlinie)?|rl|richtlinie)[-\s]*(\d+(?:\.\d+)?)\b",
    re.IGNORECASE,
)

#: A second family key joined to an anchor without repeating it: the ``und 4``
#: in "OIB 2 und 4", the ``, 4`` in "OIB 2, 4". One or two digits (or a part
#: number), so a printing year ("OIB 2 2023", "OIB 2, 2023") is never read as a
#: key. A full stop after the key ends the sentence, not the number: only a
#: digit after it continues one. Matched right after an anchor, never on its own.
_FAMILY_JOINED_KEY_RE = re.compile(
    r"\s*(?:,|/|&|\bund\b|\boder\b|\bbzw\.?)\s*(\d{1,2}(?:\.\d+)?)(?!\d|\.\d)",
    re.IGNORECASE,
)

#: What makes a query a LOCATOR rather than a question about the whole
#: Richtlinie. A Punkt, a paragraph, a page or a table is addressed inside one
#: document, and a file name names one file: each is already answered better by
#: the ordinary path, and none of them wants four documents back.
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

#: Every word a family-shaped question may hold BESIDES its anchor: question
#: words, articles, pronouns, the verbs that ask what a document is for, the
#: overview nouns, and the edition words that name a printing rather than a
#: topic. A token outside this set is a TOPIC, and a topic question is an
#: ordinary search. "OIB 2 Fluchtweglänge GK 4" must come back as passages.
#:
#: Casefolded spellings: ``str.casefold`` writes "weißt" as "weisst", so that is
#: the form listed here.
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

#: A word or a number, with punctuation and separators dropped.
_FAMILY_TOKEN_RE = re.compile(r"[^\W\d_]+|\d+(?:[.,]\d+)?")


def _is_topic_free(text: str) -> bool:
    """True when nothing in ``text`` names a topic.

    Digits pass: what is left of "OIB 2 Ausgabe Mai 2023" once the anchor and
    the edition words are gone is a year, and a year is a printing.
    """
    return all(
        token.isdigit() or token in _FAMILY_QUERY_STOPWORDS for token in _FAMILY_TOKEN_RE.findall(text.casefold())
    )


def _joined_keys(text: str, start: int) -> list[re.Match[str]]:
    """The further keys chained onto the anchor ending at ``start``, in order.

    "OIB 2 und 4" names two families as surely as "OIB 2 und OIB 4"; without
    this the bare ``4`` falls into the leftover, where a number passes as a
    printing and the query came back as family 2 alone.
    """
    found: list[re.Match[str]] = []
    while (joined := _FAMILY_JOINED_KEY_RE.match(text, start)) is not None:
        found.append(joined)
        start = joined.end()
    return found


def family_query_number(query: str) -> str | None:
    """The Richtlinien-family a query asks about AS A WHOLE, or ``None``.

    ``"was weißt du über die OIB 2"`` and ``"OIB-Richtlinie 2.1"`` both answer
    ``"2"``: the family key, which :func:`oib_families` turns into the members
    the corpus holds. A part number resolves to its family on purpose: a
    reader who asks about 2.1 is asking inside a Richtlinie whose other parts
    they are unlikely to know exist.

    ``None`` for everything else, and that is the common answer. A query that
    still names a topic once the anchor is removed is an ordinary search; so is
    one that addresses a Punkt, a paragraph, a page, a table or a file; and so
    is one naming two families, because a single overview cannot be both,
    including when the second key is chained on without its anchor ("OIB 2
    und 4", "OIB 2, 4").
    """
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
