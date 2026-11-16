from __future__ import annotations

import logging
from typing import Any

import pytest
from langgraph.store.memory import InMemoryStore

from agent.cards.registry import CardRegistry
from agent.cards.registry import reset_card_registry
from agent.cards.registry import set_card_registry
from agent.common.wire_v2 import StatusStep
from agent.knowledge.restricted_use import RestrictedUse
from agent.knowledge.restricted_use import bind_restricted_use
from agent.knowledge.restricted_use import reset_restricted_use
from agent.tools.documents import draft_store
from agent.tools.documents.draft_store import FILED_DOCUMENT_KEY
from agent.tools.documents.draft_store import FILED_HASH_KEY
from agent.tools.documents.draft_store import FILED_STATE_KEY
from agent.tools.documents.draft_store import FILED_VERSION_KEY
from agent.tools.documents.draft_store import DraftBackend
from agent.tools.documents.filing import FilingError
from agent.turn import subject_document
from agent.turn.payload import SubjectVersion
from agent.turn.response import answer_message_id

CONVERSATION = "conv-subject-1"
ORGANIZATION = "org_1"
ASKER = "user_asker"
TEXT = "# Befund\n\nAbschnitt 3: GK 4, weil das oberste Geschoß bei 11 m liegt.\n"

BODY: dict[str, Any] = {
    "documentId": "doc-9",
    "versionId": "ver-9",
    "versionNumber": 1,
    "state": "draft",
    "contentHash": "hash-9",
    "contentType": "text/markdown",
    "filename": "piloti/doc-9/befund.md",
    "displayName": "Befund Fluchtwege",
    "content": TEXT,
}

OPEN = SubjectVersion(document_id="doc-9", version_id="ver-9", state="draft")
PUBLISHED = SubjectVersion(document_id="doc-9", version_id="ver-9", state="published")


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> InMemoryStore:
    memory = InMemoryStore()

    async def _backend(conversation_id: str, dsn: str | None = None) -> DraftBackend:
        return DraftBackend(store=memory, conversation_id=conversation_id)

    monkeypatch.setattr(subject_document, "get_draft_backend", _backend)
    return memory


@pytest.fixture
def reads(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str, str, str | None, str | None]]:
    seen: list[tuple[str, str, str, str | None, str | None]] = []

    def _read(
        version_id: str,
        organization_id: str,
        conversation_id: str,
        user_id: str | None = None,
        answer_message_id: str | None = None,
    ) -> dict[str, Any]:
        seen.append((version_id, organization_id, conversation_id, user_id, answer_message_id))
        return dict(BODY)

    monkeypatch.setattr(subject_document, "get_document_version_content", _read)
    return seen


def _stored(store: InMemoryStore, path: str) -> dict | None:
    item = store.get(draft_store.draft_namespace(CONVERSATION), path)
    return item.value if item else None


async def _load(subject: SubjectVersion) -> StatusStep | None:
    return await subject_document.load_subject_document(
        subject, conversation_id=CONVERSATION, organization_id=ORGANIZATION, user_id=ASKER
    )


async def _loaded_path(subject: SubjectVersion) -> str:
    step = await _load(subject)
    assert step is not None and step.detail["loaded"] is True, step
    return str(step.detail["path"])


async def _miss(subject: SubjectVersion) -> str:
    step = await _load(subject)
    assert step is not None and step.detail["loaded"] is False, step
    return str(step.detail["reason"])


class TestAnUnpublishedSubject:
    async def test_the_text_lands_in_the_working_directory(self, store, reads) -> None:
        step = await _load(OPEN)

        assert step == StatusStep(
            id="status:documents:subject",
            slot="documents:subject",
            channel="technical",
            detail={
                "loaded": True,
                "document_id": "doc-9",
                "version_id": "ver-9",
                "state": "draft",
                "path": "/drafts/Befund Fluchtwege.md",
                "chars": len(TEXT),
            },
        )
        path = "/drafts/Befund Fluchtwege.md"
        assert reads == [("ver-9", ORGANIZATION, CONVERSATION, ASKER, answer_message_id(CONVERSATION, None))]
        assert _stored(store, path)["content"] == TEXT

    async def test_it_is_named_after_the_documents_LABEL_not_its_filename(self, store, reads) -> None:
        path = await _loaded_path(OPEN)
        assert path == f"{draft_store.DRAFT_ROOT}Befund Fluchtwege.md"
        assert "/" not in path[len(draft_store.DRAFT_ROOT) :]

    async def test_the_filing_record_names_the_document_and_the_version(self, store, reads) -> None:
        value = _stored(store, await _loaded_path(OPEN))
        assert value[FILED_DOCUMENT_KEY] == "doc-9"
        assert value[FILED_VERSION_KEY] == "ver-9"
        assert value[FILED_HASH_KEY] == "hash-9"
        assert value[FILED_STATE_KEY] == "draft"

    async def test_the_ceiling_still_applies_to_bytes_from_outside(self, store, monkeypatch) -> None:
        oversized = dict(BODY, content="x" * (draft_store.MAX_DRAFT_BYTES + 1))
        monkeypatch.setattr(subject_document, "get_document_version_content", lambda *_: oversized)

        assert await _miss(OPEN) == "not_stored"
        assert _stored(store, "/drafts/Befund Fluchtwege.md") is None


class TestASecondTurnOfTheSameConversation:
    async def test_it_leaves_the_models_edits_alone(self, store, reads) -> None:
        path = await _loaded_path(OPEN)
        backend = DraftBackend(store=store, conversation_id=CONVERSATION)
        edited = await backend.aedit(path, "GK 4", "GK 5")
        assert edited.error is None

        assert await _load(OPEN) is None
        assert "GK 5" in _stored(store, path)["content"]
        assert len(reads) == 2  # asked, and decided nothing had to be written

    async def test_a_reviewers_change_does_not_clobber_the_working_copy(self, store, monkeypatch) -> None:
        monkeypatch.setattr(subject_document, "get_document_version_content", lambda *_: dict(BODY))
        path = await _loaded_path(OPEN)

        moved = dict(BODY, contentHash="hash-10", content="# Befund\n\nAbschnitt 3: GK 5.\n")
        monkeypatch.setattr(subject_document, "get_document_version_content", lambda *_: moved)
        assert await _load(OPEN) is None
        assert "GK 4" in _stored(store, path)["content"]
        assert _stored(store, path)[FILED_HASH_KEY] == "hash-9"

    async def test_a_path_belonging_to_another_document_is_refused(self, store, reads, monkeypatch) -> None:
        await _load(OPEN)
        other = dict(BODY, documentId="doc-11", versionId="ver-11", contentHash="hash-11")
        monkeypatch.setattr(subject_document, "get_document_version_content", lambda *_: other)

        assert await _miss(SubjectVersion("doc-11", "ver-11", "draft")) == "not_stored"
        assert _stored(store, "/drafts/Befund Fluchtwege.md")[FILED_DOCUMENT_KEY] == "doc-9"

    async def test_it_announces_no_draft_card_for_a_document_nobody_wrote(self, store, reads) -> None:
        registry = CardRegistry()
        token = set_card_registry(registry)
        try:
            await _load(OPEN)
        finally:
            reset_card_registry(token)
        assert [card for card in registry.snapshot() if card["type"] == "document_draft"] == []


class TestAPublishedSubject:
    async def test_nothing_is_read_and_nothing_is_written(self, store, reads) -> None:
        assert await _load(PUBLISHED) is None
        assert reads == []
        assert _stored(store, "/drafts/Befund Fluchtwege.md") is None

    async def test_a_turn_with_no_subject_at_all_is_a_no_op(self, store, reads) -> None:
        assert await _load(SubjectVersion()) is None
        assert reads == []

    async def test_an_incomplete_subject_is_not_a_subject(self, store, reads) -> None:
        assert await _load(SubjectVersion(document_id="doc-9", state="draft")) is None
        assert reads == []


class TestWhenTheBytesDoNotArrive:
    async def test_a_refusal_is_logged_and_the_turn_continues(
        self, store, monkeypatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        def _refuse(
            version_id: str,
            organization_id: str,
            conversation_id: str,
            user_id: str | None = None,
            answer_message_id: str | None = None,
        ) -> dict[str, Any]:
            raise FilingError("the document API refused the read (403)", status=403)

        monkeypatch.setattr(subject_document, "get_document_version_content", _refuse)
        with caplog.at_level(logging.WARNING):
            assert await _miss(OPEN) == "refused"
        assert "ver-9" in caplog.text

    async def test_an_unreachable_bff_is_logged_and_the_turn_continues(
        self, store, monkeypatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        def _unreachable(
            version_id: str,
            organization_id: str,
            conversation_id: str,
            user_id: str | None = None,
            answer_message_id: str | None = None,
        ) -> dict[str, Any]:
            raise FilingError("the document API could not be reached")

        monkeypatch.setattr(subject_document, "get_document_version_content", _unreachable)
        with caplog.at_level(logging.WARNING):
            assert await _miss(OPEN) == "unreachable"

    async def test_empty_bytes_write_nothing(self, store, monkeypatch) -> None:
        monkeypatch.setattr(subject_document, "get_document_version_content", lambda *_: dict(BODY, content="   "))
        assert await _miss(OPEN) == "empty"
        assert _stored(store, "/drafts/Befund Fluchtwege.md") is None

    async def test_an_unexpected_failure_never_reaches_the_turn(self, store, monkeypatch) -> None:
        def _explode(
            version_id: str,
            organization_id: str,
            conversation_id: str,
            user_id: str | None = None,
            answer_message_id: str | None = None,
        ) -> dict[str, Any]:
            raise RuntimeError("boom")

        monkeypatch.setattr(subject_document, "get_document_version_content", _explode)
        assert await _load(OPEN) is None

    async def test_a_run_with_no_conversation_has_nowhere_to_put_a_file(self, store, reads) -> None:
        assert (
            await subject_document.load_subject_document(OPEN, conversation_id=None, organization_id=ORGANIZATION)
            is None
        )
        assert reads == []

    async def test_a_run_with_no_organization_does_not_read(self, store, reads) -> None:
        assert (
            await subject_document.load_subject_document(OPEN, conversation_id=CONVERSATION, organization_id=None)
            is None
        )
        assert reads == []


class TestTheReadIsScopedToTheConversation:
    async def test_the_conversation_and_the_asker_travel_with_the_read(self, store, reads) -> None:
        await _load(OPEN)

        assert reads == [("ver-9", ORGANIZATION, CONVERSATION, ASKER, answer_message_id(CONVERSATION, None))]

    async def test_a_subject_from_a_restricted_folder_confines_the_turn(self, store, monkeypatch) -> None:
        monkeypatch.setattr(
            subject_document, "get_document_version_content", lambda *_: dict(BODY, drewOnRestrictedFolder=True)
        )
        use = RestrictedUse(organization_id=ORGANIZATION, user_id=ASKER, conversation_id=CONVERSATION, project_id=None)
        token = bind_restricted_use(use)
        try:
            await _loaded_path(OPEN)
        finally:
            reset_restricted_use(token)
        assert use.confined is True

    async def test_an_open_subject_leaves_the_turn_as_it_was(self, store, reads) -> None:
        use = RestrictedUse(organization_id=ORGANIZATION, user_id=ASKER, conversation_id=CONVERSATION, project_id=None)
        token = bind_restricted_use(use)
        try:
            await _loaded_path(OPEN)
        finally:
            reset_restricted_use(token)
        assert use.confined is False

    async def test_a_version_that_is_not_the_subject_is_not_a_fault(
        self, store, monkeypatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        def _absent(
            version_id: str,
            organization_id: str,
            conversation_id: str,
            user_id: str | None = None,
            answer_message_id: str | None = None,
        ) -> dict[str, Any]:
            raise FilingError("the document API refused the read (404)", status=404)

        monkeypatch.setattr(subject_document, "get_document_version_content", _absent)
        with caplog.at_level(logging.INFO):
            assert await _miss(OPEN) == "absent"

        assert _stored(store, "/drafts/Befund Fluchtwege.md") is None
        absent = [record for record in caplog.records if "ver-9" in record.getMessage()]
        assert absent, "the miss is recorded"
        assert [record.levelno for record in absent] == [logging.INFO]


class TestTheNameItBuilds:
    @pytest.mark.parametrize(
        ("display_name", "expected"),
        [
            ("Befund", "/drafts/Befund.md"),
            ("piloti/doc-9/Befund", "/drafts/piloti-doc-9-Befund.md"),
            ("../../etc/passwd", "/drafts/-.-etc-passwd.md"),
            ("Befund.md", "/drafts/Befund.md"),
            ("  ", "/drafts/dokument.md"),
            ("", "/drafts/dokument.md"),
        ],
    )
    def test_it_is_always_one_file_in_the_one_directory(self, display_name: str, expected: str) -> None:
        assert subject_document.draft_path(display_name) == expected

    @pytest.mark.parametrize(
        "display_name",
        ["../../etc/passwd", "..", "a..b", "Plan ..  Stand", "/etc/../etc/passwd"],
    )
    def test_it_never_builds_a_path_the_working_directory_would_refuse(self, display_name: str) -> None:
        assert draft_store.path_refusal(subject_document.draft_path(display_name)) is None

    def test_a_very_long_name_still_fits(self) -> None:
        path = subject_document.draft_path("A" * 500)
        assert path.startswith(draft_store.DRAFT_ROOT)
        assert len(path) <= len(draft_store.DRAFT_ROOT) + subject_document.MAX_NAME_CHARS + len(".md")

    def test_the_name_is_NFC_normalised_like_everything_else_in_the_store(self) -> None:
        assert subject_document.draft_path("Gebäude") == subject_document.draft_path("Gebäude")
