from __future__ import annotations

import pytest
from knowledge_layer.browse import confirmed_revision_marks
from knowledge_layer.browse import file_rows
from knowledge_layer.browse import render_listing
from knowledge_layer.browse import render_revisions
from knowledge_layer.browse import select_files

from agent.knowledge.schema import AvailableDocument

PLAN = "Plan.pdf"


def _doc(name: str, document_id: str, folder: str, **extra) -> AvailableDocument:
    return AvailableDocument(
        file_name=name,
        document_id=document_id,
        folder_path=folder,
        collection="proj_1",
        shelf="project",
        summary=f"Zusammenfassung von {name} in {folder}",
        **extra,
    )


def _namesakes(**eg) -> list:
    return file_rows(
        [
            _doc(PLAN, "doc-eg", "Einreichung", **eg),
            _doc(PLAN, "doc-og", "Ausführung"),
            _doc("Plan Index B.pdf", "doc-eg-b", "Einreichung"),
        ]
    )


def test_two_documents_that_share_a_name_are_two_rows():
    rows = _namesakes()

    assert [(row.file_name, row.document_id, row.folder) for row in rows[:2]] == [
        (PLAN, "doc-eg", "Einreichung"),
        (PLAN, "doc-og", "Ausführung"),
    ]
    assert rows[0].key != rows[1].key


def test_a_confirmed_replacement_marks_only_the_namesake_it_names_by_id():
    rows = _namesakes(superseded_by="Plan Index B.pdf", superseded_by_id="doc-eg-b")

    marks = confirmed_revision_marks(rows)

    assert marks[rows[0].key] == "replaced by Plan Index B.pdf (confirmed)"
    assert rows[1].key not in marks
    assert marks[rows[2].key] == f"replaces {PLAN} (confirmed)"


def test_a_link_by_a_name_two_documents_carry_marks_nothing():
    rows = file_rows(
        [
            _doc("Alt.pdf", "doc-alt", "Archiv", superseded_by=PLAN),
            _doc(PLAN, "doc-eg", "Einreichung"),
            _doc(PLAN, "doc-og", "Ausführung"),
        ]
    )

    assert confirmed_revision_marks(rows) == {}


def test_the_listing_shows_both_namesakes_with_their_own_folder():
    text = render_listing(select_files(_namesakes(), shelf="project"))

    assert text.count(f"- {PLAN}") == 2


def test_the_revisions_of_one_namesake_never_include_the_other():
    rows = _namesakes(superseded_by="Plan Index B.pdf", superseded_by_id="doc-eg-b")

    text = render_revisions(rows, "Plan Index B.pdf")

    assert "Ausführung" not in text
    assert "2 files" in text


def test_the_listing_gives_each_namesake_its_document_id():
    text = render_listing(select_files(_namesakes(), shelf="project"))

    assert "Folder: Einreichung · Document-ID: doc-eg" in text
    assert "Folder: Ausführung · Document-ID: doc-og" in text
    assert "Document-ID: doc-eg-b" not in text


def test_the_revisions_of_a_shared_name_are_refused_with_each_in_a_form_that_reaches_it():
    text = render_revisions(_namesakes(), PLAN)

    assert "matches 2 different documents" in text
    assert "Einreichung/Plan.pdf (Document-ID: doc-eg)" in text
    assert "Ausführung/Plan.pdf (Document-ID: doc-og)" in text


@pytest.mark.parametrize(
    ("wanted", "folder"),
    [("Einreichung/Plan.pdf", None), ("doc-eg", None), ("doc:id:doc-eg", None), (PLAN, "Einreichung")],
)
def test_the_revisions_of_one_namesake_are_reached_by_folder_or_id(wanted, folder):
    rows = _namesakes(superseded_by="Plan Index B.pdf", superseded_by_id="doc-eg-b")

    text = render_revisions(rows, wanted, folder=folder)

    assert "2 files" in text
    assert "Plan Index B.pdf" in text
    assert "matches" not in text


def test_a_folder_that_holds_neither_namesake_is_said_so():
    text = render_revisions(_namesakes(), PLAN, folder="Bestand")

    assert text.startswith('No file in folder "Bestand" is named or contains "Plan.pdf"')
    assert "Einreichung/Plan.pdf (Document-ID: doc-eg)" in text


def test_a_folder_that_holds_both_namesakes_through_a_subfolder_says_how_to_tell_them_apart():
    rows = file_rows([_doc(PLAN, "doc-a", "A"), _doc(PLAN, "doc-sub", "A/Sub")])

    text = render_revisions(rows, PLAN, folder="A")

    assert "matches 2 different documents" in text
    assert "A/Plan.pdf (Document-ID: doc-a)" in text
    assert "A/Sub/Plan.pdf (Document-ID: doc-sub)" in text
    assert '`folder="A"` includes its subfolders' in text


def test_the_listed_form_of_a_namesake_in_a_subfolder_reaches_it():
    rows = file_rows([_doc(PLAN, "doc-a", "A"), _doc(PLAN, "doc-sub", "A/Sub")])

    text = render_revisions(rows, "A/Sub/Plan.pdf", folder="A")

    assert "only this one Fassung" in text
    assert "matches" not in text
