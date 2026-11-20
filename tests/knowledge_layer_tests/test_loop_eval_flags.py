from __future__ import annotations

import json

from scripts import loop_eval_flags
from scripts import loop_eval_report
from scripts import loop_eval_rows


def _steps(*payloads: tuple[str, dict]) -> list[dict]:
    return [{"name": name, "payload": json.dumps(body)} for name, body in payloads]


def _question(text="?", family="OIB-RL 2"):
    return loop_eval_rows.Question(id="q", question=text, family=family, clause=None, kind="walkthrough")


class TestRepeatQuery:
    def test_same_query_twice_is_a_repeat(self):
        payloads = loop_eval_flags._status_payloads(
            _steps(
                ("status:retrieval:0", {"values": {"query": "Fluchtweg GK4"}}),
                ("status:retrieval:1", {"values": {"query": "  fluchtweg   gk4 "}}),
            )
        )
        assert loop_eval_flags.flag_repeat_query(payloads) == "yes"

    def test_two_different_queries_are_not(self):
        payloads = loop_eval_flags._status_payloads(
            _steps(
                ("status:retrieval:0", {"values": {"query": "Fluchtweg"}}),
                ("status:retrieval:1", {"values": {"query": "Treppenbreite"}}),
            )
        )
        assert loop_eval_flags.flag_repeat_query(payloads) == "no"


class TestLocatorEligible:
    def test_a_clause_question_without_locator_is_eligible(self):
        payloads = loop_eval_flags._status_payloads(
            _steps(("status:retrieval:0", {"tools": ["knowledge_search"], "values": {"query": "x"}}))
        )
        assert (
            loop_eval_flags.flag_locator_eligible(
                _question("OIB-RL 2 Pkt 5.1, was gilt?"), payloads, ["knowledge_search"]
            )
            == "yes"
        )

    def test_a_turn_that_located_is_never_eligible(self):
        payloads = loop_eval_flags._status_payloads(
            _steps(("status:retrieval:0", {"tools": ["knowledge_search", "read_passage"]}))
        )
        tools = ["knowledge_search", "read_passage"]
        assert loop_eval_flags.flag_locator_eligible(_question("OIB-RL 2 Pkt 5.1"), payloads, tools) == "no"

    def test_a_plain_topic_is_not_eligible(self):
        payloads = loop_eval_flags._status_payloads(_steps(("status:retrieval:0", {"tools": ["knowledge_search"]})))
        question = _question("Was liegt im Ordner Brandschutz?")
        assert loop_eval_flags.flag_locator_eligible(question, payloads, ["knowledge_search"]) == "no"


class TestCapRetryAndRepair:
    def test_width_cap_with_two_rounds_is_a_retry(self):
        payloads = loop_eval_flags._status_payloads(
            _steps(
                ("status:retrieval:0", {"tools": ["knowledge_search"]}),
                ("status:width:0", {"kept": 12, "withheld": 1}),
                ("status:retrieval:1", {"tools": ["knowledge_search"]}),
            )
        )
        assert loop_eval_flags.flag_cap_retry(payloads) == "yes"

    def test_cap_without_a_second_round_is_not_a_retry(self):
        payloads = loop_eval_flags._status_payloads(_steps(("status:width:0", {})))
        assert loop_eval_flags.flag_cap_retry(payloads) == "no"

    def test_repair_step_flags_a_repair_fetch(self):
        payloads = loop_eval_flags._status_payloads(_steps(("status:repair", {})))
        assert loop_eval_flags.flag_repair_fetch(payloads) == "yes"
        assert loop_eval_flags.flag_repair_fetch([]) == "no"


class TestCrossTurnAndFamilyOverlap:
    def test_same_key_in_two_rounds_is_a_refetch(self):
        payloads = [
            (
                "retrieve.knowledge_search",
                {
                    "input": {"round": 0, "normalized_query": "a"},
                    "output": {"citation_keys": ["oib-rl_2.pdf, p.12"]},
                },
            ),
            (
                "retrieve.knowledge_search",
                {
                    "input": {"round": 1, "normalized_query": "b"},
                    "output": {"citation_keys": ["OIB-RL_2.pdf, p.12"]},
                },
            ),
        ]
        assert loop_eval_flags.flag_cross_turn(payloads) == "yes"

    def test_distinct_keys_are_not(self):
        payloads = [
            ("retrieve.knowledge_search", {"input": {"round": 0}, "output": {"citation_keys": ["a"]}}),
            ("retrieve.knowledge_search", {"input": {"round": 1}, "output": {"citation_keys": ["b"]}}),
        ]
        assert loop_eval_flags.flag_cross_turn(payloads) == "no"

    def test_two_families_are_overlap_one_is_not(self):
        assert loop_eval_flags.flag_family_overlap("OIB-RL 2", "2 3/4 4 1/1") == "yes"
        assert loop_eval_flags.flag_family_overlap("OIB-RL 2", "2 3/4") == "no"
        assert loop_eval_flags.flag_family_overlap("OIB-RL 2", "4 1/1") == "yes"
        assert loop_eval_flags.flag_family_overlap(None, "") == "no"


class TestObserveAndCsv:
    def test_observe_fills_the_new_rates(self):
        steps = _steps(
            ("status:retrieval:0", {"tools": ["knowledge_search"], "values": {"query": "OIB-RL 2 Pkt 5.1"}}),
            ("status:retrieval:1", {"tools": ["knowledge_search"], "values": {"query": "OIB-RL 2 Pkt 5.1"}}),
        )
        row = loop_eval_flags.observe(_question("OIB-RL 2 Pkt 5.1, was gilt?"), steps, "", {})
        assert row.repeat_query == "yes"
        assert row.locator_eligible == "yes"

    def test_old_csv_without_flag_columns_still_reads(self, tmp_path):
        path = tmp_path / "before.csv"
        legacy_fields = [name for name in loop_eval_rows.FIELDS if name not in loop_eval_rows._DOUBLE_FETCH_FIELDS]
        import csv

        with path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=legacy_fields)
            writer.writeheader()
            writer.writerow({name: ("q" if name == "id" else "") for name in legacy_fields})
        (row,) = loop_eval_rows.read_csv(path)
        assert row.id == "q"
        assert row.repeat_query == ""

    def test_compare_reports_a_moved_flag(self, tmp_path):
        def _row(**overrides):
            base = {
                "id": "a",
                "expected_family": "OIB-RL 2",
                "expected_clause": "",
                "expected_kind": "walkthrough",
                "kind": "walkthrough",
                "verdict": "no",
                "rounds": "2",
                "read_passage": "no",
                "clause_match": "",
                "truncated": "no",
                "checkpoint_sources": "",
                "family_coverage": "",
                "repeat_query": "yes",
                "locator_eligible": "no",
                "cap_retry": "no",
                "repair_fetch": "no",
                "cross_turn": "no",
                "family_overlap": "no",
                "error": "",
            }
            return loop_eval_rows.Observation(**{**base, **overrides})

        moved = loop_eval_report.changed_rows([_row()], [_row(repeat_query="no")])
        assert ("a", "repeat_query", "yes", "no") in moved
        report = loop_eval_report.format_comparison([_row()], [_row(repeat_query="no")])
        assert "repeat_query: 1 → 0 (-1)" in report
