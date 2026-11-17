from __future__ import annotations

from types import SimpleNamespace

import pytest
from knowledge_layer.search import format_results
from knowledge_layer.search.trace_lanes import _trace_lanes_for_chunks

from agent.common.legacy_lane_names import LEGACY_AGENT_AUTHORED_LANE
from agent.common.source_kinds import AGENT_AUTHORED_LANE_LABEL
from agent.common.wire_v2 import TraceLane
from agent.common.wire_v2 import TraceLaneSource


@pytest.fixture(autouse=True)
def _reset_retrieval_round():
    from agent.common.turn_status import _retrieval_round

    _retrieval_round.set(None)
    yield
    _retrieval_round.set(None)


def _chunk(
    *,
    file_name: str,
    page: int | None = None,
    collection: str | None = None,
    shelf: str | None = None,
    doc_class: str | None = None,
    provenance: dict[str, str] | None = None,
):
    metadata: dict[str, str] = {}
    if collection:
        metadata["collection"] = collection
    if shelf:
        metadata["shelf"] = shelf
    if doc_class:
        metadata["doc_class"] = doc_class
    if provenance:
        metadata.update(provenance)
    return SimpleNamespace(
        file_name=file_name,
        page_number=page,
        content="snippet",
        content_type=SimpleNamespace(value="text"),
        score=0.9,
        metadata=metadata,
    )


def test_trace_lanes_sources_carry_the_shelf_the_hit_stated():
    (lane,) = _trace_lanes_for_chunks([_chunk(file_name="Konzept.pdf", page=1, collection="proj_abc", shelf="project")])
    assert lane.sources[0].shelf == "project"


def test_trace_lanes_lane_is_decided_by_the_stated_shelf_not_a_collection_guess():
    (lane,) = _trace_lanes_for_chunks(
        [_chunk(file_name="Plan.pdf", page=2, collection="c_9f2a", shelf="project", doc_class="other")]
    )
    assert lane.key == "project"


def test_trace_lanes_group_by_lane():
    chunks = [
        _chunk(file_name="OIB-RL_2_Brandschutz.pdf", page=12, collection="oib_knowledge"),
        _chunk(file_name="Konzept.pdf", page=1, collection="proj_abc"),
        _chunk(file_name="Vorlage.pdf", collection="archiv_org1"),
    ]
    lanes = _trace_lanes_for_chunks(chunks)
    assert [lane.key for lane in lanes] == ["building_law_oib", "project", "office"]
    assert lanes[0] == TraceLane(
        key="building_law_oib",
        label="OIB-Richtlinie",
        kind="building_law",
        hit_count=1,
        sources=[TraceLaneSource(name="OIB-RL_2_Brandschutz.pdf", title="OIB-Richtlinie 2", detail="p.12")],
    )


def test_trace_lanes_sources_carry_the_display_title():
    (lane,) = _trace_lanes_for_chunks(
        [_chunk(file_name="oib-rl_2.3_ausgabe_mai_2023.pdf", page=4, collection="oib_knowledge")]
    )
    assert (lane.sources[0].name, lane.sources[0].title) == (
        "oib-rl_2.3_ausgabe_mai_2023.pdf",
        "OIB-Richtlinie 2.3, Ausgabe Mai 2023",
    )


def test_trace_lanes_omit_title_when_it_would_repeat_the_filename():
    (lane,) = _trace_lanes_for_chunks([_chunk(file_name="Konzept.pdf", page=1, collection="proj_abc")])
    assert (lane.sources[0].name, lane.sources[0].title) == ("Konzept.pdf", None)


def test_trace_lanes_sources_carry_the_retrieval_round():
    from agent.common.turn_status import retrieval_round_scope

    with retrieval_round_scope(1):
        (lane,) = _trace_lanes_for_chunks(
            [_chunk(file_name="Konzept.pdf", page=1, collection="proj_abc", shelf="project")]
        )
    assert lane.sources[0].round == 1


def test_emitted_hits_are_captured_for_the_per_round_ledger():
    from agent.common.turn_status import begin_lane_capture
    from agent.common.turn_status import end_lane_capture
    from agent.common.turn_status import get_lane_captures
    from agent.common.turn_status import retrieval_round_scope

    token = begin_lane_capture()
    try:
        with retrieval_round_scope(0):
            _trace_lanes_for_chunks([_chunk(file_name="OIB-RL_2.pdf", page=12, collection="oib_knowledge")])
        with retrieval_round_scope(1):
            _trace_lanes_for_chunks([_chunk(file_name="OIB-RL_2.pdf", page=31, collection="oib_knowledge")])
        hits = get_lane_captures()
    finally:
        end_lane_capture(token)
    assert [(hit["round"], hit["name"], hit.get("detail")) for hit in hits] == [
        (0, "OIB-RL_2.pdf", "p.12"),
        (1, "OIB-RL_2.pdf", "p.31"),
    ]


def test_a_search_result_is_one_sources_step_built_from_its_records(emitted):
    from agent.common.tool_calls import READ_PASSAGE_TOOL
    from agent.common.turn_status import lane_tool_scope
    from agent.common.turn_status import retrieval_round_scope

    chunks = [_chunk(file_name="OIB-RL_4.pdf", page=3, collection="oib_knowledge")]
    with retrieval_round_scope(2), lane_tool_scope(READ_PASSAGE_TOOL):
        format_results(SimpleNamespace(success=True, chunks=chunks, error_message=None), "q")
        lanes = list(_trace_lanes_for_chunks(chunks))
    (step,) = emitted.steps
    assert (step.kind, step.round, step.tool, step.lanes) == ("sources", 2, "read_passage", lanes)


def test_format_results_appends_trace_lanes_block():
    result = SimpleNamespace(
        success=True,
        chunks=[_chunk(file_name="OIB-RL_4.pdf", page=3, collection="oib_knowledge")],
        error_message=None,
    )
    text = format_results(result, "test query")
    assert "## Trace-Lanes" in text
    assert "building_law_oib" in text
    assert "OIB-RL_4.pdf" in text


def test_format_results_empty_chunks_skips_trace_block():
    result = SimpleNamespace(success=True, chunks=[], error_message=None)
    text = format_results(result, "q")
    assert "Trace-Lanes" not in text


_AGENT_FILED = {
    "authored_by": "agent",
    "approved_by": "Maria Huber",
    "approved_at": "2026-09-01",
    "producer": "piloti-chat",
}


def test_a_published_agent_document_gets_its_own_lane_inside_the_office_kind():
    (lane,) = _trace_lanes_for_chunks(
        [
            _chunk(
                file_name="Brandschutzkonzept Haus B.md",
                page=1,
                collection="proj_abc",
                shelf="project",
                provenance=_AGENT_FILED,
            )
        ]
    )
    assert (lane.key, lane.label, lane.kind) == (LEGACY_AGENT_AUTHORED_LANE, AGENT_AUTHORED_LANE_LABEL, "office")


def test_the_fan_out_carries_the_provenance_as_data_not_as_a_sentence():
    (lane,) = _trace_lanes_for_chunks(
        [_chunk(file_name="Konzept.md", page=1, shelf="project", provenance=_AGENT_FILED)]
    )
    assert (lane.sources[0].provenance, lane.sources[0].shelf) == (_AGENT_FILED, "project")


def test_an_unmarked_hit_carries_no_provenance_at_all():
    (lane,) = _trace_lanes_for_chunks([_chunk(file_name="Konzept.pdf", page=1, shelf="project")])
    assert lane.sources[0].provenance is None


def test_the_grounding_block_states_who_released_the_document_in_one_line():
    result = SimpleNamespace(
        success=True,
        chunks=[_chunk(file_name="Brandschutzkonzept.md", page=1, shelf="project", provenance=_AGENT_FILED)],
        error_message=None,
    )
    text = format_results(result, "brandschutz")
    assert f"Herkunft: {AGENT_AUTHORED_LANE_LABEL} · freigegeben von Maria Huber am 01.09.2026" in text
    assert "freigegeben" not in text.replace(
        f"Herkunft: {AGENT_AUTHORED_LANE_LABEL} · freigegeben von Maria Huber am 01.09.2026", ""
    )


def test_an_unmarked_hit_is_formatted_exactly_as_before():
    chunk = _chunk(file_name="Konzept.pdf", page=1, shelf="project")
    text = format_results(SimpleNamespace(success=True, chunks=[chunk], error_message=None), "q")
    assert "Herkunft" not in text
