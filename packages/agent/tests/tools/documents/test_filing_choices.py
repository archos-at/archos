from __future__ import annotations

from typing import Any

from agent.tools.documents import filing
from agent.tools.documents import register as filing_tools
from agent.tools.documents.draft_store import DRAFT_ROOT
from agent.tools.documents.draft_store import FILED_VERSION_KEY
from agent.tools.documents.draft_store import DraftBackend
from agent.tools.documents.draft_store import draft_namespace

from .conftest import CONVERSATION
from .conftest import _draft_cards
from .conftest import _responder
from .conftest import _version

XLSX = f"{DRAFT_ROOT}Raumbuch.xlsx"
BYTES = b"PK\x03\x04 a workbook"
SOURCE = {"document_id": "doc-raumbuch", "name": "Raumbuch.xlsx", "content_hash": "sha256:source"}


async def _run_file(store: Any, data: bytes = BYTES, derived_from: dict[str, str] | None = None) -> None:
    backend = DraftBackend(store=store, conversation_id=CONVERSATION)
    assert await backend.awrite_run_file(XLSX, data, derived_from=derived_from) is None


def _answer(monkeypatch: Any, calls: list, *responses: dict | filing.FilingError) -> None:
    def _post(payload: dict[str, Any], signed: filing.SignedEnvelope) -> dict[str, Any]:
        calls.append((payload, signed))
        response = responses[len(calls) - 1]
        if isinstance(response, filing.FilingError):
            raise response
        return response

    monkeypatch.setattr(filing_tools, "post_document_version", _post)


def _created(version_id: str = "ver-1", state: str = "draft", content_hash: str = "h1") -> dict:
    return {"documentId": "doc-1", "version": _version(version_id, state, content_hash)}


def _refused(reason: str, **details: Any) -> filing.FilingError:
    return filing.FilingError("refused", status=409, code="CONFLICT", details={"reason": reason, **details})


class TestTheFolder:
    async def test_a_named_folder_travels_with_the_filing(self, _one_store, monkeypatch, calls) -> None:
        await _run_file(_one_store)
        _answer(monkeypatch, calls, _created())

        await filing_tools.run_file_draft(XLSX, folder=" Einreichung ")

        assert calls[0][0]["folder"] == "Einreichung"

    async def test_an_unknown_folder_is_refused_naming_the_folders_that_exist(
        self, _one_store, monkeypatch, calls
    ) -> None:
        await _run_file(_one_store)
        unknown = filing.FilingError(
            "refused",
            status=422,
            details={"reason": "folder-unknown", "folder": "Einreichung", "folders": ["02 Einreichung", "Berichte"]},
        )
        _answer(monkeypatch, calls, unknown)

        message = await filing_tools.run_file_draft(XLSX, folder="Einreichung")

        assert message.startswith("Error:")
        assert "„02 Einreichung“, „Berichte“" in message

    async def test_a_file_made_from_a_document_goes_where_that_document_lies(
        self, _one_store, monkeypatch, calls
    ) -> None:
        await _run_file(_one_store, derived_from=SOURCE)
        _answer(monkeypatch, calls, _created())

        await filing_tools.run_file_draft(XLSX)

        assert calls[0][0]["op"] == "create_file"
        assert calls[0][0]["sourceDocumentId"] == "doc-raumbuch"


class TestANewVersionOfTheSource:
    async def test_it_is_made_only_when_asked_with_its_change_note_and_the_hash_the_run_read(
        self, _one_store, monkeypatch, calls
    ) -> None:
        await _run_file(_one_store, derived_from=SOURCE)
        _answer(monkeypatch, calls, {"documentId": "doc-raumbuch", "version": _version("ver-4", "draft", "h4")})

        message = await filing_tools.run_file_draft(
            XLSX, file_as="new_revision", change_note="Fläche Raum 2.04 korrigiert"
        )

        payload = calls[0][0]
        assert payload["op"] == "revise_file"
        assert payload["documentId"] == "doc-raumbuch"
        assert payload["ifMatch"] == "sha256:source"
        assert "versionId" not in payload
        assert payload["changeNote"] == "Fläche Raum 2.04 korrigiert"
        assert "new version of „Raumbuch.xlsx“" in message

    async def test_filing_again_after_a_new_version_stays_on_the_revision_path(
        self, _one_store, monkeypatch, calls
    ) -> None:
        await _run_file(_one_store, derived_from=SOURCE)
        _answer(monkeypatch, calls, {"documentId": "doc-raumbuch", "version": _version("ver-4", "draft", "h4")})
        await filing_tools.run_file_draft(XLSX, file_as="new_revision")
        await _run_file(_one_store, data=BYTES + b"v2", derived_from=SOURCE)
        calls.clear()
        _answer(monkeypatch, calls, {"documentId": "doc-raumbuch", "version": _version("ver-4", "draft", "h5")})

        message = await filing_tools.run_file_draft(XLSX)

        payload = calls[0][0]
        assert payload["op"] == "revise_file"
        assert (payload["documentId"], payload["versionId"], payload["ifMatch"]) == ("doc-raumbuch", "ver-4", "h4")
        assert not message.startswith("Error:")

    async def test_a_file_from_no_document_is_refused_as_a_new_version(self, _one_store, monkeypatch, calls) -> None:
        await _run_file(_one_store)
        _answer(monkeypatch, calls)

        message = await filing_tools.run_file_draft(XLSX, file_as="new_revision")

        assert calls == []
        assert message.startswith("Error:")


class TestAfterAPersonChangedIt:
    async def test_the_refusal_leaves_the_decision_to_the_person(self, _one_store, monkeypatch, calls) -> None:
        await _run_file(_one_store)
        _answer(monkeypatch, calls, _created())
        await filing_tools.run_file_draft(XLSX)
        await _run_file(_one_store, data=BYTES + b"v2")
        calls.clear()
        _answer(monkeypatch, calls, _refused("changed-in-project", versionNumber=2))

        message = await filing_tools.run_file_draft(XLSX)

        assert "Fassung 2" in message
        assert "card" in message
        assert "over_changes" not in message
        assert "overChanges" not in calls[0][0]

    async def test_the_agent_cannot_choose_to_write_over_a_persons_change(self) -> None:
        import inspect

        file_as = inspect.signature(filing_tools.run_file_draft).parameters["file_as"].annotation
        assert "over_changes" not in str(file_as)

    async def test_a_separate_file_has_one_reference_however_often_it_is_retried(
        self, _one_store, monkeypatch, calls
    ) -> None:
        await _run_file(_one_store)
        _answer(monkeypatch, calls, _created())
        await filing_tools.run_file_draft(XLSX)
        await _run_file(_one_store, data=BYTES + b"v2")
        calls.clear()
        refused = filing.FilingError("refused", status=502)
        _answer(monkeypatch, calls, refused, _created("ver-9", "draft", "h9"))

        await filing_tools.run_file_draft(XLSX, file_as="separate_file")
        await filing_tools.run_file_draft(XLSX, file_as="separate_file")

        assert calls[0][0]["ref"] == calls[1][0]["ref"]
        assert calls[0][0]["ref"] != filing_tools.filing_reference(CONVERSATION, XLSX)


class TestAFiledDocumentThatIsGone:
    async def test_filing_again_files_afresh_when_a_person_deleted_the_document(
        self, _one_store, monkeypatch, calls
    ) -> None:
        await _run_file(_one_store)
        _answer(monkeypatch, calls, _created())
        await filing_tools.run_file_draft(XLSX)
        await _run_file(_one_store, data=BYTES + b"v2")
        calls.clear()
        _answer(monkeypatch, calls, filing.FilingError("gone", status=404), _created("ver-7", "draft", "h7"))

        message = await filing_tools.run_file_draft(XLSX)

        assert [payload["op"] for payload, _ in calls] == ["update_file", "create_file"]
        assert message.startswith("Filed in the project:")

    async def test_a_folder_named_for_a_filed_draft_is_said_to_be_left_alone(
        self, _one_store, monkeypatch, calls
    ) -> None:
        await _run_file(_one_store)
        _answer(monkeypatch, calls, _created())
        await filing_tools.run_file_draft(XLSX)
        await _run_file(_one_store, data=BYTES + b"v2")
        calls.clear()
        _answer(monkeypatch, calls, _created("ver-2", "draft", "h2"))

        message = await filing_tools.run_file_draft(XLSX, folder="Einreichung")

        assert "folder" not in calls[0][0]
        assert "„Einreichung“ was not applied" in message


class TestTheCardFollowsTheCurrentVersion:
    async def test_a_draft_changed_after_filing_carries_the_version_it_was_filed_at(
        self, _one_store, monkeypatch, calls, registry
    ) -> None:
        await _run_file(_one_store)
        _answer(monkeypatch, calls, _created())
        await filing_tools.run_file_draft(XLSX)

        await _run_file(_one_store, data=BYTES + b"v2")

        card = _draft_cards(registry)[-1]
        assert (card["version"], card["filed_draft_version"]) == (2, 1)

    async def test_a_filing_filed_again_lands_as_the_next_published_version(
        self, _one_store, monkeypatch, calls
    ) -> None:
        await _run_file(_one_store)
        monkeypatch.setattr(filing_tools, "post_document_version", _responder([_created()], calls))
        await filing_tools.run_file_draft(XLSX)
        await _run_file(_one_store, data=BYTES + b"v2")
        calls.clear()
        _answer(monkeypatch, calls, {"documentId": "doc-1", "version": _version("ver-2", "published", "h2")})

        message = await filing_tools.run_file_draft(XLSX)

        assert [payload["op"] for payload, _ in calls] == ["update_file"]
        assert "approval" not in message.replace("waits for no approval", "")
        stored = _one_store.get(draft_namespace(CONVERSATION), XLSX).value
        assert stored[FILED_VERSION_KEY] == "ver-2"
