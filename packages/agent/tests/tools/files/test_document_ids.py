import uuid
from unittest.mock import MagicMock

import pytest

import agent.project_context as pc
from agent.cards.registry import CardRegistry
from agent.cards.registry import reset_card_registry
from agent.cards.registry import set_card_registry
from agent.knowledge.inventory import set_turn_documents
from agent.knowledge.schema import AvailableDocument
from agent.tools import proposals_client
from agent.tools.files import resolve
from agent.tools.files.register import ProposeFileChangeConfig
from agent.tools.files.register import propose_file_change

BESTAND = "aaaaaaaa-0000-4000-8000-00000000000a"
ENTWURF = "bbbbbbbb-0000-4000-8000-00000000000b"
SCHNITT = "cccccccc-0000-4000-8000-00000000000c"


def _row(file_name: str, folder: str | None, document_id: str, **fields) -> AvailableDocument:
    return AvailableDocument(
        file_name=file_name,
        shelf="project",
        collection="proj_1",
        folder_path=folder,
        document_id=document_id,
        **fields,
    )


INVENTORY = [
    _row("Plan.pdf", "Bestand", BESTAND),
    _row("Plan.pdf", "Entwurf", ENTWURF),
    _row("Schnitt.pdf", "Einreichung", SCHNITT, display_title="Schnitt A-A"),
]


@pytest.fixture
def registry():
    registry = CardRegistry()
    token = set_card_registry(registry)
    yield registry
    reset_card_registry(token)


@pytest.fixture(autouse=True)
def turn(monkeypatch):
    stored: list[dict] = []

    async def store(kind, payload, *, card_index=None):
        stored.append(payload)
        return str(uuid.uuid4())

    monkeypatch.setattr(pc, "get_project_id_from_context", lambda: "p1")
    monkeypatch.setattr(proposals_client, "create_proposal", store)
    set_turn_documents(INVENTORY)
    yield stored
    set_turn_documents(None)


async def _propose(operation: str, **params) -> str:
    async with propose_file_change(ProposeFileChangeConfig(), MagicMock()) as info:
        return await info.single_fn(info.input_schema(operation=operation, **params))


class TestTwoDocumentsShareAName:
    def test_the_name_alone_is_a_question_that_shows_each_folder_and_id(self):
        refused = resolve.resolve_document("Plan.pdf")

        assert isinstance(refused, resolve.Refusal) and refused.message.startswith("Ambiguous:")
        assert "„Bestand“" in refused.message and "„Entwurf“" in refused.message
        assert BESTAND in refused.message and ENTWURF in refused.message

    def test_a_bare_name_is_a_question_even_when_one_of_them_lies_at_the_top_level(self):
        set_turn_documents([*INVENTORY, _row("Plan.pdf", None, str(uuid.uuid4()))])

        assert isinstance(resolve.resolve_document("Plan.pdf"), resolve.Refusal)

    @pytest.mark.parametrize(("named", "expected"), [("Entwurf/Plan.pdf", ENTWURF), (BESTAND, BESTAND)])
    def test_the_folder_path_or_the_id_names_one(self, named, expected):
        hit = resolve.resolve_document(named)

        assert isinstance(hit, resolve.ResolvedDocument) and hit.document_id == expected

    async def test_the_proposal_carries_the_document_it_acts_on(self, registry, turn):
        answer = await _propose("move", document="Entwurf/Plan.pdf", target_folder="Einreichung")

        assert answer.startswith("Proposed:")
        (payload,) = turn
        assert payload["operations"][0]["document_id"] == ENTWURF
        assert registry.snapshot()[0]["operations"][0]["document_id"] == ENTWURF


class TestAFolderHoldsANameOnce:
    async def test_a_move_onto_a_name_the_folder_holds_is_a_conflict_and_no_proposal(self, registry, turn):
        answer = await _propose("move", document="Entwurf/Plan.pdf", target_folder="Bestand")

        assert answer.startswith("Conflict:") and BESTAND in answer
        assert "replace" in answer and "keep both" in answer
        assert turn == [] and registry.snapshot() == []

    async def test_the_clash_ignores_case_like_the_finder(self, registry, turn, monkeypatch):
        set_turn_documents([*INVENTORY, _row("plan.PDF", "Archiv", str(uuid.uuid4()))])

        answer = await _propose("move", document="Entwurf/Plan.pdf", target_folder="Archiv")

        assert answer.startswith("Conflict:") and turn == []

    async def test_a_rename_onto_a_display_name_another_document_holds_is_refused(self, registry, turn):
        set_turn_documents([*INVENTORY, _row("Ansicht.pdf", "Einreichung", str(uuid.uuid4()))])

        answer = await _propose("rename", document="Ansicht.pdf", new_name="schnitt a-a")

        assert answer.startswith("Conflict:") and SCHNITT in answer and turn == []

    async def test_a_name_held_in_another_folder_is_no_conflict(self, registry, turn):
        answer = await _propose("move", document="Schnitt.pdf", target_folder="Bestand")

        assert answer.startswith("Proposed:") and turn[0]["operations"][0]["document_id"] == SCHNITT
