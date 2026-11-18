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
SOURCE = {"document_id": "doc-raumbuch", "name": "Raumbuch.xlsx"}


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
    async def test_it_is_made_only_when_asked_with_its_change_note(self, _one_store, monkeypatch, calls) -> None:
        await _run_file(_one_store, derived_from=SOURCE)
        _answer(monkeypatch, calls, {"documentId": "doc-raumbuch", "version": _version("ver-4", "draft", "h4")})

        message = await filing_tools.run_file_draft(
            XLSX, file_as="new_revision", change_note="Fläche Raum 2.04 korrigiert"
        )

        payload = calls[0][0]
        assert payload["op"] == "revise_file"
        assert payload["documentId"] == "doc-raumbuch"
        assert payload["changeNote"] == "Fläche Raum 2.04 korrigiert"
        assert "new version of „Raumbuch.xlsx“" in message

    async def test_a_file_from_no_document_is_refused_as_a_new_version(self, _one_store, monkeypatch, calls) -> None:
        await _run_file(_one_store)
        _answer(monkeypatch, calls)

        message = await filing_tools.run_file_draft(XLSX, file_as="new_revision")

        assert calls == []
        assert message.startswith("Error:")


class TestAfterAPersonChangedIt:
    async def test_the_refusal_asks_the_user_and_names_both_ways(self, _one_store, monkeypatch, calls) -> None:
        await _run_file(_one_store)
        _answer(monkeypatch, calls, _created())
        await filing_tools.run_file_draft(XLSX)
        await _run_file(_one_store, data=BYTES + b"v2")
        calls.clear()
        _answer(monkeypatch, calls, _refused("changed-in-project", versionNumber=2))

        message = await filing_tools.run_file_draft(XLSX)

        assert "Fassung 2" in message
        assert "over_changes=true" in message
        assert 'file_as="separate_file"' in message

    async def test_over_changes_and_separate_file_carry_out_the_users_choice(
        self, _one_store, monkeypatch, calls
    ) -> None:
        await _run_file(_one_store)
        _answer(monkeypatch, calls, _created())
        await filing_tools.run_file_draft(XLSX)
        await _run_file(_one_store, data=BYTES + b"v2")
        calls.clear()
        _answer(monkeypatch, calls, _created("ver-2", "draft", "h2"), _created("ver-9", "draft", "h9"))

        await filing_tools.run_file_draft(XLSX, over_changes=True)
        await _run_file(_one_store, data=BYTES + b"v3")
        await filing_tools.run_file_draft(XLSX, file_as="separate_file")

        assert calls[0][0]["op"] == "update_file"
        assert calls[0][0]["overChanges"] is True
        assert calls[1][0]["op"] == "create_file"
        assert calls[1][0]["ref"] != filing_tools.filing_reference(CONVERSATION, XLSX)


class TestTheCardAndSubmitFollowTheCurrentVersion:
    async def test_a_draft_changed_after_filing_carries_the_version_it_was_filed_at(
        self, _one_store, monkeypatch, calls, registry
    ) -> None:
        await _run_file(_one_store)
        _answer(monkeypatch, calls, _created())
        await filing_tools.run_file_draft(XLSX)

        await _run_file(_one_store, data=BYTES + b"v2")

        card = _draft_cards(registry)[-1]
        assert (card["version"], card["filed_draft_version"]) == (2, 1)

    async def test_an_approved_filing_gets_the_next_version_and_submit_goes_to_it(
        self, _one_store, monkeypatch, calls
    ) -> None:
        await _run_file(_one_store)
        monkeypatch.setattr(filing_tools, "post_document_version", _responder([_created()], calls))
        await filing_tools.run_file_draft(XLSX)
        await _run_file(_one_store, data=BYTES + b"v2")
        calls.clear()
        _answer(
            monkeypatch,
            calls,
            {"documentId": "doc-1", "version": _version("ver-2", "draft", "h2")},
            {"documentId": "doc-1", "version": _version("ver-2", "in_review", "h2")},
        )

        message = await filing_tools.run_file_draft(XLSX, submit=True)

        assert [payload["op"] for payload, _ in calls] == ["update_file", "submit"]
        assert calls[1][0]["versionId"] == "ver-2"
        assert "submitted for approval" in message
        stored = _one_store.get(draft_namespace(CONVERSATION), XLSX).value
        assert stored[FILED_VERSION_KEY] == "ver-2"
