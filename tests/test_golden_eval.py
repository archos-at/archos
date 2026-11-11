"""The golden set scores as the door's golden run does, and sees what the old scorecard missed.

``scripts/turn_census/golden_eval.py`` mirrors ``apps/workspace/bff/base-knowledge/golden/score.ts``.
``tests/fixtures/golden/scoring_parity.json`` holds recorded answers of the before-baseline with the
verdict both must give (``score.spec.ts`` writes it); a scorer that drifts from the other fails here.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "turn_census"))

import golden_eval  # noqa: E402

PACK = REPO_ROOT / "configs" / "knowledge-packs" / "at-golden-cases.json"
PARITY = json.loads((REPO_ROOT / "tests" / "fixtures" / "golden" / "scoring_parity.json").read_text("utf-8"))
CASES = {case["key"]: case for case in golden_eval.load_cases(PACK)}


@pytest.mark.parametrize("entry", PARITY["answers"], ids=lambda entry: entry["baseline"])
def test_scores_a_recorded_answer_as_the_door_does(entry: dict) -> None:
    assert golden_eval.score(CASES[entry["case"]], entry["answer"]) == entry["expect"]


def test_a_case_nothing_decides_is_unverified_not_passed() -> None:
    case = {
        "expected": {"values": [{"label": "distance", "anyOf": ["40 m"], "grounding": "unconfirmed"}]},
        "mustNot": [],
    }
    scored = golden_eval.score(case, {"text": "At most 40 m.", "sources": []})
    assert scored["unverified"] is True
    assert scored["passed"] is False
    assert scored["scores"]["golden-case-passed"] is False


@pytest.mark.parametrize("baseline", ["B1", "B9", "B10", "B11"])
def test_sees_high_confidence_with_an_open_point(baseline: str) -> None:
    entry = next(entry for entry in PARITY["answers"] if entry["baseline"] == baseline)
    assert entry["answer"]["confidence"]["level"] == "high"
    scored = golden_eval.score(CASES[entry["case"]], entry["answer"])
    assert not scored["passed"]
    assert "must_not:confident-despite-open-point" in scored["failed"]


@pytest.mark.parametrize(
    ("text", "phrase", "found"),
    [
        ("höchstens 40 m Gehweglänge", "40 m", True),
        ("140 m", "40 m", False),
        ("40 mm", "40 m", False),
        ("nach § 50 Abs. 1", "§ 50", True),
        ("§ 500", "§ 50", False),
        ("Ausgabe MAI 2023", "Mai 2023", True),
    ],
)
def test_a_phrase_is_found_as_its_own_words(text: str, phrase: str, found: bool) -> None:
    assert golden_eval.holds_phrase(text, phrase) is found


def test_every_case_is_a_suite_question_with_its_site() -> None:
    questions = golden_eval.load_questions(PACK)
    assert len(questions) == 28
    assert {question["set"] for question in questions} == {"golden"}
    first = next(question for question in questions if question["id"] == "at-b01-escape-route-vienna")
    assert first["territory"] == "AT-9"
    assert first["golden"]["expected"]["values"][0]["anyOf"] == ["40 m", "40 Meter"]


def test_a_suite_run_is_checked_by_its_case() -> None:
    question = next(q for q in golden_eval.load_questions(PACK) if q["id"] == "at-b10-fire-resistance-load-bearing-gk4")
    answer = (
        "Tragende Wände der GK 4: R 30 im obersten Geschoß, sonst R 60, unterirdisch R 90 und A2 (Tabelle 1b).\n\n"
        "## Quellen\n- [1] [KB] OIB-Richtlinie 2, Ausgabe Mai 2023, p.26\n"
    )
    run = SimpleNamespace(answer=answer, confidence="medium", confidence_reason="Tabelle gelesen")
    checks = golden_eval.set_checks(question, run, answer, None)
    assert all(checks.values()), checks
    assert "value:top storey" in checks and "edition:oib-rl-2-2023" in checks

    web = answer.replace("[KB] OIB-Richtlinie 2", "[Web] OIB-Richtlinie 2")
    checks = golden_eval.set_checks(question, SimpleNamespace(answer=web), web, None)
    assert checks["must_not:web-copy-of-held-text"] is False


def test_the_set_needs_its_cases_file() -> None:
    golden_eval.CASES_FILE = None
    with pytest.raises(SystemExit):
        golden_eval.load_questions()
