from unittest.mock import MagicMock

import pytest
from langchain_core.messages import HumanMessage

from agent.common.data_source_registry import populate_from_config
from agent.common.data_source_registry import reset_registry
from agent.common.data_sources import DEFAULT_DATA_SOURCES
from agent.common.data_sources import extract_messages_and_sources
from agent.common.data_sources import filter_tools_by_sources
from agent.common.data_sources import format_data_source_tools
from agent.common.data_sources import parse_data_sources


@pytest.fixture(autouse=True)
def _setup_registry():
    reset_registry()

    populate_from_config(
        [
            {
                "id": "web_search",
                "name": "Web Search",
                "description": "Search the web for real-time information.",
                "tools": ["web_search_tool", "web_search", "tavily_search"],
            },
            {
                "id": "knowledge_layer",
                "name": "Knowledge Base",
                "description": "Search uploaded documents and files.",
                "tools": ["knowledge_search", "knowledge_retrieval"],
            },
            {
                "id": "scholar_search",
                "name": "Academic Papers",
                "description": "Search academic papers.",
                "tools": ["scholar_search_tool"],
            },
        ]
    )

    yield
    reset_registry()


class TestParseDataSources:
    def test_parse_none_returns_none(self):
        assert parse_data_sources(None) is None

    def test_parse_empty_list_returns_empty_list(self):
        assert parse_data_sources([]) == []

    def test_parse_empty_string_returns_empty_list(self):
        assert parse_data_sources("") == []

    def test_parse_whitespace_only_string_returns_empty_list(self):
        assert parse_data_sources("   ") == []

    def test_parse_list_of_strings(self):
        result = parse_data_sources(["web_search", "confluence", "sharepoint"])
        assert result == ["web_search", "confluence", "sharepoint"]

    def test_parse_list_with_whitespace(self):
        result = parse_data_sources(["  web_search  ", " confluence ", "sharepoint"])
        assert result == ["web_search", "confluence", "sharepoint"]

    def test_parse_list_filters_empty_strings(self):
        result = parse_data_sources(["web_search", "", "  ", "confluence"])
        assert result == ["web_search", "confluence"]

    def test_parse_list_all_empty_returns_empty_list(self):
        assert parse_data_sources(["", "  ", ""]) == []

    def test_parse_comma_separated_string(self):
        result = parse_data_sources("web_search,confluence,sharepoint")
        assert result == ["web_search", "confluence", "sharepoint"]

    def test_parse_comma_separated_with_spaces(self):
        result = parse_data_sources("web_search, confluence , sharepoint")
        assert result == ["web_search", "confluence", "sharepoint"]

    def test_parse_single_value_string(self):
        result = parse_data_sources("web_search")
        assert result == ["web_search"]

    def test_parse_list_of_integers_converts_to_strings(self):
        result = parse_data_sources([1, 2, 3])
        assert result == ["1", "2", "3"]

    def test_parse_mixed_types_in_list(self):
        result = parse_data_sources(["web_search", 123, "confluence"])
        assert result == ["web_search", "123", "confluence"]

    def test_parse_unsupported_type_returns_none(self):
        assert parse_data_sources(123) is None
        assert parse_data_sources({"key": "value"}) is None
        assert parse_data_sources(object()) is None


class TestFilterToolsBySourcesBasic:
    def test_filter_none_sources_returns_all(self):
        tools = [MagicMock(name="tool1"), MagicMock(name="tool2")]
        result = filter_tools_by_sources(tools, None)
        assert result == tools

    def test_filter_empty_sources_keeps_unmapped_tools(self):
        web_tool = MagicMock()
        web_tool.name = "web_search_tool"
        knowledge_tool = MagicMock()
        knowledge_tool.name = "knowledge_search"
        calculator = MagicMock()
        calculator.name = "calculator"
        result = filter_tools_by_sources([web_tool, knowledge_tool, calculator], [])
        assert result == [calculator]


class TestFilterToolsBySourcesWebSearch:
    def test_filter_web_search_includes_web_tools(self):
        web_tool = MagicMock()
        web_tool.name = "web_search_tool"
        other_tool = MagicMock()
        other_tool.name = "other_tool"

        result = filter_tools_by_sources([web_tool, other_tool], ["web_search"])
        assert web_tool in result
        assert other_tool in result

    def test_filter_web_search_includes_search_tools(self):
        web_tool = MagicMock()
        web_tool.name = "tavily_search"
        knowledge_tool = MagicMock()
        knowledge_tool.name = "knowledge_search"

        result = filter_tools_by_sources([web_tool, knowledge_tool], ["web_search"])
        assert web_tool in result
        assert knowledge_tool not in result

    def test_filter_web_search_includes_tavily_tools(self):
        tavily_tool = MagicMock()
        tavily_tool.name = "tavily_search"

        result = filter_tools_by_sources([tavily_tool], ["web_search"])
        assert tavily_tool in result


class TestFilterToolsBySourcesKnowledgeLayer:
    def test_filter_knowledge_layer_includes_knowledge_tools(self):
        knowledge_tool = MagicMock()
        knowledge_tool.name = "knowledge_search"
        web_tool = MagicMock()
        web_tool.name = "web_search"

        result = filter_tools_by_sources([knowledge_tool, web_tool], ["knowledge_layer"])
        assert knowledge_tool in result
        assert web_tool not in result

    def test_filter_knowledge_layer_excludes_web_tools(self):
        tavily = MagicMock()
        tavily.name = "tavily_search"
        knowledge_tool = MagicMock()
        knowledge_tool.name = "knowledge_retrieval"

        result = filter_tools_by_sources([tavily, knowledge_tool], ["knowledge_layer"])
        assert knowledge_tool in result
        assert tavily not in result


class TestFilterToolsBySourcesMixed:
    def test_filter_web_and_knowledge_sources(self):
        web_tool = MagicMock()
        web_tool.name = "tavily_search"
        knowledge_tool = MagicMock()
        knowledge_tool.name = "knowledge_search"
        other_tool = MagicMock()
        other_tool.name = "calculator"

        result = filter_tools_by_sources([web_tool, knowledge_tool, other_tool], ["web_search", "knowledge_layer"])
        assert web_tool in result
        assert knowledge_tool in result
        assert other_tool in result

    def test_filter_all_three_source_types(self):
        web_tool = MagicMock()
        web_tool.name = "tavily_search"
        knowledge_tool = MagicMock()
        knowledge_tool.name = "knowledge_search"
        other_tool = MagicMock()
        other_tool.name = "calculator"

        result = filter_tools_by_sources(
            [web_tool, knowledge_tool, other_tool],
            ["web_search", "knowledge_layer", "confluence"],
        )
        assert web_tool in result
        assert knowledge_tool in result
        assert other_tool in result

    def test_filter_source_ids_are_case_insensitive(self):
        web_tool = MagicMock()
        web_tool.name = "web_search"

        result = filter_tools_by_sources([web_tool], ["WEB_SEARCH"])
        assert web_tool in result

    def test_filter_preserves_other_tools(self):
        calculator = MagicMock()
        calculator.name = "calculator"
        code_executor = MagicMock()
        code_executor.name = "code_executor"

        result = filter_tools_by_sources([calculator, code_executor], ["web_search"])
        assert calculator in result
        assert code_executor in result


class TestExtractMessagesAndSources:
    def test_extract_from_list_of_messages(self):
        messages = [HumanMessage(content="Hello")]
        result_messages, result_sources = extract_messages_and_sources(messages)

        assert result_messages == messages
        assert result_sources is None

    def test_extract_from_dict_with_messages(self):
        messages = [HumanMessage(content="Test query")]
        payload = {"messages": messages}

        result_messages, result_sources = extract_messages_and_sources(payload)
        assert result_messages == messages
        assert result_sources is None

    def test_extract_from_dict_with_data_sources(self):
        messages = [HumanMessage(content="Test")]
        payload = {
            "messages": messages,
            "data_sources": ["web_search", "confluence"],
        }

        result_messages, result_sources = extract_messages_and_sources(payload)
        assert result_messages == messages
        assert result_sources == ["web_search", "confluence"]

    def test_extract_from_nested_payload(self):
        messages = [HumanMessage(content="Nested test")]
        payload = {
            "payload": {
                "messages": messages,
                "data_sources": "web_search,sharepoint",
            }
        }

        result_messages, result_sources = extract_messages_and_sources(payload)
        assert result_messages == messages
        assert result_sources == ["web_search", "sharepoint"]

    def test_extract_invalid_payload_raises_error(self):
        with pytest.raises(ValueError, match="Invalid payload format"):
            extract_messages_and_sources("invalid")

    def test_extract_from_dict_without_messages_key_raises(self):
        with pytest.raises(ValueError, match="Invalid payload format"):
            extract_messages_and_sources({"other_key": "value"})


class TestFormatDataSourceTools:
    def test_format_web_search_source(self):
        result = format_data_source_tools(["web_search"])

        assert len(result) == 1
        assert result[0]["name"] == "Web Search"
        assert "web" in result[0]["description"].lower()

    def test_format_knowledge_layer_source(self):
        result = format_data_source_tools(["knowledge_layer"])

        assert len(result) == 1
        assert result[0]["name"] == "Knowledge Base"
        assert "document" in result[0]["description"].lower() or "file" in result[0]["description"].lower()

    def test_format_unknown_source_uses_title_case(self):
        result = format_data_source_tools(["confluence"])

        assert len(result) == 1
        assert result[0]["name"] == "Confluence"

    def test_format_multiple_sources(self):
        result = format_data_source_tools(["web_search", "knowledge_layer"])

        assert len(result) == 2
        names = [r["name"] for r in result]
        assert "Web Search" in names
        assert "Knowledge Base" in names

    def test_format_empty_list(self):
        result = format_data_source_tools([])
        assert len(result) == 0

    def test_format_underscore_replacement_for_unknown(self):
        result = format_data_source_tools(["google_drive"])

        assert len(result) == 1
        assert result[0]["name"] == "Google Drive"


class TestDefaultDataSources:
    def test_default_contains_web_search(self):
        assert "web_search" in DEFAULT_DATA_SOURCES

    def test_default_is_list(self):
        assert isinstance(DEFAULT_DATA_SOURCES, list)


class TestAllMappedToolsFilteredOut:
    def test_none_data_sources_returns_false(self):
        from agent.common.data_sources import all_mapped_tools_filtered_out

        web_tool = MagicMock()
        web_tool.name = "web_search_tool"
        assert all_mapped_tools_filtered_out([web_tool], [web_tool], None) is False

    def test_no_mapped_tools_in_input_returns_false(self):
        from agent.common.data_sources import all_mapped_tools_filtered_out

        calculator = MagicMock()
        calculator.name = "calculator"
        assert all_mapped_tools_filtered_out([calculator], [calculator], ["web_search"]) is False

    def test_empty_sources_drops_all_mapped_returns_true(self):
        from agent.common.data_sources import all_mapped_tools_filtered_out

        web_tool = MagicMock()
        web_tool.name = "web_search_tool"
        calculator = MagicMock()
        calculator.name = "calculator"
        assert all_mapped_tools_filtered_out([web_tool, calculator], [calculator], []) is True

    def test_unknown_source_drops_all_mapped_returns_true(self):
        from agent.common.data_sources import all_mapped_tools_filtered_out

        web_tool = MagicMock()
        web_tool.name = "web_search_tool"
        assert all_mapped_tools_filtered_out([web_tool], [], ["nonexistent_source"]) is True

    def test_some_mapped_tools_survive_returns_false(self):
        from agent.common.data_sources import all_mapped_tools_filtered_out

        web_tool = MagicMock()
        web_tool.name = "web_search_tool"
        knowledge_tool = MagicMock()
        knowledge_tool.name = "knowledge_search"
        assert all_mapped_tools_filtered_out([web_tool, knowledge_tool], [web_tool], ["web_search"]) is False
