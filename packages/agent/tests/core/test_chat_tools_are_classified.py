from __future__ import annotations

from pathlib import Path

import yaml

CONFIG = Path(__file__).resolve().parents[4] / "configs" / "config_oib_openrouter.yml"

PASSAGE_TOOLS = {"knowledge_search", "read_passage", "law_lookup", "project_lookup"}

NOT_SOURCES = {
    "remember": "writes project memory; its confirmation is not evidence",
    "surface_documents": "shows documents as a card; the documents are read through knowledge_search",
    "propose_file_change": "proposes an edit for a person to accept",
    "file_draft": "files a draft from the working directory",
    "execute": "runs code the answer wrote; its values and files are the answer's own work, never evidence",
    "create_task": "hands work over; the confirmation is not evidence",
    "canvas": (
        "the review canvas (a function group): reads and proposes marks, points; a mark is a person's note, "
        "never a passage a reader cites"
    ),
    "workspace": (
        "The agent's own MCP server (a function group): finds and runs workspace operations as the asker, a write "
        "comes back as a proposal; its results are records of the office's own state, not passages a reader cites. "
        "They ground sentences through their own channel (common/workspace_records, ADR-0125), never the registry"
    ),
    "ask_user": "asks the reader a question",
    "ifc_query": "answers from the building model through cards, not passages",
    "ifc_measure": "measures in the building model; its numbers arrive through cards",
    "dxf_measure": "measures a DXF drawing's geometry; its answers are records the answer check reads, not passages",
    "look": "shows a page, a region of it or an image of a document already searchable; an image is no passage",
    "show_in_viewer": "proposes to open a place in the asker's viewer (ADR-0144); its confirmation is not evidence",
}


def _config() -> dict:
    return yaml.safe_load(CONFIG.read_text(encoding="utf-8"))


def _source_tools(config: dict) -> set[str]:
    sources = config["functions"]["data_sources"]["sources"]
    return {tool for source in sources for tool in source.get("tools") or []}


def _chat_tools(config: dict) -> list[str]:
    return list(config["functions"]["shallow_research_agent"]["tools"])


def test_every_tool_that_returns_passages_is_a_data_source():
    missing = PASSAGE_TOOLS - _source_tools(_config())

    assert not missing, (
        f"These tools return citable passages but are no data source, so nothing they find is cited: {missing}"
    )


def test_every_chat_tool_is_a_data_source_or_knowingly_not_one():
    config = _config()
    sources = _source_tools(config)
    unclassified = [tool for tool in _chat_tools(config) if tool not in sources and tool not in NOT_SOURCES]

    assert not unclassified, (
        f"Classify {unclassified}: add each to a source in `data_sources` (its results become citable) "
        "or to NOT_SOURCES here with the reason it is never evidence."
    )


def test_nothing_is_both():
    both = _source_tools(_config()) & set(NOT_SOURCES)

    assert not both, f"{both} cannot be a data source and declared not one"


def test_every_record_tool_is_a_chat_data_source():
    from agent.core.answer_pipeline import RECORD_TOOLS

    config = _config()
    stale = RECORD_TOOLS - (_source_tools(config) & set(_chat_tools(config)))

    assert not stale, f"{stale} in RECORD_TOOLS is no data-source tool the chat binds"
