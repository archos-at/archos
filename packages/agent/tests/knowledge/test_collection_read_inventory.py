from __future__ import annotations

import importlib.metadata
from pathlib import Path

import pytest

from nat.cli.type_registry import GlobalTypeRegistry

_ROOT = Path(__file__).resolve().parents[4]

TOOLS: dict[str, tuple[str, str]] = {
    "knowledge_retrieval": (
        "reports",
        "tests/knowledge_layer_tests/test_restricted_reads.py::test_exact_search_reports_every_collection_its_match_table_names",
    ),
    "read_passage": (
        "reports",
        "tests/knowledge_layer_tests/test_restricted_reads.py::test_read_passage_reports_a_restricted_passage_and_it_is_admitted",
    ),
    "look": (
        "reports",
        "packages/agent/tests/tools/look/test_register.py::test_a_look_reports_the_collection_it_read",
    ),
    "project_lookup": (
        "reports",
        "packages/agent/tests/tools/cross_project/test_project_lookup.py::test_project_lookup_admits_what_the_bff_handed_out_and_shuts_the_turns_doors",
    ),
    "dxf_measure": (
        "reports",
        "packages/agent/tests/tools/drawings/test_dxf_measure.py::test_a_read_reports_its_collection_so_a_restricted_folder_is_admitted",
    ),
    "list_files": (
        "lists_nothing_restricted",
        "tests/knowledge_layer_tests/test_restricted_reads.py::test_list_files_never_lists_a_restricted_file_when_the_inventory_failed",
    ),
    "surface_documents": (
        "lists_nothing_restricted",
        "packages/agent/tests/cards/test_surface_documents.py::test_a_restricted_folders_collection_is_never_listed",
    ),
    "propose_file_change": (
        "lists_nothing_restricted",
        "resolves names only against the turn's inventory rows, which conversation_register loads "
        "from without_restricted(scope)",
    ),
    "ask_user": ("no_collection_content", "asks the reader; returns the reader's answer"),
    "emit_card": ("no_collection_content", "pushes a card the model composed from what it already read"),
    "describe_card": ("no_collection_content", "returns a card type's schema"),
    "file_draft": ("no_collection_content", "files the conversation's own draft; returns the filing outcome"),
    "create_task": ("no_collection_content", "queues work; returns the task it created"),
    "show_in_viewer": (
        "no_collection_content",
        "packages/agent/tests/tools/viewer/test_register.py::TestADocumentThePersonMayNotSee",
    ),
    "document_canvas": (
        "no_collection_content",
        "returns Anmerkungen and room presence the BFF admitted for the turn; no page content of a collection",
    ),
    "workspace_tools": (
        "no_collection_content",
        "returns workspace records and proposals, not passages; the BFF catalog owns the restricted-folder gate",
    ),
    "project_memory_remember": (
        "no_collection_content",
        "writes a note; restricted memory is served into a prompt only after the BFF admits its folders",
    ),
    "ifc_query": (
        "no_collection_content",
        "BIM data is keyed by project, and IFC models are refused in "
        "restricted folders (lib/projects/ifc-folder-guard.ts, ADR-0087)",
    ),
    "ifc_measure": ("no_collection_content", "same model data as ifc_query"),
    "data_source_registry": ("no_collection_content", "configuration only"),
    "deep_research_skills": ("no_collection_content", "configuration only"),
    "deep_research_sandbox": ("no_collection_content", "configuration only"),
    "ris_search": ("external", "the Austrian legal information system"),
    "ris_catalog_lookup": ("external", "the RIS catalog"),
    "ris_fetch_document": ("external", "the Austrian legal information system"),
    "ris_lookup": ("external", "the Austrian legal information system"),
    "law_lookup": ("external", "a public law source, read through its source record"),
    "tavily_web_search": ("external", "the web"),
    "research_agent": ("agent", "Piloti; admits every tool round in its tools node"),
    "research_workflow": ("agent", "wraps research_agent"),
    "chat_deepresearcher_agent": ("agent", "the chat workflow around Piloti"),
    "deep_research_agent": ("agent", "a restricted collection is never signed into a run's scope (ADR-0087)"),
    "deep_research_workflow": ("agent", "wraps deep_research_agent"),
    "project_intake_agent": (
        "agent",
        "packages/agent/tests/agents/intake/test_reading.py::test_a_restricted_folders_collection_is_never_read",
    ),
}

_KINDS = {"reports", "lists_nothing_restricted", "no_collection_content", "external", "agent"}


def _registered_tool_types() -> set[str]:
    for entry_point in importlib.metadata.entry_points(group="nat.plugins"):
        entry_point.load()
    registry = GlobalTypeRegistry.get()
    infos = [*registry.get_registered_functions(), *registry.get_registered_function_groups()]
    return {
        info.config_type.static_type()
        for info in infos
        if not info.config_type.static_type().startswith("test_fixture_")
    }


def test_every_registered_tool_is_classified():
    registered = _registered_tool_types()

    unclassified = sorted(registered - TOOLS.keys())
    assert not unclassified, (
        f"{unclassified}: say how each keeps a restricted folder's content from the model unadmitted "
        "(see this module's docstring), and name the test that pins it"
    )
    assert not sorted(TOOLS.keys() - registered), "a classified tool is no longer registered: drop its row"


@pytest.mark.parametrize("tool", sorted(TOOLS))
def test_every_classification_names_a_kind_and_its_proof(tool):
    kind, proof = TOOLS[tool]
    assert kind in _KINDS
    if kind not in ("reports", "lists_nothing_restricted") or "::" not in proof:
        assert proof.strip(), "say why nothing needs to be pinned"
        return
    path, test_name = proof.split("::")
    source = (_ROOT / path).read_text(encoding="utf-8")
    assert f"def {test_name}(" in source, f"{proof} does not exist"


def test_a_tool_that_reports_is_pinned_by_a_test_not_by_a_sentence():
    for tool, (kind, proof) in TOOLS.items():
        if kind == "reports":
            assert "::" in proof, f"{tool} reports what it read: name the test that proves it"
