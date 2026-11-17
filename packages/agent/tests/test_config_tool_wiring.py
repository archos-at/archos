from pathlib import Path

import pytest
import yaml

CONFIG = Path(__file__).resolve().parents[3] / "configs" / "config_oib_openrouter.yml"


@pytest.fixture(scope="module")
def config() -> dict:
    return yaml.safe_load(CONFIG.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def functions(config: dict) -> dict:
    return config["functions"]


def _tools(config: dict, agent: str) -> list[str]:
    return list(config["functions"][agent]["tools"])


@pytest.mark.parametrize("agent", ["shallow_research_agent", "deep_research_agent"])
def test_every_tool_an_agent_lists_is_declared(config: dict, functions: dict, agent: str):
    groups = config.get("function_groups") or {}
    missing = [name for name in _tools(config, agent) if name not in functions and name not in groups]
    assert missing == [], f"{agent} lists tools that no `functions:` or `function_groups:` entry declares: {missing}"


def test_the_chat_works_the_review_canvas_as_one_function_group(config: dict):
    assert config["function_groups"]["canvas"]["_type"] == "document_canvas"
    assert "canvas" in _tools(config, "shallow_research_agent")


@pytest.mark.parametrize("agent", ["shallow_research_agent", "deep_research_agent"])
def test_the_agent_can_see_a_plan_and_not_only_its_caption(config: dict, agent: str):
    assert "look" in _tools(config, agent)


def test_the_look_tool_is_declared_with_its_own_type(functions: dict):
    entry = functions.get("look")
    assert entry is not None, "look must be declared under `functions:`"
    assert entry["_type"] == "look"


def test_the_intake_agent_does_not_look(functions: dict):
    assert "look" not in functions["project_intake_agent"]["tools"]


def test_both_agents_reach_the_same_knowledge_and_ris_tools(config: dict):
    shallow = set(_tools(config, "shallow_research_agent"))
    deep = set(_tools(config, "deep_research_agent"))
    shared = {"knowledge_search", "look"}
    assert shared <= shallow
    assert shared <= deep
    assert "law_lookup" in shallow
    assert {"ris_search_tool", "ris_fetch_tool", "ris_catalog_lookup_tool"} <= deep


def test_the_chat_surface_reaches_the_law_through_one_tool(config: dict, functions: dict):
    entry = functions.get("law_lookup")
    assert entry is not None, "law_lookup must be declared under `functions:`"
    assert entry["_type"] == "law_lookup"
    assert entry["tool_name"] == "law_lookup"
    shallow = set(_tools(config, "shallow_research_agent"))
    assert shallow.isdisjoint({"ris_lookup_tool", "ris_search_tool", "ris_fetch_tool", "ris_catalog_lookup_tool"})


def test_every_law_tool_resolves_to_a_data_source(config: dict):
    sources = {source["id"]: source for source in config["functions"]["data_sources"]["sources"]}
    assert {"law_lookup", "ris_search_tool", "ris_fetch_tool", "ris_catalog_lookup_tool"} <= set(
        sources["ris"]["tools"]
    )


def test_the_deep_researcher_can_show_a_file_and_not_only_cite_it(config: dict):
    assert "surface_documents" in _tools(config, "deep_research_agent")


def test_the_locator_is_declared_and_bound_on_both_answering_agents(config: dict, functions: dict):
    entry = functions.get("read_passage")
    assert entry is not None, "read_passage must be declared under `functions:`"
    assert entry["_type"] == "read_passage"
    assert "read_passage" in _tools(config, "deep_research_agent")
    assert "read_passage" not in _tools(config, "shallow_research_agent")
    assert config["functions"]["shallow_research_agent"]["filesystem"] == "knowledge_search"


def test_the_deep_writer_learns_a_card_shape_without_a_round_trip(config: dict):
    assert "describe_card" not in _tools(config, "deep_research_agent")
    assert "describe_card" not in _tools(config, "shallow_research_agent")


def test_the_locator_shares_the_searchs_collection_scope(functions: dict):
    assert functions["read_passage"]["knowledge_search"] == "knowledge_search"


def test_the_locator_resolves_to_a_data_source(config: dict):
    sources = {entry["id"]: entry for entry in config["functions"]["data_sources"]["sources"]}
    assert "read_passage" in sources["knowledge_layer"]["tools"]
