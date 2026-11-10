"""The Austrian edition set holds to the Austria pack (``tests/fixtures/editions/at_edition_questions.yaml``).

Every expected value is read off ``configs/knowledge-packs/at.json``: a pack change
that moves an edition, an LGBl or an in-force day fails here until the set follows
it. A row marked ``disputed_source`` expects the RIS value instead, and its ``pack``
values are held to the pack all the same, so a corrected pack says to drop the dispute.
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
    @pytest.mark.parametrize("row", [r for r in ROWS if "relation" in r], ids=lambda r: r["id"])
    def test_an_undisputed_row_expects_what_the_pack_says(self, row):
        key, values = _pack_values(row)
        assert key == row["relation"], f"{row['id']}: the pack binds {key} on {row['day']}"
        if row["group"] == "r3":
            return
        expect = row["expect"]
        for name in VALUES:
            assert expect.get(name) == values[name], f"{row['id']}: {name} is {values[name]} in the pack"

    @pytest.mark.parametrize("row", [r for r in ROWS if "disputed_source" in r], ids=lambda r: r["id"])
    def test_a_disputed_row_keeps_the_packs_values_and_cites_ris(self, row):
        dispute = row["disputed_source"]
        key, values = _pack_values(row)
        assert key == dispute["pack"]["relation"], f"{row['id']}: the pack now binds {key}"
        for name in VALUES:
            assert dispute["pack"].get(name) == values[name], f"{row['id']}: the pack's {name} moved"
        differs = [name for name in VALUES if row["expect"].get(name) != values[name]]
        assert differs, f"{row['id']}: the pack now agrees with RIS; drop disputed_source and name the relation"
        assert dispute["ris"]["url"].startswith("https://ogd.ris.bka.gv.at/")
        assert dispute["ris"]["document"] in dispute["ris"]["url"]
        assert dispute["ris"]["quote"] and dispute["note"].startswith("RIS:")

    def test_r1_and_r5_rows_carry_every_value_the_pack_holds(self):
        for row in _group("r1") + _group("r5"):
            assert row["expect"].get("edition") and row["expect"].get("ris_link"), row["id"]


class TestAbstentions:
    @pytest.mark.parametrize("row", _group("r3"), ids=lambda r: r["id"])
    def test_the_records_hold_nothing_for_that_day_or_territory(self, row):
        assert "disputed_source" not in row
        if row["land"] in edition_eval.territories(PACK):
            assert _pack_values(row)[0] is None, f"{row['id']}: the pack binds an edition that day"
        assert row["expect"] == {"abstain": True}


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


class TestChecks:
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

    def test_edition_checks_read_patterns_and_ask_the_judge_for_meanings(self):
        row = next(r for r in ROWS if r["id"] == "r1-sbg-rl6")
        answer = (
            "In Salzburg gilt die OIB-RL 6 Ausgabe März 2015 (LGBl Nr 83/2026, in Kraft seit 1. September 2026), "
            "https://www.ris.bka.gv.at/eli/lgbl/SA/2026/83. Den Text dieser Ausgabe habe ich nicht."
        )
        asked: list[str] = []

        def judge(kind: str, question: str, text: str) -> bool:
            asked.append(kind)
            return True

        signals: list[str] = []
        checks = edition_eval.edition_checks(row, answer, [], judge, signals)
        assert all(checks.values()) and asked == ["abstains"] and signals == []
        assert edition_eval.edition_checks(row, answer, ["6"], None, signals)["no_substitute"] is False
        assert signals == ["judge_unavailable:abstains"]

    def test_the_suite_skips_family_cited_for_an_abstention(self):
        row = next(r for r in ROWS if r["group"] == "r3")
        run = SimpleNamespace(kind="", cited_families=[], answer="Nicht vorhanden.", signals=[])
        assert "family_cited" not in suite.check(row, run, {"cards": []})

    def test_the_report_counts_disputed_rows_apart(self, monkeypatch):
        rows = [
            {"id": "r1-a", "group": "r1", "disputed_source": {"note": "RIS: differs"}},
            {"id": "r1-b", "group": "r1"},
        ]
        monkeypatch.setattr(edition_eval, "load_questions", lambda: rows)
        runs = [
            SimpleNamespace(question_id="r1-a", error="", checks={"a": True}),
            SimpleNamespace(question_id="r1-b", error="", checks={"a": False}),
        ]
        lines = edition_eval.report_lines(runs)
        assert "| r1 | 2 | 0/1 (0%) | 1/1 (100%) |" in lines
        assert any("r1-a" in line for line in lines)
