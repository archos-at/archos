import json
from pathlib import Path
from types import SimpleNamespace

from langchain_core.messages import HumanMessage

from agent.core.agent import _charge_tool_calls
from agent.core.answer_pipeline import FinalAnswer
from agent.core.ledger import assemble_result
from agent.core.ledger import build_retrieval_ledger
from agent.core.models.state import ResearchAgentState


def _announcement(index, tools, corpora, query=None, reason=None, key="status.retrieval.withQuery"):
    record = {
        "index": index,
        "key": key,
        "tools": tools,
        "corpora": corpora,
    }
    if query is not None:
        record["query"] = query
    if reason is not None:
        record["reason"] = reason
    return record


def _hit(round_index, name, detail=None, tool=None):
    hit = {"round": round_index, "name": name}
    if detail is not None:
        hit["detail"] = detail
    if tool is not None:
        hit["tool"] = tool
    return hit


def test_a_search_that_ranked_a_doc_does_not_make_the_later_open_a_repeat():
    announcements = [
        _announcement(0, ["knowledge_search"], ["knowledge"], query="OIB 2"),
        _announcement(1, ["read_passage"], ["knowledge"]),
    ]
    hits = [
        _hit(0, "oib-rl_2.pdf"),
        _hit(0, "oib-rl_2.1.pdf"),
        _hit(1, "oib-rl_2.pdf", "Pkt. 3.1"),
        _hit(1, "oib-rl_2.1.pdf", "p.3"),
    ]
    ledger = build_retrieval_ledger(announcements, hits)
    assert ledger is not None
    assert [entry["index"] for entry in ledger] == [0, 1]
    assert ledger[0]["new_docs"] == ["oib-rl_2.pdf", "oib-rl_2.1.pdf"]
    assert ledger[1]["new_docs"] == ["oib-rl_2.pdf", "oib-rl_2.1.pdf"]
    assert [doc["repeat"] for doc in ledger[1]["docs"]] == [False, False]
    assert ledger[1]["documents"] == 2
    assert ledger[0]["query"] == "OIB 2"


def test_a_family_search_opens_its_members_so_the_later_outline_read_is_a_repeat():
    announcements = [
        _announcement(0, ["knowledge_search"], ["knowledge"], query="oib 2"),
        _announcement(1, ["read_passage"], ["knowledge"]),
    ]
    hits = [
        _hit(0, "oib-rl_2.pdf", "p.4", tool="read_passage"),
        _hit(0, "oib-rl_2.1.pdf", "p.4", tool="read_passage"),
        _hit(0, "oib-rl_2.pdf", "Pkt. 3.1 p.12", tool="knowledge_search"),
        _hit(1, "oib-rl_2.pdf", "p.4", tool="read_passage"),
        _hit(1, "oib-rl_2.1.pdf", "p.4", tool="read_passage"),
    ]

    ledger = build_retrieval_ledger(announcements, hits)

    assert [doc["repeat"] for doc in ledger[0]["docs"]] == [False, False, False]
    assert [doc["repeat"] for doc in ledger[1]["docs"]] == [True, True]
    assert ledger[1]["new_docs"] == []


def test_one_document_opened_at_five_clauses_is_one_new_document():
    announcements = [
        _announcement(0, ["knowledge_search"], ["knowledge"], query="Fluchtweg"),
        _announcement(1, ["read_passage"], ["knowledge"]),
    ]
    punkte = [f"Pkt. 3.{n}" for n in range(1, 6)]
    hits = [_hit(0, "oib-rl_2.pdf"), *(_hit(1, "oib-rl_2.pdf", clause) for clause in punkte)]
    ledger = build_retrieval_ledger(announcements, hits)
    assert ledger is not None
    assert [doc["detail"] for doc in ledger[1]["docs"]] == punkte
    assert ledger[1]["hits"] == 5
    assert ledger[1]["documents"] == 1
    assert ledger[1]["new_docs"] == ["oib-rl_2.pdf"]


def test_a_round_that_re_lists_one_passage_and_finds_another_marks_only_the_first():
    announcements = [
        _announcement(0, ["knowledge_search"], ["knowledge"], query="Fluchtweg"),
        _announcement(1, ["knowledge_search"], ["knowledge"], query="Treppenraum"),
    ]
    hits = [
        _hit(0, "oib-rl_2.pdf", "p.12"),
        _hit(1, "oib-rl_2.pdf", "p.12"),
        _hit(1, "oib-rl_2.pdf", "p.60"),
    ]
    ledger = build_retrieval_ledger(announcements, hits)
    assert ledger is not None
    assert [(doc["detail"], doc["repeat"]) for doc in ledger[1]["docs"]] == [
        ("p.12", True),
        ("p.60", False),
    ]
    assert ledger[1]["new_docs"] == ["oib-rl_2.pdf"]


def test_a_mixed_round_opens_only_what_its_locator_call_returned():
    announcements = [
        _announcement(0, ["knowledge_search", "read_passage"], ["knowledge"], query="Fluchtweg"),
        _announcement(1, ["read_passage"], ["knowledge"]),
    ]
    hits = [
        _hit(0, "a.pdf", tool="knowledge_search"),
        _hit(0, "b.pdf", tool="knowledge_search"),
        _hit(0, "a.pdf", "Pkt. 1", tool="read_passage"),
        _hit(1, "b.pdf", "Pkt. 2", tool="read_passage"),
        _hit(1, "a.pdf", "Pkt. 2", tool="read_passage"),
    ]
    ledger = build_retrieval_ledger(announcements, hits)
    assert ledger is not None
    assert [(doc["name"], doc["detail"], doc["repeat"]) for doc in ledger[1]["docs"]] == [
        ("b.pdf", "Pkt. 2", False),
        ("a.pdf", "Pkt. 2", True),
    ]
    assert ledger[1]["new_docs"] == ["b.pdf"]


def test_the_tool_stamp_never_reaches_the_wire():
    announcements = [_announcement(0, ["knowledge_search"], ["knowledge"], query="Fluchtweg")]
    ledger = build_retrieval_ledger(announcements, [_hit(0, "a.pdf", "p.1", tool="knowledge_search")])
    assert ledger is not None
    assert ledger[0]["docs"] == [{"name": "a.pdf", "detail": "p.1", "repeat": False}]


def test_hits_with_no_tool_stamp_fall_back_to_the_coarse_rule():
    announcements = [
        _announcement(0, ["knowledge_search", "read_passage"], ["knowledge"], query="Fluchtweg"),
        _announcement(1, ["read_passage"], ["knowledge"]),
    ]
    hits = [_hit(0, "a.pdf"), _hit(0, "b.pdf"), _hit(1, "b.pdf", "Pkt. 2"), _hit(1, "a.pdf", "Pkt. 2")]
    ledger = build_retrieval_ledger(announcements, hits)
    assert ledger is not None
    assert [doc["repeat"] for doc in ledger[1]["docs"]] == [False, False]


def test_an_action_tool_beside_a_locator_still_counts_as_opening():
    announcements = [
        _announcement(0, ["read_passage", "emit_card"], ["knowledge"]),
        _announcement(1, ["read_passage"], ["knowledge"]),
    ]
    hits = [_hit(0, "a.pdf", "Pkt. 1"), _hit(1, "a.pdf", "Pkt. 9")]
    ledger = build_retrieval_ledger(announcements, hits)
    assert ledger is not None
    assert [doc["repeat"] for doc in ledger[1]["docs"]] == [True]


def test_the_same_passage_opened_twice_is_a_repeat():
    announcements = [
        _announcement(0, ["read_passage"], ["knowledge"]),
        _announcement(1, ["read_passage"], ["knowledge"]),
    ]
    hits = [_hit(0, "oib-rl_2.pdf", "p.12"), _hit(1, "oib-rl_2.pdf", "p.12")]
    ledger = build_retrieval_ledger(announcements, hits)
    assert ledger is not None
    assert ledger[0]["new_docs"] == ["oib-rl_2.pdf"]
    assert ledger[1]["new_docs"] == []
    assert [doc["repeat"] for doc in ledger[1]["docs"]] == [True]


def test_reopening_a_document_at_another_clause_is_a_repeat():
    announcements = [
        _announcement(0, ["read_passage"], ["knowledge"]),
        _announcement(1, ["knowledge_search"], ["knowledge"], query="Treppenraum"),
        _announcement(2, ["read_passage"], ["knowledge"]),
    ]
    hits = [
        _hit(0, "oib-rl_2.pdf", "Pkt. 3.1"),
        _hit(1, "brandschutz.pdf"),
        _hit(2, "oib-rl_2.pdf", "Pkt. 4.2"),
    ]
    ledger = build_retrieval_ledger(announcements, hits)
    assert ledger is not None
    assert ledger[2]["new_docs"] == []
    assert [doc["repeat"] for doc in ledger[2]["docs"]] == [True]


def test_new_docs_are_listed_per_round_case_insensitively():
    announcements = [
        _announcement(0, ["knowledge_search"], ["knowledge"]),
        _announcement(1, ["knowledge_search"], ["knowledge"]),
    ]
    hits = [_hit(0, "OIB-RL_2.pdf"), _hit(1, "oib-rl_2.pdf"), _hit(1, "Brandschutzkonzept.pdf")]
    ledger = build_retrieval_ledger(announcements, hits)
    assert ledger is not None
    assert ledger[1]["new_docs"] == ["Brandschutzkonzept.pdf"]


def test_no_announcements_means_no_ledger_not_an_empty_one():
    assert build_retrieval_ledger([], [_hit(0, "x.pdf")]) is None
    assert build_retrieval_ledger(None, None) is None


def test_an_announced_round_with_no_hits_stays_a_layer_without_docs():
    announcements = [_announcement(0, ["knowledge_search"], ["knowledge"])]
    ledger = build_retrieval_ledger(announcements, [])
    assert ledger is not None
    assert ledger[0]["docs"] == []
    assert ledger[0]["new_docs"] == []
    assert ledger[0]["hits"] == 0


def test_unstamped_hits_follow_capture_order_like_stream_order():
    announcements = [
        _announcement(0, ["knowledge_search"], ["knowledge"]),
        _announcement(1, ["read_passage"], ["knowledge"]),
    ]
    hits = [_hit(0, "a.pdf"), {"round": None, "name": "b.pdf"}, _hit(1, "c.pdf")]
    ledger = build_retrieval_ledger(announcements, hits)
    assert ledger is not None
    assert [doc["name"] for doc in ledger[0]["docs"]] == ["a.pdf", "b.pdf"]
    assert [doc["name"] for doc in ledger[1]["docs"]] == ["c.pdf"]
    assert ledger[1]["new_docs"] == ["c.pdf"]


def test_duplicate_name_and_detail_pairs_count_once():
    announcements = [_announcement(0, ["knowledge_search"], ["knowledge"])]
    hits = [_hit(0, "a.pdf", "p.12"), _hit(0, "a.pdf", "p.12"), _hit(0, "a.pdf", "p.31")]
    ledger = build_retrieval_ledger(announcements, hits)
    assert ledger is not None
    assert ledger[0]["hits"] == 2
    assert ledger[0]["documents"] == 1


def _response(tool_calls, content=""):
    return SimpleNamespace(tool_calls=tool_calls, content=content)


def _state(**overrides):
    return ResearchAgentState(messages=[HumanMessage(content="Was weißt du über die OIB 2?")], **overrides)


def test_charge_threads_two_rounds_with_their_facts():
    search = [{"name": "knowledge_search", "args": {"query": "OIB 2"}}]
    opens = [{"name": "read_passage", "args": {"document": "oib-rl_2.pdf", "clause": "3.5.2"}}]
    state = _state()
    rounds, retrieval_round, first = _charge_tool_calls(_response(search), state, 9)
    assert (rounds, retrieval_round) == (1, 1)
    assert first is not None
    assert first["key"] == "status.retrieval.withQuery"
    assert first["query"] == "OIB 2"
    assert "purpose" not in first
    state = state.model_copy(
        update={
            "tool_iterations": rounds,
            "retrieval_round": retrieval_round,
            "retrieval_rounds": [first],
        }
    )
    _rounds, retrieval_round, second = _charge_tool_calls(
        _response(opens, "Die Richtlinie gilt grundsätzlich."), state, 9
    )
    assert retrieval_round == 2
    assert second is not None
    assert second["key"] == "status.retrieval.clause"
    assert second["reason"] == "Die Richtlinie gilt grundsätzlich."


def test_charge_records_nothing_for_action_batches():
    state = _state()
    _rounds, retrieval_round, record = _charge_tool_calls(_response([{"name": "remember", "args": {}}]), state, 9)
    assert retrieval_round == 0
    assert record is None


def test_charge_without_tool_calls_keeps_the_tuple_shape():
    state = _state()
    assert _charge_tool_calls(_response([], "Die Antwort."), state, 9) == (0, 0, None)


def test_assemble_attaches_the_ledger_and_omits_it_without_rounds():
    announcements = [_announcement(0, ["knowledge_search"], ["knowledge"])]
    hits = [_hit(0, "oib-rl_2.pdf", "p.12")]
    graph_result = {"retrieval_rounds": announcements, "answer_measurement_grounded": False}
    final = FinalAnswer(messages=[], answered=False)
    with_rounds = assemble_result(graph_result, final, turn_sources=[], turn_measurements=[], lane_hits=hits)
    assert with_rounds.retrieval_ledger is not None
    assert with_rounds.retrieval_ledger[0]["new_docs"] == ["oib-rl_2.pdf"]
    without_rounds = assemble_result(
        {"answer_measurement_grounded": False}, final, turn_sources=[], turn_measurements=[]
    )
    assert without_rounds.retrieval_ledger is None


def test_builder_output_matches_the_wire_fixture():
    fixture = json.loads(
        Path(__file__)
        .parents[4]
        .joinpath("tests/fixtures/derivation/retrieval_ledger_wire.json")
        .read_text(encoding="utf-8")
    )
    announcements = [
        _announcement(0, ["knowledge_search"], ["knowledge"], query="Fluchtweglänge GK4"),
        _announcement(
            1,
            ["read_passage"],
            ["knowledge"],
            reason="Die Grundregel steht.",
            key="status.retrieval.clause",
        ),
        _announcement(
            2,
            ["read_passage"],
            ["knowledge"],
            reason="Die Fluchtweglänge hängt an drei Punkten.",
            key="status.retrieval.clause",
        ),
    ]
    hits = [
        {"round": 0, "name": "OIB-RL_2.pdf", "title": "OIB-Richtlinie 2, Ausgabe Mai 2023"},
        {"round": 0, "name": "Brandschutzkonzept.pdf"},
        {
            "round": 1,
            "name": "OIB-RL_2.pdf",
            "title": "OIB-Richtlinie 2, Ausgabe Mai 2023",
            "detail": "p.12",
        },
        {"round": 1, "name": "Brandschutzkonzept.pdf", "detail": "p.3"},
        *(
            {
                "round": 2,
                "name": "OIB-RL_2.pdf",
                "title": "OIB-Richtlinie 2, Ausgabe Mai 2023",
                "detail": clause,
            }
            for clause in ("Pkt. 3.1", "Pkt. 3.2", "Pkt. 3.3")
        ),
    ]
    assert build_retrieval_ledger(announcements, hits) == fixture
