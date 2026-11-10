"""The Austrian edition set (``--set editions``): which OIB-RL edition binds, in which Land, on which day.

The questions are ``tests/fixtures/editions/at_edition_questions.yaml``, in four
groups, one per market requirement (docs/design/international/research/market-2026-11.md, (d)):

- ``r1``: 9 Länder × OIB-RL 1–6 on one reference day. The answer says which edition
  binds, names the LGBl that makes it binding and its in-force day, and links RIS.
- ``r2``: the same Land and Richtlinie on both sides of a changeover day. The answer
  also names the other edition and, where the Verordnung has one, the transitional rule.
- ``r3``: a day or a territory the records hold no edition for. The answer says so,
  quotes no Richtlinie and names no edition the records hold in its place.
- ``r5``: a false premise (wrong edition, wrong Land, a superseded instrument, the
  OIB table's day where RIS differs). The answer corrects it.

Every expected value is a field of a relation record in ``configs/knowledge-packs/at.json``,
which :func:`binding_on` resolves; ``tests/test_edition_eval.py`` holds every row to it.

Which edition an answer says binds is a meaning, not a word: „gilt noch die Ausgabe
2019; die Ausgabe 2023 wird erst verbindlich" names 2023 and says the opposite. So
``binding`` fails without asking when the expected edition is never named, passes
without asking only when it is the one edition named and no negation shares its
sentence, and otherwise goes to the judge (``judge.py``) with the claim to confirm.
``abstains``, ``corrects_premise`` and ``transition`` are judged too. A judge that
cannot answer is a recorded failure, with ``judge_unavailable:<kind>`` in the
run's signals, as the precedent checks record theirs.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
QUESTIONS = ROOT / "tests" / "fixtures" / "editions" / "at_edition_questions.yaml"
PACK = ROOT / "configs" / "knowledge-packs" / "at.json"
GROUPS = ("r1", "r2", "r3", "r5")
#: The suite's generic ``family_cited`` does not apply: an abstention must cite nothing,
#: and Salzburg's binding RL 6 (März 2015) has no text in the corpus to cite.
CHECKS_FAMILY = False

#: A judge of meaning, as ``suite.Judge``: (check kind, question, answer) → yes, no, or None.
Judge = Callable[[str, str, str], bool | None]
JUDGE_UNAVAILABLE = "judge_unavailable:"

_MONTHS = (
    ("jänner", "januar"),
    ("februar",),
    ("märz",),
    ("april",),
    ("mai",),
    ("juni",),
    ("juli",),
    ("august",),
    ("september",),
    ("oktober",),
    ("november",),
    ("dezember",),
)
_MONTH_WORD = "|".join(name for names in _MONTHS for name in names)
_RIS_LINK = re.compile(r"https?://(?:www\.|ogd\.)?ris\.bka\.gv\.at/\S*", re.IGNORECASE)
_LGBL_IN_PROVISION = re.compile(r"LGBl\.\s*(\d+/\d{4})")
#: A word that turns „gilt die Ausgabe 2019" into its opposite, or into another day's statement.
_NEGATION = re.compile(
    r"\b(?:nicht|kein\w*|nie|erst|noch|bis(?:her)?|früher|ehemals|vormals|ersetzt|aufgehoben|außer kraft|abgelöst"
    r"|künftig|voraussichtlich|geplant)\b",
    re.IGNORECASE,
)
#: Words a period follows without ending the sentence („LGBl. Nr. 83/2026", „§ 9 Abs. 1").
_ABBREVIATIONS = frozenset(
    "lgbl nr abs idf lit pkt bzw vgl ca etc art bgbl gem kap ff zb dh oö nö bgld stmk sbg vbg ktn bauvo btv".split()
)
#: How an answer names each Land: the name, its adjective, its abbreviation, its Verordnung.
_LAND_WORDS = {
    "AT-1": r"burgenland\w*|bgld\b",
    "AT-2": r"kärnt\w*|k-btv",
    "AT-3": r"niederösterreich\w*|\bnö\b",
    "AT-4": r"oberösterreich\w*|\boö\b",
    "AT-5": r"salzburg\w*|\bsbg\b",
    "AT-6": r"steiermark|steirisch\w*|\bstmk\b|\bstbtv\b",
    "AT-7": r"tirol\w*|\btbv\b",
    "AT-8": r"vorarlberg\w*|\bvbg\b",
    "AT-9": r"\bwien\w*|\bwbtv\b",
}
#: A measure a requirement states: 1,20 m, 30 min, 47 dB, 0,35 W/m²K, 10 %.
_MEASURE = re.compile(r"\d+(?:[,.]\d+)?\s*(?:mm|cm|m²|m³|m|min|minuten|db|w/|kwh|lx|%|prozent)(?![a-zäöü])", re.I)
_ANY_EDITION = re.compile(r"(?:ausgabe|fassung|version|edition)\s+(?:\w+\s+)?(?:19|20)\d{2}\b", re.I)
#: The Land's code in RIS gazette ids and ELI paths (``LGBLA_SA_…``, ``/eli/lgbl/SA/2026/83``),
#: as `configs/norms/at/registry.yml` cites them.
RIS_LAND_CODES = {
    "AT-1": "BU",
    "AT-2": "KA",
    "AT-3": "NI",
    "AT-4": "OB",
    "AT-5": "SA",
    "AT-6": "ST",
    "AT-7": "TI",
    "AT-8": "VO",
    "AT-9": "WI",
}


def load_questions(path: Path = QUESTIONS) -> list[dict]:
    """Every row of the set, each marked as the set's own so the suite checks it with :func:`set_checks`."""
    import yaml

    rows = (yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("questions") or []
    return [{**row, "set": "editions"} for row in rows]


# --- The pack ----------------------------------------------------------------


def load_pack(path: Path = PACK) -> list[dict]:
    """The Austria pack's records."""
    return json.loads(path.read_text(encoding="utf-8"))["records"]


def binding_on(records: list[dict], land: str, guideline: str, day: str) -> dict | None:
    """The relation that makes OIB-RL ``guideline`` binding in ``land`` on ``day`` (ISO), or None.

    ``validTo`` is exclusive: the pack closes a relation on the day its successor starts.
    """
    works = {r["key"]: r for r in records if r["type"] == "work"}
    editions = {r["key"]: r for r in records if r["type"] == "edition"}
    for relation in records:
        if relation["type"] != "relation" or relation["relationType"] != "makes_binding":
            continue
        source = works.get(relation["from"]["key"]) or {}
        edition = editions.get(relation["to"]["key"]) or {}
        if land not in source.get("territoryIds", []) or edition.get("workKey") != f"oib-rl-{guideline}":
            continue
        if relation["validFrom"] <= day and (relation["validTo"] is None or day < relation["validTo"]):
            return relation
    return None


def expected_values(records: list[dict], relation: dict) -> dict[str, str | None]:
    """What an answer must name for this relation: the edition's year, the LGBl, the in-force day."""
    edition = next(r for r in records if r["type"] == "edition" and r["key"] == relation["to"]["key"])
    lgbl = _LGBL_IN_PROVISION.search(relation.get("provision") or "")
    return {
        "edition": _year(edition["label"]),
        "lgbl": lgbl.group(1) if lgbl else None,
        "in_force": relation["validFrom"],
    }


def held_editions(records: list[dict], guideline: str) -> list[str]:
    """The years of every edition of OIB-RL ``guideline`` the pack holds."""
    return sorted(
        {_year(r["label"]) for r in records if r["type"] == "edition" and r["workKey"] == f"oib-rl-{guideline}"}
    )


def territories(records: list[dict]) -> dict[str, str]:
    """The territories the pack holds, id → name."""
    return {r["id"]: r["name"] for r in records if r["type"] == "territory"}


def _year(label: str) -> str:
    found = re.search(r"\d{4}", label)
    return found.group(0) if found else ""


# --- Patterns ----------------------------------------------------------------


def _edition_pattern(guideline: str, year: str) -> str:
    month = rf"(?:(?:{_MONTH_WORD})\s+)?"
    labelled = rf"(?:ausgabe|fassung|version|edition)\s+{month}{year}\b"
    number = re.escape(guideline) + r"(?![\d.]*\d)"
    named = rf"(?:oib-?rl|oib-richtlinie|richtlinie|rl)\s*{number}[\s:(,/–-]*(?:ausgabe\s+)?{month}{year}\b"
    return f"{labelled}|{named}"


def mentions_edition(answer: str, guideline: str, year: str) -> bool:
    """Whether the answer names ``year`` as an edition: „Ausgabe Mai 2023", „OIB-RL 6:2025", „RL 2 (2019)"."""
    return re.search(_edition_pattern(guideline, year), answer, re.IGNORECASE) is not None


def mentions_lgbl(answer: str, lgbl: str) -> bool:
    """Whether the answer names „LGBl. [für Wien] [Nr.] 26/2026"."""
    number, year = lgbl.split("/")
    return re.search(rf"lgbl\.?[^\n]{{0,25}}?\b{number}\s*/\s*{year}\b", answer, re.IGNORECASE) is not None


def mentions_day(answer: str, day: str) -> bool:
    """Whether the answer names the ISO ``day`` the way a reader writes it: 15.07.2026, 15. Juli 2026, 2026-07-15."""
    year, month, date = day.split("-")
    d, m = int(date), int(month)
    months = "|".join(_MONTHS[m - 1])
    patterns = (
        rf"\b0?{d}\.\s*0?{m}\.\s*{year}\b",
        rf"\b0?{d}\.?\s*(?:{months})\s+{year}\b",
        rf"\b{year}-{month}-{date}\b",
    )
    return any(re.search(pattern, answer, re.IGNORECASE) for pattern in patterns)


def links_ris(answer: str) -> bool:
    """Whether the answer links RIS: the citizen site or the open-data gazette (``ogd.ris.bka.gv.at``)."""
    return _RIS_LINK.search(answer) is not None


def links_lgbl(answer: str, land: str, lgbl: str) -> bool:
    """Whether a RIS link points at that LGBl, by gazette id (``LGBLA_SA_…_83``) or ELI (``eli/lgbl/SA/2026/83``)."""
    code = RIS_LAND_CODES.get(land)
    if code is None:
        return False
    number, year = lgbl.split("/")
    target = re.compile(rf"LGBLA_{code}_{year}\d{{4}}_{number}\b|/eli/lgbl/{code}/{year}/{number}\b", re.IGNORECASE)
    return any(target.search(link.group(0)) for link in _RIS_LINK.finditer(answer))


def plainly_binding(
    answer: str, guideline: str, year: str, others: list[str], *, land: str = "", days: tuple[str, ...] = ()
) -> bool | None:
    """True or False when the answer settles it without a reader, None when only a reader can tell.

    False: the expected edition is never named. True: it is the only edition named, and no
    sentence naming it negates it, moves it in time (a date other than ``days``: the asked day
    and the in-force day), or speaks of another Land than ``land``. Anything else is a meaning.
    """
    if not mentions_edition(answer, guideline, year):
        return False
    if any(mentions_edition(answer, guideline, other) for other in others):
        return None
    pattern = re.compile(_edition_pattern(guideline, year), re.IGNORECASE)
    sentences = [s for s in _sentences(answer) if pattern.search(s)]
    other_lands = [words for code, words in _LAND_WORDS.items() if code != land]
    for sentence in sentences:
        if _NEGATION.search(sentence) or set(_dates(sentence)) - set(days):
            return None
        if any(re.search(words, sentence, re.IGNORECASE) for words in other_lands):
            return None
    return True


def states_a_requirement_of_an_edition(answer: str) -> bool:
    """Whether a sentence names an edition (any year) and a measure: a requirement given from some text."""
    return any(_ANY_EDITION.search(s) and _MEASURE.search(s) for s in _sentences(answer))


def _sentences(text: str) -> list[str]:
    """``text`` cut at sentence ends: not after a number („1. September") or an abbreviation („LGBl.", „Abs.")."""
    sentences, start = [], 0
    for end in re.finditer(r"[.;!?](?=\s)|\n+", text):
        word = re.search(r"(\S+)$", text[start : end.start()])
        token = word.group(1).lstrip('(„"').casefold() if word else ""
        if end.group(0) == "." and (token.isdigit() or len(token) == 1 or token in _ABBREVIATIONS):
            continue
        sentences.append(text[start : end.end()])
        start = end.end()
    return [s for s in [*sentences, text[start:]] if s.strip()]


def _dates(text: str) -> list[str]:
    """Every full date in ``text``, as ISO."""
    months = {name: n for n, names in enumerate(_MONTHS, start=1) for name in names}
    found = [
        f"{y}-{int(m):02d}-{int(d):02d}" for d, m, y in re.findall(r"\b(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\b", text)
    ]
    found += [
        f"{y}-{months[m.lower()]:02d}-{int(d):02d}"
        for d, m, y in re.findall(rf"\b(\d{{1,2}})\.?\s*({_MONTH_WORD})\s+(\d{{4}})\b", text, re.IGNORECASE)
    ]
    return found + re.findall(r"\b\d{4}-\d{2}-\d{2}\b", text)


# --- Checks ------------------------------------------------------------------


def set_checks(
    question: dict, run: Any, answer: str, judge: Judge | None, records: list[dict] | None = None
) -> dict[str, bool]:
    """The set's checks for one answer (the suite calls this for every row of the set, after its generic checks)."""
    records = records if records is not None else load_pack()
    prose = str(getattr(run, "answer", "") or "") or answer  # the judge reads the answer as written
    expect = question.get("expect") or {}
    guideline = str(question.get("guideline") or "")
    checks: dict[str, bool] = {}
    if expect.get("edition"):
        checks["binding"] = _binding(question, answer, prose, judge, records, run.signals)
    if expect.get("other_edition"):
        checks["other_edition"] = mentions_edition(answer, guideline, str(expect["other_edition"]))
    if expect.get("lgbl"):
        checks["lgbl"] = mentions_lgbl(answer, str(expect["lgbl"]))
    if expect.get("in_force"):
        checks["in_force"] = mentions_day(answer, str(expect["in_force"]))
    if expect.get("ris_link"):
        checks["ris_link"] = links_ris(answer)
        if expect.get("lgbl"):
            checks["ris_lgbl"] = links_lgbl(answer, str(question.get("land")), str(expect["lgbl"]))
    if expect.get("abstain") or expect.get("no_substitute"):
        checks["no_substitute"] = guideline not in run.cited_families
    if expect.get("abstain"):
        if question.get("group") == "r3":
            held = held_editions(records, guideline)
            checks["no_held_edition"] = not any(mentions_edition(answer, guideline, year) for year in held)
            checks["no_remembered_requirement"] = not states_a_requirement_of_an_edition(answer)
    asked = str(question.get("question") or "")
    for flag, kind, claim in (
        ("abstain", "abstains", None),
        ("premise", "corrects_premise", None),
        ("transition", "transition", (question.get("transition") or {}).get("quote")),
    ):
        if expect.get(flag):
            prompt = f"{asked}\nCLAIM: {claim}" if claim else asked
            checks[kind] = _judged(judge, kind, prompt, prose, run.signals)
    return checks


def _binding(
    question: dict, answer: str, prose: str, judge: Judge | None, records: list[dict], signals: list[str]
) -> bool:
    expect = question["expect"]
    guideline, year = str(question["guideline"]), str(expect["edition"])
    others = [held for held in held_editions(records, guideline) if held != year]
    days = (str(question["day"]), str(expect.get("in_force") or question["day"]))
    plain = plainly_binding(answer, guideline, year, others, land=str(question.get("land")), days=days)
    if plain is not None:
        return plain
    land = territories(records).get(str(question.get("land")), str(question.get("land")))
    claim = f"OIB-Richtlinie {guideline}, Ausgabe {year}, is the edition binding in {land} on {question['day']}."
    return _judged(judge, "binding", f"{question.get('question') or ''}\nCLAIM: {claim}", prose, signals)


def _judged(judge: Judge | None, kind: str, question: str, answer: str, signals: list[str]) -> bool:
    """The judge's verdict; a judge that cannot answer is a failure, named in ``signals``."""
    verdict = judge(kind, question, answer) if judge is not None and answer.strip() else None
    if verdict is None and answer.strip():
        signals.append(f"{JUDGE_UNAVAILABLE}{kind}")
    return bool(verdict)


# --- Report ------------------------------------------------------------------


def report_lines(runs: list[Any], meta: dict[str, Any] | None = None) -> list[str]:
    """Each group's share of runs where every check held, and how many runs the judge could not grade."""
    rows = {str(q["id"]): q for q in load_questions()}
    lines = [
        "## Editions",
        "",
        "| Group | Items | Runs, every check held | Runs with a check the judge could not grade |",
    ]
    lines.append("|---|---|---|---|")
    for group in GROUPS:
        part = [run for run in runs if not run.error and rows.get(run.question_id, {}).get("group") == group]
        if not part:
            continue
        held = sum(all(run.checks.values()) for run in part)
        ungraded = sum(any(s.startswith(JUDGE_UNAVAILABLE) for s in run.signals) for run in part)
        items = len({run.question_id for run in part})
        lines.append(f"| {group} | {items} | {held}/{len(part)} ({held / len(part):.0%}) | {ungraded} |")
    return lines
