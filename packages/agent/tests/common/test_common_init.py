import os
import tempfile
from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest

from agent.common import DEFAULT_DATA_SOURCES
from agent.common import extract_messages_and_sources
from agent.common import filter_tools_by_sources
from agent.common import format_data_source_tools
from agent.common import get_checkpointer
from agent.common import is_postgres_dsn
from agent.common import is_verbose
from agent.common import parse_data_sources


class TestIsVerbose:
    def test_verbose_env_true_overrides_config_false(self):
        with patch.dict(os.environ, {"AGENT_VERBOSE": "true"}):
            assert is_verbose(config_verbose=False) is True

    def test_verbose_env_1_overrides_config_false(self):
        with patch.dict(os.environ, {"AGENT_VERBOSE": "1"}):
            assert is_verbose(config_verbose=False) is True

    def test_verbose_env_yes_overrides_config_false(self):
        with patch.dict(os.environ, {"AGENT_VERBOSE": "yes"}):
            assert is_verbose(config_verbose=False) is True

    def test_verbose_env_false_overrides_config_true(self):
        with patch.dict(os.environ, {"AGENT_VERBOSE": "false"}):
            assert is_verbose(config_verbose=True) is False

    def test_verbose_env_0_overrides_config_true(self):
        with patch.dict(os.environ, {"AGENT_VERBOSE": "0"}):
            assert is_verbose(config_verbose=True) is False

    def test_verbose_env_no_overrides_config_true(self):
        with patch.dict(os.environ, {"AGENT_VERBOSE": "no"}):
            assert is_verbose(config_verbose=True) is False

    def test_verbose_env_empty_uses_config_true(self):
        with patch.dict(os.environ, {"AGENT_VERBOSE": ""}):
            assert is_verbose(config_verbose=True) is True

    def test_verbose_env_empty_uses_config_false(self):
        with patch.dict(os.environ, {"AGENT_VERBOSE": ""}):
            assert is_verbose(config_verbose=False) is False

    def test_verbose_env_unset_uses_config_true(self):
        with patch.dict(os.environ, clear=True):
            os.environ.pop("AGENT_VERBOSE", None)
            assert is_verbose(config_verbose=True) is True

    def test_verbose_env_unset_uses_config_false(self):
        with patch.dict(os.environ, clear=True):
            os.environ.pop("AGENT_VERBOSE", None)
            assert is_verbose(config_verbose=False) is False

    def test_verbose_env_uppercase_true(self):
        with patch.dict(os.environ, {"AGENT_VERBOSE": "TRUE"}):
            assert is_verbose(config_verbose=False) is True

    def test_verbose_env_random_value_uses_config(self):
        with patch.dict(os.environ, {"AGENT_VERBOSE": "maybe"}):
            assert is_verbose(config_verbose=True) is True
            assert is_verbose(config_verbose=False) is False


class TestDataSourcesExports:
    def test_default_data_sources_exported(self):
        assert DEFAULT_DATA_SOURCES is not None
        assert isinstance(DEFAULT_DATA_SOURCES, list)
        assert "web_search" in DEFAULT_DATA_SOURCES

    def test_parse_data_sources_exported(self):
        result = parse_data_sources(["web_search"])
        assert result == ["web_search"]

    def test_filter_tools_by_sources_exported(self):
        result = filter_tools_by_sources([], None)
        assert result == []

    def test_extract_messages_and_sources_exported(self):
        from langchain_core.messages import HumanMessage

        messages = [HumanMessage(content="Test")]
        result_messages, result_sources = extract_messages_and_sources(messages)
        assert result_messages == messages
        assert result_sources is None

    def test_format_data_source_tools_exported(self):
        result = format_data_source_tools(["web_search"])
        assert len(result) == 1
        assert result[0]["name"] == "Web Search"

    def test_get_all_tool_refs_exported(self):
        from agent.common import get_all_tool_refs

        assert callable(get_all_tool_refs)

    def test_get_source_id_for_tool_exported(self):
        from agent.common import get_source_id_for_tool

        assert callable(get_source_id_for_tool)


class TestIsPostgresDsn:
    def test_postgresql_scheme(self):
        assert is_postgres_dsn("postgresql://user:pass@localhost:5432/db") is True

    def test_postgres_scheme(self):
        assert is_postgres_dsn("postgres://user:pass@localhost:5432/db") is True

    def test_sqlite_path_not_postgres(self):
        assert is_postgres_dsn("./checkpoints.db") is False
        assert is_postgres_dsn("/tmp/checkpoints.db") is False

    def test_empty_string(self):
        assert is_postgres_dsn("") is False

    def test_http_url_not_postgres(self):
        assert is_postgres_dsn("http://localhost:5432") is False
        assert is_postgres_dsn("https://example.com") is False

    def test_postgres_with_options(self):
        dsn = "postgresql://user:pass@localhost:5432/db?sslmode=require"
        assert is_postgres_dsn(dsn) is True

    def test_postgres_without_port(self):
        assert is_postgres_dsn("postgresql://user:pass@localhost/db") is True


class TestGetCheckpointer:
    @pytest.fixture(autouse=True)
    def clear_checkpointer_cache(self):
        import agent.common as common_module

        common_module._checkpointers.clear()
        common_module._postgres_pools.clear()
        yield
        common_module._checkpointers.clear()
        common_module._postgres_pools.clear()

    @staticmethod
    async def _close_sqlite_checkpointers():
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

        import agent.common as common_module

        for checkpointer in common_module._checkpointers.values():
            if isinstance(checkpointer, AsyncSqliteSaver):
                await checkpointer.conn.close()

    @pytest.mark.asyncio
    async def test_sqlite_checkpointer_creation(self):
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name

        try:
            checkpointer = await get_checkpointer(db_path)

            from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

            assert isinstance(checkpointer, AsyncSqliteSaver)
        finally:
            await self._close_sqlite_checkpointers()
            os.unlink(db_path)

    @pytest.mark.asyncio
    async def test_checkpointer_caching(self):
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name

        try:
            checkpointer1 = await get_checkpointer(db_path)
            checkpointer2 = await get_checkpointer(db_path)

            assert checkpointer1 is checkpointer2
        finally:
            await self._close_sqlite_checkpointers()
            os.unlink(db_path)

    @pytest.mark.asyncio
    async def test_different_paths_different_checkpointers(self):
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f1:
            db_path1 = f1.name
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f2:
            db_path2 = f2.name

        try:
            checkpointer1 = await get_checkpointer(db_path1)
            checkpointer2 = await get_checkpointer(db_path2)

            assert checkpointer1 is not checkpointer2
        finally:
            await self._close_sqlite_checkpointers()
            os.unlink(db_path1)
            os.unlink(db_path2)

    @pytest.mark.asyncio
    async def test_postgres_checkpointer_creation(self):
        postgres_dsn = "postgresql://user:pass@localhost:5432/testdb"

        mock_pool = MagicMock()
        mock_checkpointer = MagicMock()
        mock_checkpointer.setup = AsyncMock()

        with (
            patch("agent.common.AsyncConnectionPool", return_value=mock_pool),
            patch("agent.common.AsyncPostgresSaver", return_value=mock_checkpointer),
        ):
            checkpointer = await get_checkpointer(postgres_dsn)

            assert checkpointer is mock_checkpointer
            mock_checkpointer.setup.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_postgres_pool_default_sizing(self, monkeypatch):
        monkeypatch.delenv("CHECKPOINT_POOL_MIN_SIZE", raising=False)
        monkeypatch.delenv("CHECKPOINT_POOL_MAX_SIZE", raising=False)
        mock_checkpointer = MagicMock()
        mock_checkpointer.setup = AsyncMock()
        with (
            patch("agent.common.AsyncConnectionPool", return_value=MagicMock()) as mock_pool_class,
            patch("agent.common.AsyncPostgresSaver", return_value=mock_checkpointer),
        ):
            await get_checkpointer("postgresql://user:pass@localhost:5432/testdb")
        kwargs = mock_pool_class.call_args.kwargs
        assert kwargs["min_size"] == 1
        assert kwargs["max_size"] == 10

    @pytest.mark.asyncio
    async def test_postgres_pool_sizing_env_override(self, monkeypatch):
        monkeypatch.setenv("CHECKPOINT_POOL_MIN_SIZE", "4")
        monkeypatch.setenv("CHECKPOINT_POOL_MAX_SIZE", "2")  # < min -> floored to min
        mock_checkpointer = MagicMock()
        mock_checkpointer.setup = AsyncMock()
        with (
            patch("agent.common.AsyncConnectionPool", return_value=MagicMock()) as mock_pool_class,
            patch("agent.common.AsyncPostgresSaver", return_value=mock_checkpointer),
        ):
            await get_checkpointer("postgresql://user:pass@localhost:5432/testdb")
        kwargs = mock_pool_class.call_args.kwargs
        assert kwargs["min_size"] == 4
        assert kwargs["max_size"] == 4

    @pytest.mark.asyncio
    async def test_postgres_pool_caching(self):
        postgres_dsn = "postgresql://user:pass@localhost:5432/testdb"

        mock_pool = MagicMock()
        mock_checkpointer = MagicMock()
        mock_checkpointer.setup = AsyncMock()

        with (
            patch("agent.common.AsyncConnectionPool", return_value=mock_pool) as mock_pool_class,
            patch("agent.common.AsyncPostgresSaver", return_value=mock_checkpointer),
        ):
            await get_checkpointer(postgres_dsn)

            import agent.common as common_module

            common_module._checkpointers.clear()

            await get_checkpointer(postgres_dsn)

            assert mock_pool_class.call_count == 1

    @pytest.mark.asyncio
    async def test_sqlite_serde_round_trips_all_state_types(self):
        import aiosqlite
        from langchain_core.messages import AIMessage
        from langchain_core.messages import HumanMessage
        from langgraph.checkpoint.base import empty_checkpoint
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

        from agent.common import _build_checkpointer_serde
        from agent.core.models import ConversationState
        from agent.knowledge.schema import AvailableDocument

        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name

        conn = await aiosqlite.connect(db_path)
        try:
            checkpointer = AsyncSqliteSaver(conn, serde=_build_checkpointer_serde())
            await checkpointer.setup()

            state = ConversationState(
                messages=[HumanMessage(content="hi"), AIMessage(content="hello")],
                routing_decision="deep",
                escalate_to_deep=True,
                escalation_ask_reason="insufficient",
                available_documents=[AvailableDocument(file_name="doc.txt", summary="s", tags=["oib"])],
                answer_confidence="high",
            )

            checkpoint = empty_checkpoint()
            checkpoint["channel_values"] = {
                "messages": state.messages,
                "routing_decision": state.routing_decision,
                "escalate_to_deep": state.escalate_to_deep,
                "escalation_ask_reason": state.escalation_ask_reason,
                "available_documents": state.available_documents,
                "answer_confidence": state.answer_confidence,
            }
            config = {"configurable": {"thread_id": "t1", "checkpoint_ns": ""}}
            saved_config = await checkpointer.aput(config, checkpoint, {}, {})

            restored = (await checkpointer.aget_tuple(saved_config)).checkpoint["channel_values"]

            assert restored["routing_decision"] == "deep"
            assert restored["escalate_to_deep"] is True
            assert restored["escalation_ask_reason"] == "insufficient"
            assert restored["available_documents"] == state.available_documents
            assert isinstance(restored["available_documents"][0], AvailableDocument)
            assert restored["answer_confidence"] == "high"
            assert [m.content for m in restored["messages"]] == ["hi", "hello"]
        finally:
            await conn.close()
            os.unlink(db_path)

    @pytest.mark.asyncio
    async def test_a_checkpoint_holding_a_retired_state_type_still_restores(self):
        import aiosqlite
        from langchain_core.messages import HumanMessage
        from langgraph.checkpoint.base import empty_checkpoint
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
        from pydantic import BaseModel

        from agent.common import _build_checkpointer_serde
        from agent.core.models import ConversationState

        class RetiredStateType(BaseModel):
            answer: str
            escalate_to_deep: bool

        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            db_path = f.name

        conn = await aiosqlite.connect(db_path)
        try:
            checkpointer = AsyncSqliteSaver(conn, serde=_build_checkpointer_serde())
            await checkpointer.setup()

            checkpoint = empty_checkpoint()
            checkpoint["channel_values"] = {
                "messages": [HumanMessage(content="hi")],
                "shallow_result": RetiredStateType(answer="a", escalate_to_deep=True),
            }
            config = {"configurable": {"thread_id": "t1", "checkpoint_ns": ""}}
            saved_config = await checkpointer.aput(config, checkpoint, {}, {})

            restored = (await checkpointer.aget_tuple(saved_config)).checkpoint["channel_values"]

            assert restored["shallow_result"] == {"answer": "a", "escalate_to_deep": True}
            assert [m.content for m in restored["messages"]] == ["hi"]
            assert "shallow_result" not in ConversationState.model_fields
        finally:
            await conn.close()
            os.unlink(db_path)
