from __future__ import annotations

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
