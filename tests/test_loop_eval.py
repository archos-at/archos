from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

from scripts import loop_eval_flags
from scripts import loop_eval_report
from scripts import loop_eval_rows
from scripts import loop_eval_socket

REPO_ROOT = Path(__file__).resolve().parents[1]


def _load_loop_eval():
    if str(REPO_ROOT) not in sys.path:
        sys.path.insert(0, str(REPO_ROOT))
    spec = importlib.util.spec_from_file_location("scripts.loop_eval", REPO_ROOT / "scripts" / "loop_eval.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


loop_eval = _load_loop_eval()

QUESTIONS = REPO_ROOT / "tests" / "fixtures" / "derivation" / "loop_eval_questions.yaml"


def _row(question_id: str, **overrides) -> loop_eval_rows.Observation:
    base = {
        "id": question_id,
        "expected_family": "OIB-RL 2",
        "expected_clause": "5.1",
        "expected_kind": "ruling",
        "kind": "ruling",
        "verdict": "yes",
        "rounds": "2",
        "read_passage": "yes",
        "clause_match": "yes",
        "truncated": "no",
        "checkpoint_sources": "none>argument",
        "family_coverage": "2 3/4",
        "ris_calls": "1",
        "paragraph_match": "",
        "ris_citation_resolved": "",
        "error": "",
    }
    return loop_eval_rows.Observation(**{**base, **overrides})


@pytest.fixture(scope="module")
def questions():
    return loop_eval_rows.load_questions(QUESTIONS)


class TestTheQuestionSet:
    def test_it_is_thirty_one_questions_with_unique_ids(self, questions):
        assert len(questions) == 31
        assert len({q.id for q in questions}) == 31

    def test_every_question_declares_an_expected_kind(self, questions):
        assert {q.kind for q in questions} <= {"ruling", "walkthrough", "direct"}

    def test_it_carries_a_control_that_must_not_grow_a_verdict(self, questions):
        assert any(q.kind == "direct" and q.family is None for q in questions)

    def test_it_spans_more_than_one_guideline_and_reaches_provincial_law(self, questions):
        families = {q.family for q in questions}
        assert len({f for f in families if f and f.startswith("OIB-RL")}) >= 6
        assert "Bauordnung" in families

    def test_provincial_law_is_measurable_and_spans_more_than_one_land(self, questions):
        bauordnung = [q for q in questions if q.family == "Bauordnung"]
        assert len(bauordnung) >= 5
        asked = " ".join(q.question for q in bauordnung)
        assert "Innsbruck" in asked or "Tirol" in asked
        assert "Niederösterreich" in asked
        assert "Salzburg" in asked

    def test_no_bauordnung_row_claims_a_paragraph_nothing_here_can_verify(self, questions):
        assert [q.id for q in questions if q.paragraph] == []

    def test_every_expected_clause_exists_in_the_committed_structural_index(self, questions):
        import json

        index_path = REPO_ROOT / "evals" / "oib-retrieval" / "fixtures" / "clause_index.json"
        index = json.loads(index_path.read_text(encoding="utf-8"))
        unknown = [
            (q.id, q.family, q.clause)
            for q in questions
            if q.clause and q.clause not in index.get(str(q.family or "").removeprefix("OIB-RL ").strip(), {})
        ]
        assert unknown == []


class TestOneRow:
    def _steps(self, *payloads: dict) -> list[dict]:
        import json

        return [{"name": name, "payload": json.dumps(body)} for name, body in payloads]

    def test_rounds_checkpoints_and_the_locator_come_off_the_status_events(self):
        question = loop_eval_rows.Question(id="q", question="?", family="OIB-RL 2", clause="5.1", kind="ruling")
        steps = self._steps(
            ("status:retrieval:0", {"tools": ["knowledge_search"]}),
            ("status:checkpoint:0", {"round": 0, "hasConclusion": False, "source": "none"}),
            ("status:retrieval:1", {"tools": ["read_passage"]}),
            ("status:checkpoint:1", {"round": 1, "hasConclusion": True, "source": "argument"}),
        )

        row = loop_eval_flags.observe(
            question, steps, "… OIB-RL 2, Pkt. 5.1.2 …", {"kind": "ruling", "verdict": {"v": "x"}}
        )

        assert (row.rounds, row.read_passage, row.checkpoint_sources) == ("2", "yes", "none>argument")
        assert (row.kind, row.verdict, row.clause_match, row.truncated) == ("ruling", "yes", "yes", "no")

    def test_truncation_is_read_off_the_budget_event(self):
        question = loop_eval_rows.Question(id="q", question="?", family=None, clause=None, kind="direct")
        steps = self._steps(("status:budget", {"truncated": True, "spent": 7}))

        assert loop_eval_flags.observe(question, steps, "", {}).truncated == "yes"

    def test_a_child_clause_counts_and_a_sibling_does_not(self):
        assert loop_eval_flags.clause_matches("5.1", ["5.1.2"]) == "yes"
        assert loop_eval_flags.clause_matches("5.1", ["5.2"]) == "no"
        assert loop_eval_flags.clause_matches("5.1", ["5.11"]) == "no"

    def test_an_unmeasured_clause_is_blank_and_not_a_miss(self):
        assert loop_eval_flags.clause_matches(None, ["3.1"]) == ""
        assert loop_eval_report.summarise([_row("a", expected_clause="", clause_match="")]).clause_measured == 0

    def test_the_clause_scan_reads_the_forms_an_answer_actually_writes(self):
        assert loop_eval_flags.cited_clauses("Pkt. 3.5.2 und Punkt 5.1, siehe Pkt 4") == ["3.5.2", "5.1", "4"]

    def test_the_coverage_event_becomes_the_family_column(self):
        question = loop_eval_rows.Question(id="q", question="?", family="OIB-RL 2", clause=None, kind="walkthrough")
        steps = [
            {"name": "status:coverage:2", "payload": '{"family":"2","listed":4,"opened":3}'},
            {"name": "status:coverage:4", "payload": '{"family":"4","listed":1,"opened":1}'},
        ]

        assert loop_eval_flags.observe(question, steps, "", {}).family_coverage == "2 3/4 4 1/1"

    def test_a_turn_that_touched_no_family_leaves_the_cell_empty(self):
        question = loop_eval_rows.Question(id="q", question="?", family=None, clause=None, kind="direct")
        assert loop_eval_flags.observe(question, [], "", {}).family_coverage == ""


class TestLocatorEligible:
    def test_the_name_the_oib_publishes_a_guideline_under_counts(self):
        question = loop_eval_rows.Question(id="q", question="?", family=None, clause=None, kind="walkthrough")
        payloads = [("retrieve.knowledge_search", {"input": {"query": "oib-richtlinie_2.2_ausgabe_mai_2023"}})]

        assert loop_eval_flags.flag_locator_eligible(question, payloads, ["knowledge_search"]) == "yes"


class TestTheCsv:
    def test_a_run_survives_the_round_trip(self, tmp_path: Path):
        rows = [_row("a"), _row("b", rounds="1", read_passage="no", clause_match="no")]
        path = tmp_path / "run.csv"

        loop_eval_rows.write_csv(path, rows)

        assert loop_eval_rows.read_csv(path) == rows

    def test_the_header_is_the_contract(self, tmp_path: Path):
        path = tmp_path / "old.csv"
        path.write_text("id,rounds\na,2\n", encoding="utf-8")

        with pytest.raises(ValueError, match="does not carry this script's columns"):
            loop_eval_rows.read_csv(path)

    def test_an_error_row_is_written_rather_than_dropped(self, tmp_path: Path):
        path = tmp_path / "run.csv"
        loop_eval_rows.write_csv(path, [_row("a"), _row("b", kind="", rounds="", error="ReadTimeout: …")])

        back = loop_eval_rows.read_csv(path)
        assert [row.id for row in back] == ["a", "b"]
        assert loop_eval_report.summarise(back).errors == 1


class TestComparing:
    def test_it_reports_what_moved_per_question(self):
        before = [_row("a", rounds="1", read_passage="no")]
        after = [_row("a", rounds="2", read_passage="yes")]

        assert loop_eval_report.changed_rows(before, after) == [
            ("a", "rounds", "1", "2"),
            ("a", "read_passage", "no", "yes"),
        ]

    def test_an_unchanged_run_moves_nothing(self):
        assert loop_eval_report.changed_rows([_row("a")], [_row("a")]) == []

    def test_a_question_present_in_only_one_run_is_reported_not_joined_away(self):
        moved = loop_eval_report.changed_rows([_row("a")], [_row("a"), _row("b", rounds="3")])

        assert ("b", "rounds", "—", "3") in moved
        assert all(question_id == "b" for question_id, *_ in moved)

    def test_the_expectations_are_not_compared(self):
        moved = loop_eval_report.changed_rows([_row("a")], [_row("a", expected_family="OIB-RL 4")])
        assert moved == []

    def test_the_aggregate_counts_each_measure_separately(self):
        before = [_row("a", read_passage="no", rounds="1"), _row("b", read_passage="no", rounds="1")]
        after = [_row("a", read_passage="yes", rounds="2"), _row("b", read_passage="no", rounds="1")]

        report = loop_eval_report.format_comparison(before, after)

        assert "read_passage: 0 → 1 (+1)" in report
        assert "retrieval rounds, total: 2 → 3 (+1)" in report

    def test_family_coverage_is_read_as_opened_of_listed(self):
        assert loop_eval_rows.family_coverage("2 3/4 4 1/1") == [("2", 3, 4), ("4", 1, 1)]

    def test_an_empty_or_unreadable_coverage_cell_scores_nothing(self):
        assert loop_eval_rows.family_coverage("") == []
        assert loop_eval_rows.family_coverage("2 drei/vier") == []

    def test_the_aggregate_counts_complete_families_against_touched_ones(self):
        before = [_row("a", family_coverage="2 3/4")]
        after = [_row("a", family_coverage="2 4/4")]

        report = loop_eval_report.format_comparison(before, after)

        assert "families read completely: 0 → 1 (+1) of 1 → 1 (+0) touched" in report

    def test_a_family_that_became_incomplete_shows_up_per_question(self):
        moved = loop_eval_report.changed_rows(
            [_row("a", family_coverage="2 4/4")], [_row("a", family_coverage="2 3/4")]
        )
        assert moved == [("a", "family_coverage", "2 4/4", "2 3/4")]

    def test_the_checkpoint_source_histogram_is_per_round_not_per_turn(self):
        summary = loop_eval_report.summarise([_row("a", checkpoint_sources="none>argument>argument")])
        assert summary.checkpoint_sources == {"none": 1, "argument": 2}

    def test_a_first_run_compares_against_nothing_without_dividing_by_zero(self):
        report = loop_eval_report.format_comparison([], [_row("a")])
        assert "questions: 0 → 1 (+1)" in report


class TestCapRetryIsPositional:
    def test_a_fetch_after_the_cap_is_a_retry(self):
        payloads = [
            ("status:retrieval:0", {}),
            ("retrieve.knowledge", {"input": {"query": "a"}}),
            ("status:width:0", {"kept": 12, "withheld": 3}),
            ("status:retrieval:1", {}),
            ("retrieve.knowledge", {"input": {"query": "b"}}),
        ]
        assert loop_eval_flags.flag_cap_retry(payloads) == "yes"

    def test_a_cap_on_the_last_fetch_is_not_a_retry(self):
        payloads = [
            ("status:retrieval:0", {}),
            ("retrieve.knowledge", {"input": {"query": "a"}}),
            ("status:width:0", {"kept": 12, "withheld": 3}),
        ]
        assert loop_eval_flags.flag_cap_retry(payloads) == "no"

    def test_the_input_token_stop_is_a_cap(self):
        payloads = [
            ("status:budget:input", {"limit": 600000, "spent": 600001}),
            ("retrieve.knowledge", {"input": {"query": "b"}}),
        ]
        assert loop_eval_flags.flag_cap_retry(payloads) == "yes"

    def test_a_diversity_cap_on_a_retrieved_pool_counts_too(self):
        payloads = [
            ("retrieve.knowledge", {"input": {"dropped_by_cap": 3}}),
            ("retrieve.knowledge", {"input": {"query": "b"}}),
        ]
        assert loop_eval_flags.flag_cap_retry(payloads) == "yes"

    def test_no_cap_at_all_is_never_a_retry(self):
        payloads = [
            ("status:retrieval:0", {}),
            ("retrieve.knowledge", {"input": {"query": "a"}}),
            ("status:retrieval:1", {}),
            ("retrieve.knowledge", {"input": {"query": "b"}}),
        ]
        assert loop_eval_flags.flag_cap_retry(payloads) == "no"


class TestTheRisColumns:
    def _question(self, **overrides) -> loop_eval_rows.Question:
        base = {
            "id": "einreichung-wien-unterlagen",
            "question": "Welche Unterlagen verlangt die Baubehörde in Wien?",
            "family": "Bauordnung",
            "clause": None,
            "kind": "walkthrough",
        }
        return loop_eval_rows.Question(**{**base, **overrides})

    def _steps(self, *payloads: dict) -> list[dict]:
        import json

        return [{"name": name, "payload": json.dumps(body)} for name, body in payloads]

    def _span(self, *, keys: list[str] | None = None, clauses: list[str] | None = None) -> tuple[str, dict]:
        output: dict = {"picked": []}
        if keys:
            output["citation_keys"] = keys
        if clauses:
            output["clause_ids"] = clauses
        return ("retrieve.ris_lookup", {"input": {"round": 0, "tool": "ris_lookup"}, "output": output})

    def test_the_old_three_tool_shape_counts_three_calls(self):
        tools = ["ris_catalog_lookup_tool", "ris_search_tool", "ris_fetch_tool", "knowledge_search"]

        assert loop_eval_flags.count_ris_calls(tools) == 3

    def test_the_consolidated_shape_counts_one(self):
        assert loop_eval_flags.count_ris_calls(["ris_lookup_tool", "knowledge_search"]) == 1

    def test_the_renamed_lookup_counts_and_its_span_is_read(self):
        assert loop_eval_flags.count_ris_calls(["law_lookup", "ris_lookup_tool", "knowledge_search"]) == 2
        span = ("retrieve.law_lookup", {"input": {"round": 0}, "output": {"clause_ids": ["§63Abs1"]}})

        assert loop_eval_flags.paragraph_matches(self._question(), "… § 63 Abs 1 BO Wien …", [span]) == "yes"

    def test_a_turn_that_never_touched_ris_counts_zero(self):
        assert loop_eval_flags.count_ris_calls(["knowledge_search", "read_passage"]) == 0

    def test_ris_calls_is_read_off_the_round_announcements(self):
        steps = self._steps(("status:retrieval:0", {"tools": ["ris_lookup_tool"]}))

        row = loop_eval_flags.observe(self._question(), steps, "Antwort", {})

        assert row.ris_calls == "1"

    def test_a_cited_paragraph_the_turn_retrieved_matches(self):
        payloads = [self._span(clauses=["§63Abs1"])]

        assert loop_eval_flags.paragraph_matches(self._question(), "… § 63 Abs 1 BO Wien …", payloads) == "yes"

    def test_a_cited_paragraph_the_turn_never_retrieved_does_not(self):
        payloads = [self._span(clauses=["§63Abs1"])]

        assert loop_eval_flags.paragraph_matches(self._question(), "… § 99 BO Wien …", payloads) == "no"

    def test_a_committed_expectation_outranks_what_the_turn_retrieved(self):
        payloads = [self._span(clauses=["§63"])]
        question = self._question(paragraph="§ 70")

        assert loop_eval_flags.paragraph_matches(question, "… § 63 …", payloads) == "no"
        assert loop_eval_flags.paragraph_matches(question, "… § 70 Abs 2 …", payloads) == "yes"

    def test_a_turn_with_no_paragraph_to_check_is_unmeasured_not_a_miss(self):
        assert loop_eval_flags.paragraph_matches(self._question(), "Antwort ohne Paragraf", []) == ""

    def test_a_ris_citation_still_in_the_answer_resolved(self):
        payloads = [self._span(keys=["Bauordnung für Wien, § 63 Abs 1"])]
        answer = "Laut Bauordnung für Wien, § 63 Abs 1 sind die Pläne anzuschließen."

        assert loop_eval_flags.flag_ris_citation_resolved(answer, payloads) == "yes"

    def test_a_ris_citation_stripped_from_the_answer_did_not(self):
        payloads = [self._span(keys=["Bauordnung für Wien, § 63 Abs 1"])]

        assert loop_eval_flags.flag_ris_citation_resolved("Dazu kann ich nichts sagen.", payloads) == "no"

    def test_a_turn_with_no_ris_span_leaves_the_cell_empty(self):
        assert loop_eval_flags.flag_ris_citation_resolved("Antwort", []) == ""


class TestTheCli:
    def test_it_refuses_to_run_without_a_backend(self, tmp_path: Path, monkeypatch):
        monkeypatch.delenv(loop_eval.BASE_URL_ENV, raising=False)

        with pytest.raises(SystemExit) as exit_info:
            loop_eval.main(["--out", str(tmp_path / "x.csv")])

        assert exit_info.value.code == 2

    def test_compare_needs_no_backend_at_all(self, tmp_path: Path, capsys):
        before, after = tmp_path / "before.csv", tmp_path / "after.csv"
        loop_eval_rows.write_csv(before, [_row("a", rounds="1")])
        loop_eval_rows.write_csv(after, [_row("a", rounds="2")])

        assert loop_eval.main(["--compare", str(before), str(after)]) == 0
        assert "rounds" in capsys.readouterr().out


WIRE = REPO_ROOT / "contracts" / "wire" / "v2"


def _recorded(name: str) -> list[dict]:
    import json

    return [json.loads(line) for line in (WIRE / name).read_text(encoding="utf-8").splitlines() if line.strip()]


class TestTheSocket:
    def _fold(self, name: str):
        from agent.common import wire_v2

        events = [wire_v2.WIRE_EVENT.validate_python(raw) for raw in _recorded(name)]
        turn = loop_eval_socket.SocketTurn(message_id=events[0].turn_id)
        replies = [reply for event in events if (reply := loop_eval_socket.read_event(turn, event)) is not None]
        return turn, replies

    def test_an_answered_turn_becomes_a_row(self):
        turn, replies = self._fold("turn-answered.jsonl")
        question = loop_eval_rows.Question(
            id="q", question="Fluchtweg GK 4?", family="OIB-RL 2", clause=None, kind="ruling"
        )

        row = loop_eval_flags.observe(
            question, loop_eval_socket.step_records(turn), turn.result.text, turn.result.answer_meta
        )

        assert replies == []
        assert (row.rounds, row.checkpoint_sources, row.kind, row.verdict) == ("1", "argument", "ruling", "yes")
        assert (row.repeat_query, row.cross_turn, row.ris_calls) == ("no", "no", "0")

    def test_a_retrieval_step_carries_its_query_and_tools(self):
        turn, _ = self._fold("turn-answered.jsonl")

        retrieval = next(r for r in loop_eval_socket.step_records(turn) if r["name"] == "status:retrieval:0")

        assert retrieval["payload"]["tools"] == ["knowledge_search"]
        assert retrieval["payload"]["values"]["query"] == "Fluchtweglänge GK 4"

    def test_a_question_the_turn_stops_to_ask_is_skipped_in_a_valid_client_message(self):
        from agent.common import wire_v2

        turn, replies = self._fold("turn-hitl-handoff.jsonl")

        assert len(replies) == 1
        frame = replies[0].model_dump(mode="json", exclude_defaults=True)
        assert wire_v2.CLIENT_MESSAGE.validate_python(frame) == replies[0]
        assert (frame["type"], frame["turn_id"], frame["answer"]) == (
            "interaction_response",
            turn.message_id,
            {"text": loop_eval_socket.CLARIFICATION_ANSWER},
        )

    def test_a_failed_turn_raises_rather_than_writing_an_empty_row(self):
        with pytest.raises(RuntimeError, match="workflow_error"):
            self._fold("turn-error.jsonl")

    def test_an_event_of_another_turn_is_not_folded(self):
        from agent.common import wire_v2

        other = loop_eval_socket.SocketTurn(message_id="someone-else")
        for raw in _recorded("turn-answered.jsonl"):
            loop_eval_socket.read_event(other, wire_v2.WIRE_EVENT.validate_python(raw))

        assert other.steps == {}
        assert other.result is None

    def test_a_round_that_reached_a_passage_an_earlier_round_had_is_a_cross_round_fetch(self):
        from agent.common import wire_v2

        turn = loop_eval_socket.SocketTurn(message_id="t")
        for index in (0, 1):
            turn.steps[f"status:retrieval:{index}"] = wire_v2.RetrievalStep(
                id=f"status:retrieval:{index}", round=index, key="status.retrieval", tools=["knowledge_search"]
            )
        doc = {"name": "oib-rl_2.pdf", "detail": "Pkt. 5.1"}
        turn.result = wire_v2.TurnResult(
            message_id="m",
            text="",
            retrieval_ledger=[{"index": 0, "docs": [doc]}, {"index": 1, "docs": [doc]}],
        )
        payloads = loop_eval_flags._status_payloads(loop_eval_socket.step_records(turn))

        assert loop_eval_flags.flag_cross_turn(payloads) == "yes"

    def test_the_socket_url_asks_for_wire_v2_on_one_conversation(self):
        assert (
            loop_eval_socket.socket_url("https://chat.example/", "c1")
            == "wss://chat.example/websocket?v=2&conversationId=c1"
        )
        assert loop_eval_socket.socket_url("http://localhost:8001", "c1").startswith(
            "ws://localhost:8001/websocket?v=2"
        )

    def test_one_turn_over_a_served_socket(self):
        import json
        import threading

        from websockets.sync.server import serve

        from agent.common import wire_v2

        received: list[object] = []

        def handler(ws) -> None:
            ws.send(json.dumps(_recorded("hello.jsonl")[0]))
            question = wire_v2.CLIENT_MESSAGE.validate_json(ws.recv())
            received.append(question)
            for event in _recorded("turn-answered.jsonl"):
                event.update(conversation_id=question.conversation_id, turn_id=question.message_id)
                ws.send(json.dumps(event))

        with serve(handler, "127.0.0.1", 0) as server:
            threading.Thread(target=server.serve_forever, daemon=True).start()
            port = server.socket.getsockname()[1]
            steps, answer, envelope = loop_eval_socket._socket_turn(f"http://127.0.0.1:{port}", "Fluchtweg GK 4?", 10)
            server.shutdown()

        assert received[0].text == "Fluchtweg GK 4?"
        assert received[0].data_sources == list(loop_eval_socket.DATA_SOURCES)
        assert answer.startswith("Für **Gebäudeklasse 4**")
        assert envelope["kind"] == "ruling"
        assert any(step["name"] == "status:retrieval:0" for step in steps)


class TestRunsAndQuestionSetsWrittenBeforeTheRename:
    def test_a_question_row_with_the_old_key_reads_as_the_clause(self, tmp_path):
        path = tmp_path / "questions.yaml"
        path.write_text(
            "questions:\n  - {id: a, question: '?', family: OIB-RL 2, punkt: '5.1', kind: ruling}\n"
            "  - {id: b, question: '?', family: OIB-RL 2, clause: '3.2', kind: ruling}\n",
            encoding="utf-8",
        )

        assert [question.clause for question in loop_eval_rows.load_questions(path)] == ["5.1", "3.2"]

    def test_a_run_with_the_old_columns_still_compares(self, tmp_path):
        path = tmp_path / "before.csv"
        header = [
            {"expected_punkt": "expected_clause", "punkt_match": "clause_match"}.get(name, name)
            for name in loop_eval_rows.FIELDS
        ]
        old_header = [
            {"expected_clause": "expected_punkt", "clause_match": "punkt_match"}.get(name, name) for name in header
        ]
        path.write_text(",".join(old_header) + "\n" + ",".join("x" for _ in old_header) + "\n", encoding="utf-8")

        [row] = loop_eval_rows.read_csv(path)

        assert row.expected_clause == "x" and row.clause_match == "x"
