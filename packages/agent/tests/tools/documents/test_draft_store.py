from __future__ import annotations

import unicodedata

import pytest
from langgraph.store.memory import InMemoryStore

from agent.tools.documents import draft_store
from agent.tools.documents.draft_store import DRAFT_ROOT
from agent.tools.documents.draft_store import MAX_DRAFT_BYTES
from agent.tools.documents.draft_store import VERSION_KEY
from agent.tools.documents.draft_store import DraftBackend
from agent.tools.documents.draft_store import draft_namespace
from agent.tools.documents.draft_store import get_draft_backend
from agent.tools.documents.draft_store import get_draft_store
from agent.tools.documents.draft_store import normalize_draft_text
from agent.tools.documents.draft_store import reset_draft_stores

COMPOSED = unicodedata.normalize("NFC", "Gebäudeklasse 4")
DECOMPOSED = unicodedata.normalize("NFD", "Gebäudeklasse 4")

DRAFT = f"{DRAFT_ROOT}aktenvermerk.md"


@pytest.fixture
def backend() -> DraftBackend:
    return DraftBackend(store=InMemoryStore(), conversation_id="conv-1")


def stored(backend: DraftBackend, path: str = DRAFT) -> dict:
    item = backend._get_store().get(draft_namespace(backend.conversation_id), path)
    assert item is not None
    return item.value


class TestNfc:
    def test_the_two_spellings_are_not_the_same_bytes(self) -> None:
        assert COMPOSED != DECOMPOSED
        assert len(COMPOSED) < len(DECOMPOSED)

    def test_stored_content_is_composed(self, backend: DraftBackend) -> None:
        backend.write(DRAFT, f"# Vermerk\n\n{DECOMPOSED}\n")
        assert stored(backend)["content"] == f"# Vermerk\n\n{COMPOSED}\n"

    def test_a_decomposed_old_string_still_finds_composed_text(self, backend: DraftBackend) -> None:
        backend.write(DRAFT, f"# Vermerk\n\n{COMPOSED}\n")
        result = backend.edit(DRAFT, DECOMPOSED, "Gebäudeklasse 5")
        assert result.error is None
        assert result.occurrences == 1
        assert "Gebäudeklasse 5" in stored(backend)["content"]

    def test_a_decomposed_new_string_lands_composed(self, backend: DraftBackend) -> None:
        backend.write(DRAFT, "# Vermerk\n\nPlatzhalter\n")
        backend.edit(DRAFT, "Platzhalter", DECOMPOSED)
        assert stored(backend)["content"].endswith(f"{COMPOSED}\n")

    def test_normalisation_leaves_empty_text_alone(self) -> None:
        assert normalize_draft_text("") == ""


class TestTheCeiling:
    def test_a_write_past_the_ceiling_is_refused_with_a_readable_reason(self, backend: DraftBackend) -> None:
        result = backend.write(DRAFT, "x" * (MAX_DRAFT_BYTES + 1))
        assert result.error is not None
        assert f"{MAX_DRAFT_BYTES // 1024} KB" in result.error
        assert "Shorten the document" in result.error
        assert "edit the existing file" in result.error

    def test_a_refused_write_stores_nothing(self, backend: DraftBackend) -> None:
        backend.write(DRAFT, "x" * (MAX_DRAFT_BYTES + 1))
        assert backend._get_store().get(draft_namespace("conv-1"), DRAFT) is None

    def test_the_ceiling_is_the_whole_conversation_not_one_file(self, backend: DraftBackend) -> None:
        half = "x" * (MAX_DRAFT_BYTES // 2)
        assert backend.write(f"{DRAFT_ROOT}a.md", half).error is None
        assert backend.write(f"{DRAFT_ROOT}b.md", half).error is None
        assert backend.write(f"{DRAFT_ROOT}c.md", half).error is not None

    def test_replacing_a_file_counts_only_the_difference(self, backend: DraftBackend) -> None:
        big = "x" * (MAX_DRAFT_BYTES - 10)
        assert backend.write(f"{DRAFT_ROOT}a.md", big).error is None
        assert backend.edit(f"{DRAFT_ROOT}a.md", big, "y" * (MAX_DRAFT_BYTES - 10)).error is None

    def test_an_edit_that_would_grow_past_the_ceiling_is_refused(self, backend: DraftBackend) -> None:
        backend.write(DRAFT, "x" * (MAX_DRAFT_BYTES - 100))
        result = backend.edit(DRAFT, "x" * 50, "y" * 200)
        assert result.error is not None
        assert "would exceed its" in result.error

    def test_an_edit_that_shrinks_is_never_refused(self, backend: DraftBackend) -> None:
        backend.write(DRAFT, "# Vermerk\n\n" + "x" * (MAX_DRAFT_BYTES - 100))
        assert backend.edit(DRAFT, "# Vermerk", "# V").error is None

    def test_a_multibyte_draft_is_measured_in_bytes(self, backend: DraftBackend) -> None:
        result = backend.write(DRAFT, "ä" * (MAX_DRAFT_BYTES // 2 + 1))
        assert result.error is not None


class TestThePathRoot:
    def test_a_write_outside_the_root_is_refused(self, backend: DraftBackend) -> None:
        result = backend.write("/etc/passwd", "x")
        assert result.error is not None
        assert DRAFT_ROOT in result.error

    def test_traversal_out_of_the_root_is_refused(self, backend: DraftBackend) -> None:
        assert backend.write(f"{DRAFT_ROOT}../secrets.md", "x").error is not None

    def test_an_edit_outside_the_root_is_refused(self, backend: DraftBackend) -> None:
        assert backend.edit("/etc/passwd", "a", "b").error is not None

    def test_the_root_itself_is_inside_with_or_without_slash(self) -> None:
        assert draft_store.path_refusal(DRAFT_ROOT) is None
        assert draft_store.path_refusal(DRAFT_ROOT.rstrip("/")) is None

    def test_a_write_to_the_root_itself_is_refused(self, backend: DraftBackend) -> None:
        for root in (DRAFT_ROOT, DRAFT_ROOT.rstrip("/")):
            result = backend.write(root, "# Vermerk\n")
            assert result.error is not None
            assert f"{DRAFT_ROOT}<name>.md" in result.error

    def test_an_edit_of_the_root_itself_is_refused(self, backend: DraftBackend) -> None:
        assert backend.edit(DRAFT_ROOT.rstrip("/"), "a", "b").error is not None

    def test_the_refusal_names_the_recovery(self, backend: DraftBackend) -> None:
        result = backend.write("/etc/passwd", "x")
        assert result.error is not None
        assert "`ls`" in result.error
        assert "`read_file`" in result.error
        assert f"{DRAFT_ROOT}<name>.md" in result.error

    def test_the_traversal_refusal_names_the_recovery(self, backend: DraftBackend) -> None:
        result = backend.write(f"{DRAFT_ROOT}../secrets.md", "x")
        assert result.error is not None
        assert "`ls`" in result.error

    def test_listing_the_bare_root_lists_the_drafts(self, backend: DraftBackend) -> None:
        backend.write(DRAFT, "# Vermerk\n")
        assert [entry["path"] for entry in backend.ls(DRAFT_ROOT.rstrip("/")).entries] == [DRAFT]


class TestTheStockContract:
    def test_write_is_create_only(self, backend: DraftBackend) -> None:
        backend.write(DRAFT, "# Vermerk\n")
        result = backend.write(DRAFT, "# Anderer Vermerk\n")
        assert result.error is not None
        assert "already exists" in result.error
        assert "edit_file" in result.error
        assert backend.read(DRAFT).file_data["content"] == "# Vermerk\n"

    async def test_write_is_create_only_on_the_async_path(self, backend: DraftBackend) -> None:
        await backend.awrite(DRAFT, "# Vermerk\n")
        result = await backend.awrite(DRAFT, "# Anderer Vermerk\n")
        assert result.error is not None
        assert "already exists" in result.error
        assert (await backend.aread(DRAFT)).file_data["content"] == "# Vermerk\n"

    def test_an_ambiguous_edit_reports_the_count(self, backend: DraftBackend) -> None:
        backend.write(DRAFT, "Frist\nFrist\nFrist\n")
        result = backend.edit(DRAFT, "Frist", "Termin")
        assert result.error is not None
        assert "appears 3 times" in result.error

    def test_a_missing_string_says_so(self, backend: DraftBackend) -> None:
        backend.write(DRAFT, "# Vermerk\n")
        assert "String not found in file" in (backend.edit(DRAFT, "Frist", "Termin").error or "")

    def test_editing_a_file_that_does_not_exist_says_so(self, backend: DraftBackend) -> None:
        assert "not found" in (backend.edit(DRAFT, "a", "b").error or "")


class TestNamespaceIsolation:
    def test_two_conversations_never_see_each_other(self) -> None:
        store = InMemoryStore()
        first = DraftBackend(store=store, conversation_id="conv-1")
        second = DraftBackend(store=store, conversation_id="conv-2")

        first.write(DRAFT, "# Vermerk aus Unterhaltung 1\n")

        assert second.read(DRAFT).error is not None
        assert second.ls(DRAFT_ROOT).entries == []
        assert first.ls(DRAFT_ROOT).entries != []

    def test_the_same_path_in_two_conversations_holds_two_documents(self) -> None:
        store = InMemoryStore()
        first = DraftBackend(store=store, conversation_id="conv-1")
        second = DraftBackend(store=store, conversation_id="conv-2")

        first.write(DRAFT, "# Eins\n")
        assert second.write(DRAFT, "# Zwei\n").error is None
        assert stored(first)["content"] == "# Eins\n"
        assert stored(second)["content"] == "# Zwei\n"

    def test_the_namespace_is_the_conversation(self) -> None:
        assert draft_namespace("conv-1") == ("conversation", "conv-1", "drafts")


class TestTheVersionCounter:
    def test_a_first_write_is_version_one(self, backend: DraftBackend) -> None:
        backend.write(DRAFT, "# Vermerk\n")
        assert stored(backend)[VERSION_KEY] == 1

    def test_every_edit_advances_it(self, backend: DraftBackend) -> None:
        backend.write(DRAFT, "# Vermerk\n\nPunkt 3\n")
        backend.edit(DRAFT, "Punkt 3", "Punkt 3 (gekürzt)")
        backend.edit(DRAFT, "gekürzt", "gestrichen")
        assert stored(backend)[VERSION_KEY] == 3

    def test_a_refused_edit_does_not_advance_it(self, backend: DraftBackend) -> None:
        backend.write(DRAFT, "# Vermerk\n")
        backend.edit(DRAFT, "gibt es nicht", "x")
        assert stored(backend)[VERSION_KEY] == 1

    def test_the_counter_does_not_reach_the_file_tools(self, backend: DraftBackend) -> None:
        backend.write(DRAFT, "# Vermerk\n")
        result = backend.read(DRAFT)
        assert result.error is None
        assert result.file_data["content"] == "# Vermerk\n"


class TestTheAsyncHalf:
    @pytest.mark.asyncio
    async def test_write_and_edit_normalise_and_count(self, backend: DraftBackend) -> None:
        assert (await backend.awrite(DRAFT, f"# Vermerk\n\n{DECOMPOSED}\n")).error is None
        result = await backend.aedit(DRAFT, DECOMPOSED, "Gebäudeklasse 5")
        assert result.error is None
        assert stored(backend)[VERSION_KEY] == 2

    @pytest.mark.asyncio
    async def test_the_ceiling_holds_on_the_async_path(self, backend: DraftBackend) -> None:
        assert (await backend.awrite(DRAFT, "x" * (MAX_DRAFT_BYTES + 1))).error is not None

    @pytest.mark.asyncio
    async def test_the_root_holds_on_the_async_path(self, backend: DraftBackend) -> None:
        assert (await backend.awrite("/etc/passwd", "x")).error is not None

    @pytest.mark.asyncio
    async def test_small_text_files_of_a_run_do_not_use_up_the_markdown_budget(self, backend: DraftBackend) -> None:
        table = ("Raum;Fläche\n" + "EG;32,4\n" * 7000).encode()
        assert len(table) <= draft_store.MAX_RUN_TEXT_BYTES
        for index in range(5):
            assert await backend.awrite_run_file(f"{DRAFT_ROOT}tabelle-{index}.csv", table) is None
        assert stored(backend, f"{DRAFT_ROOT}tabelle-0.csv")["encoding"] == "utf-8"
        assert (await backend.awrite(DRAFT, "# Aktenvermerk\n\n" + "x" * (MAX_DRAFT_BYTES - 1024))).error is None


class TestTheStoreFactory:
    @pytest.fixture(autouse=True)
    def _clear(self):
        reset_draft_stores()
        yield
        reset_draft_stores()

    @pytest.mark.asyncio
    async def test_a_non_postgres_dsn_falls_back_to_memory(self, caplog) -> None:
        with caplog.at_level("WARNING"):
            store = await get_draft_store("./checkpoints.db")
        assert isinstance(store, InMemoryStore)
        assert "do not survive a restart" in caplog.text

    @pytest.mark.asyncio
    async def test_the_store_is_built_once_per_process(self) -> None:
        first = await get_draft_store("./checkpoints.db")
        second = await get_draft_store("./checkpoints.db")
        assert first is second

    @pytest.mark.asyncio
    async def test_a_postgres_dsn_takes_the_postgres_store(self, monkeypatch) -> None:
        built: dict[str, str] = {}

        class _FakeStore:
            def __init__(self, pool) -> None:
                built["pool"] = pool

            async def setup(self) -> None:
                built["setup"] = "ran"

        monkeypatch.setattr(draft_store, "is_postgres_dsn", lambda _dsn: True)
        monkeypatch.setitem(
            __import__("sys").modules,
            "langgraph.store.postgres",
            type("_M", (), {"AsyncPostgresStore": _FakeStore}),
        )
        monkeypatch.setattr("agent.common.get_checkpoint_pool", lambda dsn: f"pool:{dsn}")

        store = await get_draft_store("postgresql://x/y")
        assert isinstance(store, _FakeStore)
        assert built == {"pool": "pool:postgresql://x/y", "setup": "ran"}

    @pytest.mark.asyncio
    async def test_the_backend_is_pinned_to_one_conversation(self) -> None:
        backend = await get_draft_backend("conv-9", "./checkpoints.db")
        assert backend.conversation_id == "conv-9"
        assert backend._get_namespace() == ("conversation", "conv-9", "drafts")


class TestTheFilingRecordIsReadOnce:
    WRITE_ROUTE_BODY = {
        "documentId": "doc-1",
        "alreadyFiled": False,
        "version": {"id": "ver-1", "documentId": "doc-1", "state": "draft", "contentHash": "h1"},
    }
    READ_ROUTE_BODY = {
        "documentId": "doc-1",
        "versionId": "ver-1",
        "state": "draft",
        "contentHash": "h1",
        "content": "# Befund\n",
    }

    def test_the_two_shapes_produce_the_same_record(self) -> None:
        assert draft_store.filing_record(self.WRITE_ROUTE_BODY) == draft_store.filing_record(self.READ_ROUTE_BODY)

    def test_every_filing_key_is_filled(self) -> None:
        record = draft_store.filing_record(self.WRITE_ROUTE_BODY)
        assert record == {
            draft_store.FILED_DOCUMENT_KEY: "doc-1",
            draft_store.FILED_VERSION_KEY: "ver-1",
            draft_store.FILED_HASH_KEY: "h1",
            draft_store.FILED_STATE_KEY: "draft",
        }

    def test_the_document_id_may_arrive_on_either_level(self) -> None:
        nested_only = {"version": {"id": "ver-1", "documentId": "doc-1", "state": "draft", "contentHash": "h1"}}
        assert draft_store.filing_record(nested_only)[draft_store.FILED_DOCUMENT_KEY] == "doc-1"

    def test_a_body_with_nothing_in_it_yields_empty_strings_not_a_crash(self) -> None:
        assert draft_store.filing_record({}) == dict.fromkeys(draft_store.FILING_KEYS, "")
        assert draft_store.filing_record({"version": None}) == dict.fromkeys(draft_store.FILING_KEYS, "")

    def test_both_callers_read_the_record_through_this_one_function(self) -> None:
        from agent.tools.documents import register as filing_tools
        from agent.turn import subject_document

        assert filing_tools.filing_record is draft_store.filing_record
        assert subject_document.filing_record is draft_store.filing_record


class TestDroppingAConversationsWorkingDirectory:
    @pytest.fixture(autouse=True)
    def _store(self, monkeypatch: pytest.MonkeyPatch) -> InMemoryStore:
        memory = InMemoryStore()

        async def _get_store(dsn: str | None = None) -> InMemoryStore:
            return memory

        monkeypatch.setattr(draft_store, "get_draft_store", _get_store)
        return memory

    async def _write(self, store: InMemoryStore, conversation_id: str, name: str) -> None:
        backend = DraftBackend(store=store, conversation_id=conversation_id)
        result = await backend.awrite(f"{DRAFT_ROOT}{name}.md", f"# {name}\n")
        assert result.error is None

    def _keys(self, store: InMemoryStore, conversation_id: str) -> list[str]:
        return [item.key for item in store.search(draft_namespace(conversation_id))]

    @pytest.mark.asyncio
    async def test_every_file_in_the_namespace_goes(self, _store) -> None:
        await self._write(_store, "conv-a", "befund")
        await self._write(_store, "conv-a", "aktenvermerk")

        assert await draft_store.delete_conversation_drafts("conv-a") == 2
        assert self._keys(_store, "conv-a") == []

    @pytest.mark.asyncio
    async def test_another_conversation_is_untouched(self, _store) -> None:
        await self._write(_store, "conv-a", "befund")
        await self._write(_store, "conv-b", "befund")

        await draft_store.delete_conversation_drafts("conv-a")

        assert self._keys(_store, "conv-b") == [f"{DRAFT_ROOT}befund.md"]

    @pytest.mark.asyncio
    async def test_an_empty_namespace_is_zero_and_not_an_error(self, _store) -> None:
        assert await draft_store.delete_conversation_drafts("conv-never-wrote") == 0

    @pytest.mark.asyncio
    async def test_it_is_idempotent(self, _store) -> None:
        await self._write(_store, "conv-a", "befund")

        assert await draft_store.delete_conversation_drafts("conv-a") == 1
        assert await draft_store.delete_conversation_drafts("conv-a") == 0

    @pytest.mark.asyncio
    async def test_a_namespace_larger_than_one_page_is_swept_whole(self, _store, monkeypatch) -> None:
        monkeypatch.setattr(draft_store, "_PAGE_SIZE", 2)
        for index in range(5):
            await self._write(_store, "conv-a", f"entwurf-{index}")

        assert await draft_store.delete_conversation_drafts("conv-a") == 5
        assert self._keys(_store, "conv-a") == []

    @pytest.mark.asyncio
    async def test_a_key_the_store_will_not_drop_ends_the_sweep(self, monkeypatch) -> None:
        deletes: list[str] = []

        class _Stubborn(InMemoryStore):
            async def adelete(self, namespace, key) -> None:  # noqa: ANN001 - store signature
                deletes.append(key)

        stubborn = _Stubborn()

        async def _get_store(dsn: str | None = None) -> InMemoryStore:
            return stubborn

        monkeypatch.setattr(draft_store, "get_draft_store", _get_store)
        await self._write(stubborn, "conv-a", "befund")

        assert await draft_store.delete_conversation_drafts("conv-a") == 1
        assert deletes == [f"{DRAFT_ROOT}befund.md"]
        assert self._keys(stubborn, "conv-a") == [f"{DRAFT_ROOT}befund.md"]


class TestTheGermanRootStillReads:
    @pytest.mark.parametrize(
        ("old", "new"),
        [
            ("/entwuerfe/a.md", "/drafts/a.md"),
            ("entwuerfe/a.md", "/drafts/a.md"),
            (" /entwuerfe/a.md", "/drafts/a.md"),
            ("/entwuerfe", "/drafts"),
            ("/drafts/a.md", "/drafts/a.md"),
            ("/elsewhere/a.md", "/elsewhere/a.md"),
        ],
    )
    def test_a_legacy_path_reads_as_the_english_root(self, old: str, new: str):
        assert draft_store.modernize_draft_path(old) == new

    @pytest.mark.asyncio
    async def test_a_store_without_a_pool_has_nothing_to_rename(self):
        assert await draft_store.rename_legacy_draft_keys(InMemoryStore()) == 0

    @pytest.mark.asyncio
    async def test_the_rename_moves_only_draft_namespaces_and_keeps_an_existing_twin(self):
        sent: list[tuple[str, dict]] = []

        class _Cursor:
            rowcount = 3

        class _Conn:
            async def execute(self, statement: str, params: dict) -> _Cursor:
                sent.append((statement, params))
                return _Cursor()

        class _Pool:
            def connection(self):
                conn = _Conn()

                class _Ctx:
                    async def __aenter__(self_inner):
                        return conn

                    async def __aexit__(self_inner, *exc):
                        return False

                return _Ctx()

        class _Store:
            conn = _Pool()

        assert await draft_store.rename_legacy_draft_keys(_Store()) == 3  # type: ignore[arg-type]
        statement, params = sent[0]
        assert "prefix LIKE 'conversation.%%.drafts'" in statement
        assert "NOT EXISTS" in statement
        assert params == {"new": "/drafts/", "cut": len("/entwuerfe/") + 1, "like": "/entwuerfe/%"}


class TestOwnKeysSurviveAnEdit:
    @pytest.mark.asyncio
    async def test_an_edit_of_a_run_made_csv_keeps_its_keys_and_stays_out_of_the_markdown_budget(
        self, backend: DraftBackend
    ) -> None:
        path = f"{DRAFT_ROOT}tabelle.csv"
        table = ("Raum;Fläche\n" + "EG;32,4\n" * 7000).encode()
        origin = {"document_id": "doc-1", "name": "tabelle.csv", "content_hash": "sha256:x"}
        assert await backend.awrite_run_file(path, table, derived_from=origin) is None
        await backend.arecord_filing(path, {draft_store.FILED_DOCUMENT_KEY: "doc-9"}, draft_version=1)

        assert (await backend.aedit(path, "Raum;Fläche", "Raum;Nutzfläche")).error is None

        value = stored(backend, path)
        assert value[draft_store.MADE_BY_KEY] == draft_store.MADE_BY_RUN
        assert value[draft_store.DERIVED_FROM_KEY] == origin
        assert value[draft_store.FILED_AT_DRAFT_VERSION_KEY] == 1
        assert value[draft_store.FILED_DOCUMENT_KEY] == "doc-9"
        assert (await backend.ausage(path)).total_bytes == 0

    @pytest.mark.asyncio
    async def test_removing_a_draft_deletes_it_only_at_the_version_the_caller_saw(self, backend: DraftBackend) -> None:
        path = f"{DRAFT_ROOT}a.xlsx"
        await backend.awrite_run_file(path, b"PK")
        await backend.awrite_run_file(path, b"PK2")
        assert await backend.aremove(path, version=1) is False
        assert await backend.aremove(path, version=2) is True
        assert (await backend.ausage(path)).content is None
        assert await backend.aremove(path) is False
