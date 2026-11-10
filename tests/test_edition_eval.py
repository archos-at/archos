"""The Austrian edition set holds to the Austria pack (``tests/fixtures/editions/at_edition_questions.yaml``).

Every expected value is read off ``configs/knowledge-packs/at.json``: a pack change
that moves an edition, an LGBl or an in-force day fails here until the set follows
it. The checks are held to answers the 2026-11-10 review wrote by hand: each named the
expected edition and said the opposite.
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path
from types import SimpleNamespace

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "turn_census"))

import edition_eval  # noqa: E402
import suite  # noqa: E402

ROWS = edition_eval.load_questions()
PACK = edition_eval.load_pack()
VALUES = ("edition", "lgbl", "in_force")
LANDS = [f"AT-{n}" for n in range(1, 10)]


def _ids(rows: list[dict]) -> list[str]:
    return [str(row["id"]) for row in rows]


def _group(name: str) -> list[dict]:
    return [row for row in ROWS if row["group"] == name]


def _pack_values(row: dict) -> tuple[str | None, dict[str, str | None]]:
    relation = edition_eval.binding_on(PACK, row["land"], str(row["guideline"]), str(row["day"]))
    if relation is None:
        return None, dict.fromkeys(VALUES)
    return relation["key"], edition_eval.expected_values(PACK, relation)


class TestTheSetsShape:
    def test_ids_are_unique_and_every_row_is_in_a_group(self):
        assert len(set(_ids(ROWS))) == len(ROWS)
        assert {row["group"] for row in ROWS} == set(edition_eval.GROUPS)

    def test_r1_is_nine_lands_by_six_guidelines(self):
        cells = Counter((row["land"], str(row["guideline"])) for row in _group("r1"))
        assert set(cells) == {(land, str(n)) for land in LANDS for n in range(1, 7)}
        assert set(cells.values()) == {1}

    def test_the_other_groups_are_as_large_as_the_requirements_ask(self):
        assert len(_group("r3")) == 20
        assert len(_group("r5")) >= 30
        assert len(_group("r2")) >= 4

    def test_every_family_names_its_guideline(self):
        for row in ROWS:
            assert row["family"] == f"OIB-RL {row['guideline']}", row["id"]

    def test_the_answer_suite_selects_the_set_and_its_groups(self):
        path = suite.NORM_QUESTIONS["editions"]
        every, skipped = suite.select_questions(None, False, path)
        assert _ids(every) == _ids(ROWS) and skipped == []
        r3, _ = suite.select_questions(["r3"], False, path)
        assert _ids(r3) == _ids(_group("r3"))
        assert suite.select_questions(["r9"], False, path) is None


class TestEveryValueResolvesAgainstThePack:
    @pytest.mark.parametrize("row", ROWS, ids=lambda r: r["id"])
    def test_every_row_expects_what_the_pack_says(self, row):
        key, values = _pack_values(row)
        assert key == row["relation"], f"{row['id']}: the pack binds {key} on {row['day']}"
        if row["group"] == "r3":
            return
        expect = row["expect"]
        for name in VALUES:
            assert expect.get(name) == values[name], f"{row['id']}: {name} is {values[name]} in the pack"

    def test_r1_and_r5_rows_carry_every_value_the_pack_holds(self):
        for row in _group("r1") + _group("r5"):
            assert row["expect"].get("edition") and row["expect"].get("ris_link"), row["id"]

    @pytest.mark.parametrize("row", [r for r in ROWS if "transition" in r], ids=lambda r: r["id"])
    def test_a_transitional_rule_comes_from_the_gazette_the_new_relation_cites(self, row):
        later = max(
            (r for r in PACK if r["type"] == "relation" and r.get("relationType") == "makes_binding"),
            key=lambda r: (
                r["validFrom"] if r["key"].startswith(f"at-{row['land'][3:]}-oib-rl-{row['guideline']}-") else ""
            ),
        )
        cited = " ".join(c.get("url", "") + c.get("note", "") for c in later["citations"])
        assert row["transition"]["source"] in cited, f"{row['id']}: {later['key']} does not cite it"
        assert row["expect"]["transition"] is True and row["group"] == "r2"


class TestAbstentions:
    @pytest.mark.parametrize("row", _group("r3"), ids=lambda r: r["id"])
    def test_the_records_hold_nothing_for_that_day_or_territory(self, row):
        if row["land"] in edition_eval.territories(PACK):
            assert _pack_values(row)[0] is None, f"{row['id']}: the pack binds an edition that day"
        assert row["expect"] == {"abstain": True}

    def test_a_binding_edition_without_text_in_the_corpus_must_not_be_quoted(self):
        texts = {r["editionKey"] for r in PACK if r["type"] == "manifestation"}
        for row in _group("r1") + _group("r2") + _group("r5"):
            held = _relation(row["relation"])["to"]["key"] in texts
            asks = bool(row["expect"].get("abstain") or row["expect"].get("no_substitute"))
            assert asks is not held, row["id"]
        assert _row("r1-sbg-rl6")["expect"]["abstain"] and _row("r5-sbg-rl6")["expect"]["abstain"]


class TestFalsePremises:
    @pytest.mark.parametrize("row", _group("r5"), ids=lambda r: r["id"])
    def test_the_premise_is_false(self, row):
        premise = str(row["expect"]["premise"])
        expect = row["expect"]
        assert premise != expect["edition"], f"{row['id']}: the premise is the edition that binds"
        assert premise != expect.get("lgbl"), row["id"]
        assert premise in row["question"] or premise in row["question"].replace("Ausgabe ", ""), row["id"]


class TestPairs:
    def test_each_changeover_names_the_other_edition(self):
        pairs: dict[str, list[dict]] = {}
        for row in _group("r2"):
            pairs.setdefault(row["pair"], []).append(row)
        for name, rows in pairs.items():
            editions = {row["expect"]["edition"] for row in rows}
            for row in rows:
                other = row["expect"].get("other_edition")
                assert (other is None) == (len(editions) == 1), f"{name}: {row['id']}"
                assert other is None or other in editions - {row["expect"]["edition"]}


def _relation(key: str) -> dict:
    return next(r for r in PACK if r["type"] == "relation" and r["key"] == key)


def _row(ident: str) -> dict:
    return next(r for r in ROWS if r["id"] == ident)


def _run(answer: str, cited: list[str] | None = None) -> SimpleNamespace:
    return SimpleNamespace(kind="", cited_families=cited or [], answer=answer, signals=[])


class _Judge:
    """A judge that answers ``verdict`` and records what it was asked."""

    def __init__(self, verdict: bool | None) -> None:
        self.verdict, self.asked = verdict, []

    def __call__(self, kind: str, question: str, answer: str) -> bool | None:
        self.asked.append((kind, question))
        return self.verdict


class TestPatterns:
    @pytest.mark.parametrize(
        ("text", "guideline", "year", "found"),
        [
            ("Es gilt die OIB-RL 6 Ausgabe September 2025.", "6", "2025", True),
            ("OIB-Richtlinie 2, Ausgabe Mai 2023", "2", "2023", True),
            ("RL 6:2025 ist verbindlich", "6", "2025", True),
            ("die OIB-RL 2 (2019)", "2", "2019", True),
            ("OIB-RL 2.1 2023", "2", "2023", False),
            ("LGBl. Nr. 83/2026 aus 2023", "2", "2023", False),
        ],
    )
    def test_mentions_edition(self, text, guideline, year, found):
        assert edition_eval.mentions_edition(text, guideline, year) is found

    @pytest.mark.parametrize(
        ("text", "found"),
        [
            ("LGBl. Nr. 83/2026", True),
            ("LGBl. für Wien Nr. 26/2026", True),
            ("LGBl 83 / 2026", True),
            ("Nr. 83/2026", False),
        ],
    )
    def test_mentions_lgbl(self, text, found):
        lgbl = "26/2026" if "Wien" in text else "83/2026"
        assert edition_eval.mentions_lgbl(text, lgbl) is found

    @pytest.mark.parametrize(
        ("text", "found"),
        [
            ("ab 01.09.2026", True),
            ("ab 1.9.2026", True),
            ("mit 1. September 2026", True),
            ("2026-09-01", True),
            ("1.10.2026", False),
        ],
    )
    def test_mentions_day(self, text, found):
        assert edition_eval.mentions_day(text, "2026-09-01") is found

    @pytest.mark.parametrize(
        ("link", "lgbl_too"),
        [
            ("https://www.ris.bka.gv.at/eli/lgbl/SA/2026/83/20260806", True),
            ("https://ogd.ris.bka.gv.at/Dokumente/LgblAuth/LGBLA_SA_20260806_83/LGBLA_SA_20260806_83.xml", True),
            ("https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=LrSbg&Gesetzesnummer=20001000", False),
        ],
    )
    def test_a_ris_link_is_any_ris_host_and_the_lgbl_link_names_that_gazette(self, link, lgbl_too):
        assert edition_eval.links_ris(f"Siehe {link} .")
        assert edition_eval.links_lgbl(f"Siehe {link} .", "AT-5", "83/2026") is lgbl_too
        assert not edition_eval.links_lgbl(f"Siehe {link} .", "AT-9", "83/2026")


class TestWhichEditionTheAnswerSaysBinds:
    """The review's wrong answers (2026-11-10): each named the expected year and said the opposite."""

    def test_a_changeover_answer_that_names_the_right_year_as_the_future_one_fails(self):
        row = _row("r2-sbg-rl2-2026-09-01")
        wrong = (
            "Am 1. September 2026 gilt noch die Ausgabe 2019; die Ausgabe Mai 2023 wird erst später verbindlich "
            "(LGBl Nr 83/2026, https://www.ris.bka.gv.at/eli/lgbl/SA/2026/83)."
        )
        assert edition_eval.mentions_edition(wrong, "2", "2023")  # the year is there: a word check passes it
        no_judge = _run(wrong)
        assert edition_eval.set_checks(row, no_judge, wrong, None)["binding"] is False
        assert "judge_unavailable:binding" in no_judge.signals
        judge = _Judge(False)
        assert edition_eval.set_checks(row, _run(wrong), wrong, judge)["binding"] is False
        kind, asked = judge.asked[0]
        assert (
            kind == "binding"
            and "CLAIM: OIB-Richtlinie 2, Ausgabe 2023, is the edition binding in Salzburg on 2026-09-01" in asked
        )

    def test_a_negated_lone_year_goes_to_the_judge(self):
        row = _row("r1-bgld-rl2")
        wrong = "Nicht die Ausgabe 2019 gilt im Burgenland, sondern 2023."
        assert edition_eval.plainly_binding(wrong, "2", "2019", ["2023"]) is None
        assert edition_eval.set_checks(row, _run(wrong), wrong, _Judge(False))["binding"] is False
        assert edition_eval.set_checks(row, _run(wrong), wrong, None)["binding"] is False

    def test_a_plain_right_answer_passes_without_a_judge_and_a_missing_edition_fails_without_one(self):
        row = _row("r1-bgld-rl2")
        right = "Im Burgenland ist die OIB-RL 2 Ausgabe April 2019 verbindlich (Bgld. BauVO 2008 idF LGBl. 22/2021)."
        judge = _Judge(False)
        assert edition_eval.set_checks(row, _run(right), right, judge)["binding"] is True
        missing = "Im Burgenland gilt die OIB-RL 2 Ausgabe Mai 2023."
        assert edition_eval.set_checks(row, _run(missing), missing, judge)["binding"] is False
        assert judge.asked == []


class TestJudgedChecks:
    def test_an_abstention_that_names_a_held_edition_fails_and_no_judge_fails_too(self):
        row = _row("r3-wien-rl2-2020-01-31")
        wrong = "Damals galt die Ausgabe 2019 der OIB-RL 2."
        run = _run(wrong)
        checks = edition_eval.set_checks(row, run, wrong, None)
        assert checks["no_held_edition"] is False and checks["abstains"] is False
        assert run.signals == ["judge_unavailable:abstains"]

    def test_the_suite_records_an_unavailable_judge_after_the_precedent_checks(self, monkeypatch):
        monkeypatch.setattr(suite, "_judge", lambda: None)
        row = _row("r3-wien-rl2-2020-01-31")
        run = _run("Damals galt die Ausgabe 2019.")
        checks = suite.check(row, run, {"cards": []})
        assert checks["abstains"] is False and "judge_unavailable:abstains" in run.signals
        assert "family_cited" not in checks

    def test_a_transition_row_asks_for_the_quoted_rule(self):
        row = _row("r2-wien-rl6-2026-07-15")
        judge = _Judge(True)
        answer = "Ab 15. Juli 2026 gilt die OIB-RL 6 Ausgabe 2025; anhängige Verfahren nach bisheriger Rechtslage."
        checks = edition_eval.set_checks(row, _run(answer), answer, judge)
        assert checks["transition"] is True
        assert any(kind == "transition" and "CLAIM: Für alle zur Zeit" in asked for kind, asked in judge.asked)

    def test_the_loop_set_gets_none_of_these_checks(self):
        row = {"id": "q", "family": "OIB-RL 2", "question": "?", "expect": {"edition": "2023"}}
        checks = suite.check(row, _run("Ausgabe 2019"), {"cards": []})
        assert "binding" not in checks and "family_cited" in checks


class TestReport:
    def test_it_counts_runs_whose_judge_could_not_grade(self):
        runs = [
            SimpleNamespace(question_id="r1-wien-rl1", error="", checks={"a": True}, signals=[]),
            SimpleNamespace(
                question_id="r1-wien-rl2", error="", checks={"a": False}, signals=["judge_unavailable:binding"]
            ),
        ]
        assert "| r1 | 2 | 1/2 (50%) | 1 |" in edition_eval.report_lines(runs)
