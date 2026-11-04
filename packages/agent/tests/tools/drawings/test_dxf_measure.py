"""``dxf_measure``: which DXF, read under which scope, and what the turn keeps of it (ADR-0153)."""

from __future__ import annotations

from typing import Any

import pytest
from agent_testing.cadastre import bev_partial_dxf
from langchain_core.messages import ToolMessage

from agent.common import bff_http
from agent.common.bff_http import SignedEnvelope
from agent.common.workspace_records import drawing_record
from agent.common.workspace_records import records_from_messages
from agent.knowledge import restricted_use
from agent.tools.drawings import register
from agent.tools.drawings import source
from agent.tools.drawings.register import DxfMeasureInput
from agent.tools.look.resolve import Resolved

COLLECTION = "project_p1_restricted_f1"
FILE = "Katasterauszug.dxf"


class _Store:
    """The object store's two calls, counted."""

    def __init__(self, data: bytes, size: int | None = None) -> None:
        self.data, self.size, self.reads = data, len(data) if size is None else size, 0

    def head_object(self, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803 - boto3's own names
        return {"ContentLength": self.size}

    def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803 - boto3's own names
        self.reads += 1
        data = self.data

        class _Body:
            def read(self, amount: int = -1) -> bytes:
                return data if amount < 0 else data[:amount]

        return {"Body": _Body()}


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> _Store:
    source.clear_cache()
    store = _Store(bev_partial_dxf())
    looked_up: list[dict[str, Any]] = []

    async def resolve(document: str) -> Resolved | str:
        if document == "missing.dxf":
            return "Not found: 'missing.dxf'."
        # The resolver drops `signed` when the canvas id lookup fails; the tool must not care.
        return Resolved(document or FILE, COLLECTION, signed=None)

    def get_json(path: str, **kwargs: Any) -> dict[str, Any]:
        looked_up.append({"path": path, **kwargs})
        if kwargs["query"]["filename"] == "foreign.dxf":
            raise bff_http.BffRefusedError("refused", status=403, body={})
        return {"storageKey": f"p1/v3/{kwargs['query']['filename']}", "storageBucket": "documents"}

    monkeypatch.setattr(source, "resolve_document", resolve)
    monkeypatch.setattr(source.project_context, "get_request_envelope_from_context", lambda: ("ctx", "sig"))
    monkeypatch.setattr(source.bff_http, "get_json", get_json)
    monkeypatch.setattr(source.seaweed_s3, "s3_client", lambda: store)
    store.looked_up = looked_up  # type: ignore[attr-defined]
    yield store
    source.clear_cache()


async def _run(**arguments: Any) -> str:
    return await register.run_dxf_measure(DxfMeasureInput(**arguments))


async def test_an_answer_names_the_file_and_measures_it(store: _Store) -> None:
    text = await _run(operation="parcel", document=FILE, parcel="123/4")
    assert text.startswith(f"File: {FILE}\n")
    assert "area 800.0 m²" in text


async def test_the_lookup_echoes_the_turns_envelope_and_names_the_collection(store: _Store) -> None:
    await _run(operation="overview")
    (call,) = store.looked_up  # type: ignore[attr-defined]
    assert call["path"] == source.DOCUMENT_FILE_PATH
    assert call["query"] == {"collection": COLLECTION, "filename": FILE}
    assert call["headers"] == SignedEnvelope("ctx", "sig").headers()


async def test_a_read_reports_its_collection_so_a_restricted_folder_is_admitted(store: _Store) -> None:
    reads: set[str] = set()
    token = restricted_use._call_reads.set(reads)
    try:
        await _run(operation="overview")
    finally:
        restricted_use._call_reads.reset(token)
    assert reads == {COLLECTION}


async def test_a_refused_file_reports_nothing_and_reads_no_bytes(store: _Store) -> None:
    reads: set[str] = set()
    token = restricted_use._call_reads.set(reads)
    try:
        text = await _run(operation="overview", document="foreign.dxf")
    finally:
        restricted_use._call_reads.reset(token)
    assert text == "'foreign.dxf' is not a file this conversation may read."
    assert reads == set()
    assert store.reads == 0


async def test_the_second_question_about_a_file_reads_no_bytes_but_still_asks_the_bff(store: _Store) -> None:
    await _run(operation="overview")
    await _run(operation="parcel", parcel="124")
    assert store.reads == 1
    assert len(store.looked_up) == 2  # type: ignore[attr-defined]


@pytest.mark.parametrize(
    ("document", "expected"),
    [
        ("missing.dxf", "Not found: 'missing.dxf'."),
        ("Grundriss.pdf", "'Grundriss.pdf' is no DXF."),
    ],
)
async def test_what_is_not_a_project_dxf_is_one_sentence(store: _Store, document: str, expected: str) -> None:
    assert (await _run(operation="overview", document=document)).startswith(expected)


async def test_an_oversized_drawing_is_refused_before_it_is_read(store: _Store) -> None:
    store.size = source.MAX_DXF_BYTES + 1
    assert "larger than 150 MB" in await _run(operation="overview")
    assert store.reads == 0


async def test_a_distance_needs_two_things(store: _Store) -> None:
    text = await _run(operation="distance", between=["123/4"])
    assert "Undecidable: 'distance' needs two things." in text


def test_an_answer_is_a_record_the_answer_check_reads_and_a_refusal_is_none() -> None:
    answer = f"File: {FILE}\nParcel 123/4 … area 800.0 m²"
    messages = [
        ToolMessage(content=answer, name="dxf_measure", tool_call_id="1"),
        ToolMessage(content="'x.pdf' is no DXF.", name="dxf_measure", tool_call_id="2"),
        ToolMessage(content=answer, name="dxf_measure", tool_call_id="3", status="error"),
    ]
    (record,) = records_from_messages(messages)
    assert (record.operation, record.outcome, record.text) == ("dxf_measure", "read", answer)
    assert drawing_record("look", answer) is None


async def test_a_run_without_an_envelope_reads_nothing(store: _Store, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(source.project_context, "get_request_envelope_from_context", lambda: (None, None))
    assert await _run(operation="overview") == source.NO_ENVELOPE
    assert store.looked_up == [] and store.reads == 0  # type: ignore[attr-defined]


async def test_a_store_that_states_no_length_is_still_bounded(store: _Store, monkeypatch: pytest.MonkeyPatch) -> None:
    store.size = 0
    store.data = b"0" * 64
    monkeypatch.setattr(source, "MAX_DXF_BYTES", 32)
    assert "larger than 150 MB" in await _run(operation="overview")


async def test_parallel_calls_on_one_file_parse_it_once(store: _Store, monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    parsed: list[int] = []
    real = source.build_site
    monkeypatch.setattr(source, "build_site", lambda *a: parsed.append(1) or real(*a))
    await asyncio.gather(*(_run(operation="overview") for _ in range(4)))
    assert parsed == [1]
    assert store.reads == 1
