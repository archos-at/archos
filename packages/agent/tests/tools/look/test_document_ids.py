from __future__ import annotations

from typing import Any

import knowledge_layer.view_image as view
import pytest
from agent_testing import look
from agent_testing.look import _pdf

from agent.common import bff_http
from agent.common.stored_file import AmbiguousDocumentName
from agent.knowledge import AvailableDocument
from agent.knowledge.inventory import set_turn_documents
from agent.tools.look import resolve
from agent.tools.look.register import run_look

room = look.room

BESTAND = "aaaaaaaa-0000-4000-8000-00000000000a"
ENTWURF = "bbbbbbbb-0000-4000-8000-00000000000b"

TWO_PLANS = [
    AvailableDocument(
        file_name="Plan.pdf", shelf="project", collection="proj_1", folder_path="Bestand", document_id=BESTAND
    ),
    AvailableDocument(
        file_name="Plan.pdf", shelf="project", collection="proj_1", folder_path="Entwurf", document_id=ENTWURF
    ),
]


@pytest.fixture
def two_plans():
    set_turn_documents(TWO_PLANS)
    yield
    set_turn_documents(None)


@pytest.fixture
def located(monkeypatch) -> list[dict[str, Any]]:
    asked: list[dict[str, Any]] = []

    async def locate(collection, file_name, organization_id=None, image_index=None, document_id=None):
        asked.append({"collection": collection, "file_name": file_name, "document_id": document_id})
        return view.StorageLocation("key", None, document_id=document_id)

    monkeypatch.setenv("VIEW_IMAGES_ENABLED", "true")
    monkeypatch.setenv("VLM_API_KEY", "sk-test")
    monkeypatch.setattr(view, "_find_pdf", lambda _name: None)
    monkeypatch.setattr(view, "_resolve_storage_location", locate)
    monkeypatch.setattr(view, "_fetch_seaweed_bytes", lambda *_: _pdf())
    monkeypatch.setattr(view, "turn_sees", _sees)
    return asked


async def _sees() -> bool:
    return True


def _refused_as_ambiguous(*_: Any, **__: Any) -> Any:
    raise bff_http.BffRefusedError(
        "refused", status=409, body={"code": "CONFLICT", "details": {"reason": "ambiguous_name"}}
    )


class TestTwoDocumentsShareAName:
    async def test_the_name_alone_is_a_question_naming_each_folder_and_id(self, two_plans, lookups) -> None:
        answer = await resolve.resolve_document("Plan.pdf")

        assert isinstance(answer, str) and answer.startswith("Ambiguous:")
        assert "„Bestand“" in answer and "„Entwurf“" in answer
        assert BESTAND in answer and ENTWURF in answer
        assert lookups == []

    async def test_a_bare_name_is_a_question_even_when_one_of_them_lies_at_the_top_level(self, lookups) -> None:
        top = AvailableDocument(file_name="Plan.pdf", shelf="project", collection="proj_1", document_id=BESTAND)
        set_turn_documents([top, TWO_PLANS[1]])
        try:
            answer = await resolve.resolve_document("Plan.pdf")
        finally:
            set_turn_documents(None)

        assert isinstance(answer, str) and answer.startswith("Ambiguous:") and "at the top level" in answer

    @pytest.mark.parametrize(
        ("named", "expected"),
        [("Entwurf/Plan.pdf", ENTWURF), ("/project/Bestand/Plan.pdf.md", BESTAND), (ENTWURF, ENTWURF)],
    )
    async def test_a_folder_path_or_the_id_resolves_one_without_asking_the_bff(
        self, two_plans, lookups, named, expected, calls
    ) -> None:
        resolved = await resolve.resolve_document(named)

        assert isinstance(resolved, resolve.Resolved)
        assert (resolved.document_id, resolved.collection, resolved.file_name) == (expected, "proj_1", "Plan.pdf")
        assert lookups == []

    async def test_a_look_renders_the_pixels_of_that_document_and_cites_it_by_id(
        self, two_plans, located, lookups
    ) -> None:
        result = await run_look("Entwurf/Plan.pdf", page=1)

        assert isinstance(result, list)
        assert located == [{"collection": "proj_1", "file_name": "Plan.pdf", "document_id": ENTWURF}]


class TestTheStoredFileIsAskedForById:
    async def test_the_bff_is_asked_for_the_id_and_the_name_together(self, monkeypatch) -> None:
        asked: list[dict[str, str]] = []

        def get_json(path: str, **kwargs: Any) -> dict[str, Any]:
            asked.append(kwargs["query"])
            return {"storageKey": "k", "documentId": ENTWURF}

        monkeypatch.setenv("INTERNAL_API_TOKEN", "token")
        monkeypatch.setattr(view.bff_http, "get_json", get_json)

        location = await view._resolve_storage_location("proj_1", "Plan.pdf", document_id=ENTWURF)

        assert location is not None and location.document_id == ENTWURF
        assert asked == [{"collection": "proj_1", "filename": "Plan.pdf", "documentId": ENTWURF}]

    async def test_a_name_the_bff_finds_twice_is_raised_never_answered_with_the_newest(self, monkeypatch) -> None:
        monkeypatch.setenv("INTERNAL_API_TOKEN", "token")
        monkeypatch.setattr(view.bff_http, "get_json", _refused_as_ambiguous)

        with pytest.raises(AmbiguousDocumentName):
            await view._resolve_storage_location("proj_1", "Plan.pdf")

    async def test_the_look_asks_the_person_which_one_is_meant(self, monkeypatch) -> None:
        monkeypatch.setenv("INTERNAL_API_TOKEN", "token")
        monkeypatch.setenv("VIEW_IMAGES_ENABLED", "true")
        monkeypatch.setenv("VLM_API_KEY", "sk-test")
        monkeypatch.setattr(view, "_find_pdf", lambda _name: None)
        monkeypatch.setattr(view, "_may_read", lambda _collection: True)
        monkeypatch.setattr(view.bff_http, "get_json", _refused_as_ambiguous)

        result = await view.render_view("Plan.pdf", 1, "proj_1")

        assert isinstance(result, str) and "Ambiguous" in result and "Ask the person which one" in result

    async def test_a_stored_document_never_renders_the_base_corpus_file_of_its_name(self, monkeypatch) -> None:
        asked: list[str | None] = []

        async def locate(collection, file_name, organization_id=None, image_index=None, document_id=None):
            asked.append(document_id)
            return view.StorageLocation("key", None)

        monkeypatch.setenv("VIEW_IMAGES_ENABLED", "true")
        monkeypatch.setenv("VLM_API_KEY", "sk-test")
        monkeypatch.setattr(view, "_may_read", lambda _collection: True)
        monkeypatch.setattr(view, "_find_pdf", lambda _name: "/corpus/OIB-RL2.pdf")
        monkeypatch.setattr(view, "_resolve_storage_location", locate)
        monkeypatch.setattr(view, "_fetch_seaweed_bytes", lambda *_: _pdf())

        result = await view.render_view("OIB-RL2.pdf", 1, "proj_1", document_id=ENTWURF)

        assert isinstance(result, view.View) and "from collection 'proj_1'" in result.text
        assert asked == [ENTWURF]


class TestALegacyRowWithoutAnId:
    async def test_the_bff_finding_the_name_twice_asks_which_one(self, monkeypatch) -> None:
        from agent.tools.canvas import client

        set_turn_documents([AvailableDocument(file_name="Plan.pdf", shelf="project", collection="proj_1")])
        monkeypatch.setenv("INTERNAL_API_TOKEN", "token")
        monkeypatch.setattr(client.bff_http, "get_json", _refused_as_ambiguous)
        try:
            answer = await resolve.resolve_document("Plan.pdf")
        finally:
            set_turn_documents(None)

        assert isinstance(answer, str) and answer.startswith("Ambiguous: more than one document")
