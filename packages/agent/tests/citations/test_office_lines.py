from __future__ import annotations

import pytest

from agent.citations.entries import SourceEntry
from agent.citations.office_lines import set_turn_office_labels
from agent.citations.wire import source_entry_to_wire
from agent.common.knowledge_context import set_turn_knowledge_context

LABEL = {
    "editionId": "edition_office_1",
    "workId": "work_office_1",
    "documentId": "doc-1",
    "fileName": "norm.pdf",
    "kind": "commentary",
    "designation": None,
    "title": "Building act, a commentary",
    "editionLabel": "7th edition 2019",
    "holder": "office",
    "role": "interpretation",
    "lastCheckedOn": "2026-09-12",
    "checkOverdue": False,
    "freshness": "current",
    "textUse": "used",
    "directive": None,
}


@pytest.fixture(autouse=True)
def _bound():
    set_turn_knowledge_context(None)
    set_turn_office_labels((LABEL,))
    yield
    set_turn_office_labels(None)


def _entry(edition_id: str | None, file_name: str = "norm.pdf") -> SourceEntry:
    return SourceEntry(
        title="Building act, a commentary",
        citation_key=f"{file_name}, p.3",
        collection="archiv_org-1",
        shelf="office_shelf",
        edition_id=edition_id,
        chunk_text="A passage.",
    )


def test_a_passage_of_an_office_copy_states_its_edition_role_and_check() -> None:
    wire = source_entry_to_wire(_entry("edition_office_1"))
    assert {
        key: wire.get(key) for key in ("role", "work_id", "edition_id", "edition_label", "last_checked_at", "freshness")
    } == {
        "role": "interpretation",
        "work_id": "work_office_1",
        "edition_id": "edition_office_1",
        "edition_label": "7th edition 2019",
        "last_checked_at": "2026-09-12",
        "freshness": "current",
    }
    assert wire["binding_status"] == "unknown"


def test_a_standard_states_no_role_of_its_own() -> None:
    set_turn_office_labels(
        ({**LABEL, "kind": "technical_standard", "role": "requirement_source", "freshness": "check_due"},)
    )
    wire = source_entry_to_wire(_entry("edition_office_1"))
    assert "role" not in wire
    assert wire["freshness"] == "check_due"


def test_the_file_name_finds_nothing_and_the_next_turn_carries_none() -> None:
    assert "edition_label" not in source_entry_to_wire(_entry(None, file_name="norm.pdf"))
    set_turn_office_labels(None)
    assert "edition_label" not in source_entry_to_wire(_entry("edition_office_1"))


def test_a_norm_names_the_shelf_it_came_from_whatever_its_class() -> None:
    office = source_entry_to_wire(
        SourceEntry(
            title="OENORM_B_1600.pdf",
            citation_key="OENORM_B_1600.pdf, p.3",
            collection="archiv_org-1",
            shelf="office_shelf",
            edition_id="edition_office_1",
            doc_class="external_standard",
            source_type="knowledge_layer",
            chunk_text="A passage.",
        )
    )
    project = source_entry_to_wire(
        SourceEntry(
            title="OENORM_B_1600.pdf",
            citation_key="OENORM_B_1600.pdf, p.3",
            collection="proj_p1",
            shelf="project",
            doc_class="external_standard",
            source_type="knowledge_layer",
            chunk_text="A passage.",
        )
    )
    assert (office["kind"], office["lane_label"], office["edition_id"]) == ("office", "Büroablage", "edition_office_1")
    assert (project["kind"], project["lane_label"]) == ("project", "Projektwissen")
    assert "edition_id" not in project
