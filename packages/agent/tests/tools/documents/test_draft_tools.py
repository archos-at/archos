from __future__ import annotations

import pytest
from langgraph.store.memory import InMemoryStore

from agent.cards.catalog import SYSTEM_CARD_TYPES
from agent.cards.registry import CardRegistry
from agent.cards.registry import reset_card_registry
from agent.cards.registry import set_card_registry
from agent.tools.documents import tools as draft_tools_module
from agent.tools.documents.cards import draft_title
from agent.tools.documents.cards import emit_draft_card
from agent.tools.documents.draft_store import DRAFT_ROOT
from agent.tools.documents.draft_store import DraftBackend
from agent.tools.documents.tools import _PERMISSIONS
from agent.tools.documents.tools import DRAFT_TOOL_NAMES
from agent.tools.documents.tools import draft_tools
from agent.tools.documents.tools import draft_tools_for_turn

DRAFT = f"{DRAFT_ROOT}aktenvermerk.md"


@pytest.fixture
def backend() -> DraftBackend:
    return DraftBackend(store=InMemoryStore(), conversation_id="conv-1")


@pytest.fixture
def cards():
    registry = CardRegistry()
    token = set_card_registry(registry)
    try:
        yield registry
    finally:
        reset_card_registry(token)


class TestWhichToolsAreBound:
    def test_exactly_the_four_verbs(self, backend: DraftBackend) -> None:
        assert [tool.name for tool in draft_tools(backend)] == list(DRAFT_TOOL_NAMES)

    def test_nothing_that_searches_executes_or_deletes_is_bound(self, backend: DraftBackend) -> None:
        names = {tool.name for tool in draft_tools(backend)}
        assert not names & {"glob", "grep", "execute", "delete"}


class TestTheDescriptions:
    def test_they_replace_the_stock_text(self, backend: DraftBackend) -> None:
        for tool in draft_tools(backend):
            assert any(word in tool.description for word in ("draft", "drafts", "working directory"))
            assert "the filesystem" not in tool.description

    def test_the_unenforced_read_before_edit_claim_is_gone(self, backend: DraftBackend) -> None:
        for tool in draft_tools(backend):
            assert "You must read the file" not in tool.description

    def test_edit_says_where_to_anchor_and_what_not_to_copy(self, backend: DraftBackend) -> None:
        edit = next(tool for tool in draft_tools(backend) if tool.name == "edit_file")
        assert "heading" in edit.description
        assert "paragraph" in edit.description
        assert "`@@ … @@` header" in edit.description

    def test_read_warns_that_the_header_is_not_in_the_file(self, backend: DraftBackend) -> None:
        read = next(tool for tool in draft_tools(backend) if tool.name == "read_file")
        assert "@@ lines" in read.description
        assert "line number" not in read.description

    def test_write_names_the_document_kinds_and_the_root(self, backend: DraftBackend) -> None:
        write = next(tool for tool in draft_tools(backend) if tool.name == "write_file")
        assert DRAFT_ROOT in write.description
        assert "Aktenvermerk" in write.description


class TestTheRootPermissions:
    def test_the_root_lists_with_or_without_slash(self) -> None:
        from deepagents.middleware.filesystem import _check_fs_permission

        assert _check_fs_permission(_PERMISSIONS, "read", DRAFT_ROOT) == "allow"
        assert _check_fs_permission(_PERMISSIONS, "read", DRAFT_ROOT.rstrip("/")) == "allow"

    def test_a_draft_under_the_root_reads_and_writes(self) -> None:
        from deepagents.middleware.filesystem import _check_fs_permission

        assert _check_fs_permission(_PERMISSIONS, "read", DRAFT) == "allow"
        assert _check_fs_permission(_PERMISSIONS, "write", DRAFT) == "allow"

    def test_outside_the_root_is_still_denied(self) -> None:
        from deepagents.middleware.filesystem import _check_fs_permission

        assert _check_fs_permission(_PERMISSIONS, "read", "/etc/passwd") == "deny"
        assert _check_fs_permission(_PERMISSIONS, "write", "/etc/passwd") == "deny"

    def test_traversal_never_reaches_the_gate(self) -> None:
        from deepagents.backends.utils import validate_path

        with pytest.raises(ValueError):
            validate_path(f"{DRAFT_ROOT}../secrets.md")


class TestEveryVerbRunsOnTheAsyncPath:
    @pytest.mark.asyncio
    async def test_read_file_returns_the_draft(self, backend: DraftBackend, cards: CardRegistry) -> None:
        from types import SimpleNamespace

        await backend.awrite(DRAFT, "# Vermerk\n\n## 3. Fluchtweg\nLang.\n")
        read = next(tool for tool in draft_tools(backend) if tool.name == "read_file")

        message = await read.coroutine(DRAFT, SimpleNamespace(tool_call_id="call-1"), offset=0, limit=100)

        assert message.status != "error", message.content
        assert "## 3. Fluchtweg" in message.content

    def test_no_protocol_method_is_narrowed(self) -> None:
        import inspect

        from deepagents.backends.protocol import BackendProtocol

        for name, member in vars(DraftBackend).items():
            stock = getattr(BackendProtocol, name, None)
            if name.startswith("_") or not callable(member) or stock is None:
                continue
            ours = set(inspect.signature(member).parameters)
            assert set(inspect.signature(stock).parameters) <= ours, f"DraftBackend.{name} narrows the protocol"


class TestTheTurnFactory:
    @pytest.mark.asyncio
    async def test_no_conversation_id_means_no_tools(self, monkeypatch) -> None:
        monkeypatch.setattr(draft_tools_module, "get_conversation_id_from_context", lambda: None)
        assert await draft_tools_for_turn() == []

    @pytest.mark.asyncio
    async def test_a_conversation_id_gets_its_own_directory(self, monkeypatch, backend: DraftBackend) -> None:
        seen: dict[str, str] = {}

        async def _backend(conversation_id: str):
            seen["conversation_id"] = conversation_id
            return backend

        monkeypatch.setattr(draft_tools_module, "get_conversation_id_from_context", lambda: "conv-7")
        monkeypatch.setattr(draft_tools_module, "get_draft_backend", _backend)

        assert [tool.name for tool in await draft_tools_for_turn()] == list(DRAFT_TOOL_NAMES)
        assert seen == {"conversation_id": "conv-7"}

    @pytest.mark.asyncio
    async def test_an_unreachable_store_costs_the_drafting_not_the_turn(self, monkeypatch, caplog) -> None:
        async def _boom(_conversation_id: str):
            raise RuntimeError("no database here")

        monkeypatch.setattr(draft_tools_module, "get_conversation_id_from_context", lambda: "conv-7")
        monkeypatch.setattr(draft_tools_module, "get_draft_backend", _boom)

        with caplog.at_level("WARNING"):
            assert await draft_tools_for_turn() == []
        assert "Working directory unavailable" in caplog.text


class TestTheSkillsRideTheSameReadFile:
    @pytest.fixture
    def skills(self):
        from agent.skills.models import Skill
        from agent.skills.runtime import SkillRuntime

        return SkillRuntime.office((Skill(name="building-class", description="Die GK.", body="# GK\n\nZuerst."),))

    async def _read(self, tools, path: str):
        from types import SimpleNamespace

        read = next(tool for tool in tools if tool.name == "read_file")
        return await read.coroutine(path, SimpleNamespace(tool_call_id="call-1"), offset=0, limit=1000)

    async def test_a_skill_reads_beside_the_drafts_and_activates(self, backend: DraftBackend, skills) -> None:
        tools = draft_tools(backend, skills=skills.backend)
        assert [tool.name for tool in tools] == list(DRAFT_TOOL_NAMES)
        message = await self._read(tools, "/skills/office/building-class/SKILL.md")
        assert message.status != "error", message.content
        assert "Zuerst." in message.content
        assert skills.activated == ("building-class",)
        assert "/skills/" in next(t for t in tools if t.name == "read_file").description

    async def test_drafts_still_read_through_the_composite(self, backend: DraftBackend, skills) -> None:
        await backend.awrite(DRAFT, "# Vermerk\n\nText.\n")
        message = await self._read(draft_tools(backend, skills=skills.backend), DRAFT)
        assert "Text." in message.content
        assert skills.activated == ()

    async def test_without_a_conversation_the_skills_get_read_file_alone(self, monkeypatch, skills) -> None:
        monkeypatch.setattr(draft_tools_module, "get_conversation_id_from_context", lambda: None)
        tools = await draft_tools_for_turn(skills=skills.backend)
        assert [tool.name for tool in tools] == ["read_file"]
        message = await self._read(tools, "/skills/office/building-class/SKILL.md")
        assert "Zuerst." in message.content

    async def test_a_skill_cannot_be_written(self, backend: DraftBackend, skills) -> None:
        from types import SimpleNamespace

        write = next(tool for tool in draft_tools(backend, skills=skills.backend) if tool.name == "write_file")
        message = await write.coroutine(
            "/skills/office/evil/SKILL.md", "x", SimpleNamespace(tool_call_id="call-2", state={})
        )
        text = message if isinstance(message, str) else getattr(message, "content", str(message))
        assert "denied" in str(text).lower() or "read-only" in str(text).lower()
        assert skills.backend.read("/office/evil/SKILL.md").error

    def test_the_skill_gate_allows_read_and_denies_write(self) -> None:
        from deepagents.middleware.filesystem import _check_fs_permission

        from agent.tools.documents.tools import _SKILL_PERMISSION

        rules = [_SKILL_PERMISSION, *_PERMISSIONS]
        assert _check_fs_permission(rules, "read", "/skills/office/x/SKILL.md") == "allow"
        assert _check_fs_permission(rules, "write", "/skills/office/x/SKILL.md") == "deny"


class TestTheDraftCard:
    def test_it_is_a_system_card(self) -> None:
        assert "document_draft" in SYSTEM_CARD_TYPES

    def test_the_title_is_the_documents_own_first_heading(self) -> None:
        assert draft_title(DRAFT, "# Aktenvermerk Brandschutz\n\nText\n") == "Aktenvermerk Brandschutz"

    def test_a_document_without_a_heading_is_named_by_its_file(self) -> None:
        assert draft_title(DRAFT, "Nur Text\n") == "aktenvermerk.md"

    def test_a_writing_verb_puts_a_card_up(self, backend: DraftBackend, cards: CardRegistry) -> None:
        backend.write(DRAFT, "# Aktenvermerk\n\nGebäudeklasse 4\n")
        assert cards.snapshot() == [
            {
                "type": "document_draft",
                "title": "Aktenvermerk",
                "path": DRAFT,
                "bytes": len("# Aktenvermerk\n\nGebäudeklasse 4\n".encode()),
                "version": 1,
            }
        ]

    def test_an_edit_turns_the_same_card_to_the_next_version(self, backend: DraftBackend, cards: CardRegistry) -> None:
        backend.write(DRAFT, "# Aktenvermerk\n\nPunkt 3\n")
        backend.edit(DRAFT, "Punkt 3", "Punkt 3 gekürzt")
        assert [card["version"] for card in cards.snapshot()] == [2]

    def test_two_paths_keep_two_cards_in_their_order(self, cards: CardRegistry) -> None:
        emit_draft_card(path="/drafts/a.xlsx", content="", version=1, size=10)
        emit_draft_card(path="/drafts/b.docx", content="", version=1, size=20)
        emit_draft_card(path="/drafts/a.xlsx", content="", version=2, size=12)
        assert [(card["path"], card["version"]) for card in cards.snapshot()] == [
            ("/drafts/a.xlsx", 2),
            ("/drafts/b.docx", 1),
        ]

    def test_a_refused_verb_puts_up_nothing(self, backend: DraftBackend, cards: CardRegistry) -> None:
        backend.write(DRAFT, "# Aktenvermerk\n")
        backend.write(DRAFT, "# Noch einmal\n")
        backend.edit(DRAFT, "gibt es nicht", "x")
        assert len(cards.snapshot()) == 1

    def test_no_card_channel_is_not_a_failed_write(self, backend: DraftBackend) -> None:
        assert emit_draft_card(path=DRAFT, content="# Vermerk\n", version=1) is False
        assert backend.write(DRAFT, "# Vermerk\n").error is None
