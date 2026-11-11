"""The person's tape: the engine's answer as data, the same answer the tool renders as text (ADR-0182, slice 8)."""

from __future__ import annotations

import re
from typing import Any

import pytest
from knowledge_layer_testing.drawing_sheets import FloorSheet
from knowledge_layer_testing.sheet_fixtures import build_sheet_pdf

from agent.common import turn_file_kinds
from agent.tools.drawings import measure_register
from agent.tools.drawings import sheet_source
from agent.tools.drawings import tape
from agent.tools.drawings.tape import TapeRequest

COLLECTION = "project_p1"
FILE = "floor.pdf"
FLOOR = FloorSheet()
PDF = build_sheet_pdf([FLOOR.page])
#: Three corners of the fixture floor's first room: 4 m along the wall, then 3 m up it.
CORNERS = [FLOOR.share(0.0, 0.0), FLOOR.share(4.0, 0.0), FLOOR.share(4.0, 3.0)]


class _Store:
    def head_object(self, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803 - boto3's own names
        return {"ContentLength": len(PDF)}

    def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803 - boto3's own names
        class _Body:
            def read(self, amount: int = -1) -> bytes:
                return PDF if amount < 0 else PDF[:amount]

        return {"Body": _Body()}


@pytest.fixture
def looked_up(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    sheet_source.clear_cache()
    calls: list[dict[str, Any]] = []

    async def no_licence(_resolved: Any) -> None:
        return None

    def get_json(path: str, **kwargs: Any) -> dict[str, Any]:
        calls.append({"path": path, **kwargs})
        return {"storageKey": f"org/v1/{kwargs['query']['filename']}", "documentId": "doc-1", "versionId": "ver-1"}

    monkeypatch.setattr(sheet_source, "licence_of", no_licence)
    monkeypatch.setattr(sheet_source.project_context, "get_request_envelope_from_context", lambda: ("ctx", "sig"))
    monkeypatch.setattr(sheet_source.bff_http, "get_json", get_json)
    monkeypatch.setattr(sheet_source.seaweed_s3, "s3_client", lambda: _Store())
    monkeypatch.setattr(sheet_source.seaweed_s3, "default_bucket", lambda: "bucket")
    yield calls
    sheet_source.clear_cache()


def _request(operation: str, points: list[Any]) -> TapeRequest:
    return TapeRequest(file_name=FILE, collection=COLLECTION, page=1, operation=operation, points=points)


async def _loaded() -> sheet_source.LoadedSheet:
    loaded = await sheet_source.load_resolved_sheet(tape.Resolved(FILE, COLLECTION), 1)
    assert not isinstance(loaded, str), loaded
    return loaded


_NUMBER = r"(-?\d+\.\d{3}) m"


@pytest.mark.parametrize(("operation", "points"), [("distance", CORNERS[:2]), ("path", CORNERS), ("area", CORNERS)])
async def test_the_data_and_the_text_of_one_call_carry_the_same_value_interval_and_provenance(
    looked_up: list[dict[str, Any]], operation: str, points: list[Any]
) -> None:
    loaded = await _loaded()
    request = _request(operation, points)

    data = tape.measured(loaded, request)["measurement"]
    text, answered = measure_register.answer(loaded, tape.arguments_of(request))

    assert answered
    value, low, high = re.search(rf"{operation}: {_NUMBER}²? \(interval {_NUMBER}²? to {_NUMBER}²?\)", text).groups()
    assert (f"{data['value']:.3f}", f"{data['low']:.3f}", f"{data['high']:.3f}") == (value, low, high)
    assert f"Provenance: {data['provenance']} " in text
    assert f"Scale: 1:{data['scaleRatio']:.4g} ({data['scaleState']};" in text
    assert data["unit"] == ("m2" if operation == "area" else "m")
    assert data["low"] <= data["value"] <= data["high"]
    # No threshold is passed for a person's tape, so nothing is decided.
    assert data["verdict"] is None and data["reasons"] == []


async def test_a_refusal_is_the_engines_reason_and_remedy_as_the_text_states_them(looked_up) -> None:
    loaded = await _loaded()
    request = _request("distance", [[0.9, 0.9], [0.95, 0.95]])

    data = tape.measured(loaded, request)["noNumber"]
    text, answered = measure_register.answer(loaded, tape.arguments_of(request))

    assert not answered
    assert f"No number: {data['reason']}." in text and f"Remedy: {data['remedy']}." in text


async def test_a_snap_says_where_each_point_lands_or_that_nothing_is_in_reach(looked_up) -> None:
    loaded = await _loaded()
    near = [CORNERS[0][0] + 0.0005, CORNERS[0][1] + 0.0005]

    found = tape.snapped(loaded, _request("snap", [near, [0.95, 0.95]]))["snap"]

    assert found[0]["snapped"] == pytest.approx(CORNERS[0], abs=2e-5) and found[0]["reason"] is None
    assert found[0]["movedPt"] > 0
    assert found[1]["snapped"] is None and found[1]["reason"] == "none" and found[1]["candidates"] == []


async def test_a_distance_takes_exactly_two_points(looked_up) -> None:
    loaded = await _loaded()

    assert "noNumber" in tape.measured(loaded, _request("distance", CORNERS))


@pytest.mark.parametrize("kinds", [None, frozenset(), frozenset({"ifc"})])
async def test_a_call_the_bff_stated_no_pdf_for_is_refused_and_reads_nothing(looked_up, kinds) -> None:
    turn_file_kinds.set_stated(kinds)

    assert await tape.run_tape(_request("distance", CORNERS[:2])) == {"refused": "not_enabled"}
    assert looked_up == []


async def test_a_stated_pdf_is_measured_through_the_scoped_lookup_and_the_statement_does_not_outlive_the_call(
    looked_up,
) -> None:
    with turn_file_kinds.stating(frozenset({"pdf"})):
        answer = await tape.run_tape(_request("distance", CORNERS[:2]))

    assert answer["measurement"]["value"] == pytest.approx(4.0, abs=0.05)
    assert looked_up[0]["query"] == {"collection": COLLECTION, "filename": FILE}
    assert looked_up[0]["headers"]  # the turn's envelope, echoed
    assert not turn_file_kinds.turn_states("pdf")


async def test_a_file_that_cannot_be_read_is_a_refusal_with_its_sentence(looked_up) -> None:
    request = TapeRequest(file_name="site.dxf", collection=COLLECTION, operation="snap", points=[[0.5, 0.5]])
    with turn_file_kinds.stating(frozenset({"pdf"})):
        answer = await tape.run_tape(request)

    assert "is no PDF" in answer["noNumber"]["reason"]


@pytest.mark.parametrize("points", [[], [[1.2, 0.5]], [[0.5]], [[0.1, 0.1]] * 61])
def test_points_are_bounded_pairs(points) -> None:
    with pytest.raises(ValueError):
        _request("path", points)
