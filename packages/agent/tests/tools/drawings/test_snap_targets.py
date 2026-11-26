from __future__ import annotations

from typing import Any

import pytest
from knowledge_layer_testing.drawing_sheets import FloorSheet
from knowledge_layer_testing.sheet_fixtures import build_sheet_pdf

from agent.common import turn_file_kinds
from agent.tools.drawings import sheet_source
from agent.tools.drawings import snap_targets
from agent.tools.drawings.snap_targets import SnapTargetsRequest

COLLECTION = "project_p1"
FILE = "floor.pdf"
FLOOR = FloorSheet()
PDF = build_sheet_pdf([FLOOR.page])
CALIBRATION = {
    "region": {"x": 0.1, "y": 0.1, "w": 0.3, "h": 0.3},
    "from": {"x": 0.2, "y": 0.2},
    "to": {"x": 0.3, "y": 0.2},
    "lengthM": 5.0,
}


class _Store:
    reads = 0

    def head_object(self, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803 - boto3's own names
        return {"ContentLength": len(PDF)}

    def get_object(self, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803 - boto3's own names
        _Store.reads += 1

        class _Body:
            def read(self, amount: int = -1) -> bytes:
                return PDF if amount < 0 else PDF[:amount]

        return {"Body": _Body()}


@pytest.fixture
def stored(monkeypatch: pytest.MonkeyPatch) -> list[list[dict[str, Any]]]:
    sheet_source.clear_cache()
    _Store.reads = 0
    calibrations: list[list[dict[str, Any]]] = [[]]
    asked: list[dict[str, Any]] = []
    monkeypatch.setattr(snap_targets, "asked_of_the_bff", asked, raising=False)

    async def no_licence(_resolved: Any) -> None:
        return None

    def get_json(path: str, **kwargs: Any) -> dict[str, Any]:
        asked.append(kwargs["query"])
        return {
            "storageKey": "org/v1/floor.pdf",
            "documentId": "doc-1",
            "versionId": "ver-1",
            "calibrations": calibrations[0],
        }

    monkeypatch.setattr(sheet_source, "licence_of", no_licence)
    monkeypatch.setattr(sheet_source.project_context, "get_request_envelope_from_context", lambda: ("ctx", "sig"))
    monkeypatch.setattr(sheet_source.bff_http, "get_json", get_json)
    monkeypatch.setattr(sheet_source.seaweed_s3, "s3_client", lambda: _Store())
    monkeypatch.setattr(sheet_source.seaweed_s3, "default_bucket", lambda: "bucket")
    yield calibrations
    sheet_source.clear_cache()


async def _targets(file_name: str = FILE) -> dict[str, Any]:
    with turn_file_kinds.stating(frozenset({"pdf"})):
        return await snap_targets.run_snap_targets(SnapTargetsRequest(file_name=file_name, collection=COLLECTION))


async def test_it_lists_the_pages_targets_with_its_version_size_and_scales(stored) -> None:
    targets = (await _targets())["targets"]

    assert (targets["documentId"], targets["versionId"], targets["page"]) == ("doc-1", "ver-1", 1)
    assert targets["widthPt"] > targets["heightPt"] > 0 and targets["rotation"] == 0 and not targets["scan"]
    assert len(targets["vertices"]) % 2 == 0 and len(targets["segments"]) % 4 == 0
    assert all(0 <= value <= 1 for value in targets["vertices"] + targets["segments"])
    assert not targets["truncated"] and targets["totalSegments"] >= len(targets["segments"]) // 4
    assert [scale["state"] for scale in targets["scales"]] == ["estimated"]


async def test_the_page_is_read_once_and_a_new_calibration_shows_on_the_next_call(stored) -> None:
    await _targets()
    stored[0] = [CALIBRATION]

    targets = (await _targets())["targets"]

    assert _Store.reads == 1
    assert [scale["state"] for scale in targets["scales"]] == ["verified", "estimated"]
    assert targets["scales"][0]["region"] == pytest.approx([0.1, 0.1, 0.4, 0.4])


async def test_a_call_the_bff_stated_no_pdf_for_reads_nothing(stored) -> None:
    request = SnapTargetsRequest(file_name=FILE, collection=COLLECTION)

    assert await snap_targets.run_snap_targets(request) == {"refused": "not_enabled"}
    assert _Store.reads == 0


async def test_a_file_that_is_no_pdf_is_unavailable_with_its_sentence(stored) -> None:
    assert "is no PDF" in (await _targets("site.dxf"))["unavailable"]["reason"]


async def test_a_drawing_the_bff_names_by_id_is_read_by_that_id(stored) -> None:
    document_id = "bbbbbbbb-0000-4000-8000-00000000000b"
    request = SnapTargetsRequest(file_name=FILE, collection=COLLECTION, document_id=document_id)

    with turn_file_kinds.stating(frozenset({"pdf"})):
        await snap_targets.run_snap_targets(request)

    assert snap_targets.asked_of_the_bff[-1]["documentId"] == document_id  # type: ignore[attr-defined]
