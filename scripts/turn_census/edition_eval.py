"""The Austrian edition set (``--set editions``): which OIB-RL edition binds, in which Land, on which day.

The questions are ``tests/fixtures/editions/at_edition_questions.yaml``, in four
groups, one per market requirement (docs/design/international/research/market-2026-11.md, (d)):

- ``r1``: 9 Länder × OIB-RL 1–6 on one reference day. The answer names the edition,
  the LGBl that makes it binding, its in-force date, and links RIS.
- ``r2``: the same Land and Richtlinie on both sides of a changeover day.
- ``r3``: a day or a territory the records hold no edition for. The answer says so
  and quotes no Richtlinie in its place.
- ``r5``: a false premise (wrong edition, wrong Land, a superseded instrument). The
  answer corrects it.

Every expected value is a field of a relation record in ``configs/knowledge-packs/at.json``
(:func:`binding_on` resolves it), except where RIS disagrees with the pack: such an
item is marked ``disputed_source``, expects the RIS value, names the RIS document,
and keeps the pack's value beside it. ``tests/test_edition_eval.py`` holds both to
the pack, so a pack change that moves a value fails CI until the set follows it.

The checks are patterns (an edition, an LGBl number, a date, a RIS link) except
``abstains`` and ``corrects_premise``, which are meanings and go to the judge
(``judge.py``).
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

#: A judge of meaning, as ``suite.Judge``: (check kind, question, answer) → yes, no, or None.
Judge = Callable[[str, str, str], bool | None]

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
_RIS_LINK = re.compile(r"https?://(?:www\.)?ris\.bka\.gv\.at/", re.IGNORECASE)
_LGBL_IN_PROVISION = re.compile(r"LGBl\.\s*(\d+/\d{4})")


def load_questions(path: Path = QUESTIONS) -> list[dict]:
    """Every row of the set; each has a family, so none needs a project."""
    import yaml

    return list((yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("questions") or [])


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
        "edition": re.search(r"\d{4}", edition["label"]).group(0),
        "lgbl": lgbl.group(1) if lgbl else None,
        "in_force": relation["validFrom"],
    }


def territories(records: list[dict]) -> set[str]:
    """The territories the pack holds."""
    return {r["id"] for r in records if r["type"] == "territory"}


# --- Checks ------------------------------------------------------------------


def mentions_edition(answer: str, guideline: str, year: str) -> bool:
    """Whether the answer names ``year`` as an edition: „Ausgabe Mai 2023", „OIB-RL 6:2025", „RL 2 (2019)"."""
    month = rf"(?:(?:{_MONTH_WORD})\s+)?"
    labelled = rf"(?:ausgabe|fassung|version|edition)\s+{month}{year}\b"
    number = re.escape(guideline) + r"(?![\d.]*\d)"
    named = rf"(?:oib-?rl|oib-richtlinie|richtlinie|rl)\s*{number}[\s:(,/–-]*(?:ausgabe\s+)?{month}{year}\b"
    return re.search(f"{labelled}|{named}", answer, re.IGNORECASE) is not None


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


def edition_checks(
    question: dict, answer: str, cited_families: list[str], judge: Judge | None, signals: list[str]
) -> dict[str, bool]:
    """The set's checks for one answer; nothing for a row without the set's ``expect`` keys.

    A meaning the judge could not answer is left out and named in ``signals``, never guessed.
    """
    expect = question.get("expect") or {}
    guideline = str(question.get("guideline") or "")
    checks: dict[str, bool] = {}
    if expect.get("edition"):
        checks[f"edition:{expect['edition']}"] = mentions_edition(answer, guideline, str(expect["edition"]))
    if expect.get("other_edition"):
        checks[f"other_edition:{expect['other_edition']}"] = mentions_edition(
            answer, guideline, str(expect["other_edition"])
        )
    if expect.get("lgbl"):
        checks[f"lgbl:{expect['lgbl']}"] = mentions_lgbl(answer, str(expect["lgbl"]))
    if expect.get("in_force"):
        checks[f"in_force:{expect['in_force']}"] = mentions_day(answer, str(expect["in_force"]))
    if expect.get("ris_link"):
        checks["ris_link"] = _RIS_LINK.search(answer) is not None
    if expect.get("abstain"):
        checks["no_substitute"] = guideline not in cited_families
    for flag, kind in (("abstain", "abstains"), ("premise", "corrects_premise")):
        if not expect.get(flag):
            continue
        verdict = judge(kind, str(question.get("question") or ""), answer) if judge else None
        if verdict is None:
            signals.append(f"judge_unavailable:{kind}")
        else:
            checks[kind] = verdict
    return checks


# --- Report ------------------------------------------------------------------


def report_lines(runs: list[Any], meta: dict[str, Any] | None = None) -> list[str]:
    """Each group's share of runs where every check held, with the disputed items counted apart."""
    rows = {str(q["id"]): q for q in load_questions()}
    lines = ["## Editions", "", "| Group | Items | Runs, every check held | Disputed runs, every check held |"]
    lines.append("|---|---|---|---|")
    for group in GROUPS:
        part = [run for run in runs if not run.error and rows.get(run.question_id, {}).get("group") == group]
        if not part:
            continue
        clean = [run for run in part if not rows[run.question_id].get("disputed_source")]
        disputed = [run for run in part if rows[run.question_id].get("disputed_source")]
        items = len({run.question_id for run in part})
        lines.append(f"| {group} | {items} | {_held(clean)} | {_held(disputed)} |")
    disputed_ids = sorted({run.question_id for run in runs if rows.get(run.question_id, {}).get("disputed_source")})
    if disputed_ids:
        lines += ["", f"Disputed (RIS against the OIB table; RIS is expected): {', '.join(disputed_ids)}."]
    return lines


def _held(runs: list[Any]) -> str:
    if not runs:
        return "–"
    held = sum(all(run.checks.values()) for run in runs)
    return f"{held}/{len(runs)} ({held / len(runs):.0%})"
