"""The licence mark travels from what the knowledge layer read to the hit it renders (``agent.common.licensed_text``).

Search reads the mark off the point's payload; the estate (``read_file``, ``grep``) reads
it off the document row. Either way the hit carries it, so the renderer can keep the
text out of the transcript. ``grep``'s index of lines around a match prints a document's
own lines, so a licensed document gets none there: its passage above is the reference.
"""

from types import SimpleNamespace

from knowledge_layer.browse import FileRow
from knowledge_layer.estate import grep
from knowledge_layer.estate.render import _chunk_hit
from knowledge_layer.estate.render import _page_hit
from knowledge_layer.search import grounding_hits
from knowledge_layer.stored_pages import Page

from agent.knowledge.schema import ContentType

NORM_LINE = "| Zeile 07 | Absturzhöhe bis 23,7 m | Mindesthöhe 111 cm |"


def _chunk(**metadata) -> SimpleNamespace:
    return SimpleNamespace(
        file_name="oenorm_b_1600.pdf",
        metadata={"collection": "office-org-a", "shelf": "office_shelf", **metadata},
        page_number=12,
        content=NORM_LINE,
        score=0.9,
        content_type=ContentType.TEXT,
    )


def _hit(chunk):
    return grounding_hits.grounding_hit(chunk, resolved={}, resolved_titles={}, resolved_folders={}, ambiguous=set())


def test_a_search_hit_carries_the_points_licence():
    hit = _hit(_chunk(licence_class="licensed", quote_max_chars=300))
    assert hit.licence is not None and hit.licence.licensed and hit.licence.quote_max_chars == 300
    assert _hit(_chunk()).licence is None


def _file(**row) -> SimpleNamespace:
    return SimpleNamespace(
        row=FileRow(file_name="oenorm_b_1600.pdf", shelf="office_shelf", collection="office-org-a", **row),
        path="/office/oenorm_b_1600.pdf",
    )


def test_an_estate_page_and_chunk_carry_the_rows_licence():
    licensed = _file(licence_class="licensed")
    assert _page_hit(licensed, Page(number=12, text=NORM_LINE, source="text_layer"), budget=4000).licence.licensed
    chunk = SimpleNamespace(page_number=12, content=NORM_LINE, metadata={}, content_type=ContentType.TEXT)
    assert _chunk_hit(licensed, chunk).licence.licensed
    assert _page_hit(_file(), Page(number=12, text=NORM_LINE, source="text_layer"), budget=4000).licence is None


def test_grep_shows_a_licensed_documents_lines_as_a_reference_and_any_others_as_they_are():
    from agent.common.grounding_block import begin_grounding_capture
    from agent.common.grounding_block import end_grounding_capture
    from agent.common.licensed_text import UNATTESTED_NOTE

    query = grep.compile_query("Mindesthöhe", "exact", stemmed=False)

    def doc(file):
        return SimpleNamespace(file=file, texts={12: NORM_LINE}, path=file.path, pages=[12])

    token = begin_grounding_capture(licensed_text=True)
    try:
        unattested = grep._context_index([(doc(_file(licence_class="licensed")), 12)], query, 1)
        attested = grep._context_index(
            [(doc(_file(licence_class="licensed", ai_processing_attested=True)), 12)], query, 1
        )
    finally:
        end_grounding_capture(token)
    assert UNATTESTED_NOTE in unattested and "Mindesthöhe 111 cm" not in unattested
    assert "⟦licensed:lp_" in attested and "Mindesthöhe 111 cm" not in attested
    assert "Mindesthöhe 111 cm" in grep._context_index([(doc(_file()), 12)], query, 1)


def test_a_judge_reads_a_licensed_excerpt_as_a_reference_and_an_unattested_one_not_at_all():
    """The reranker and the requery judge send excerpts to a model: a licensed one goes as a reference."""
    from knowledge_layer.search import rerank

    from agent.common.grounding_block import begin_grounding_capture
    from agent.common.grounding_block import end_grounding_capture
    from agent.common.licensed_text import UNATTESTED_NOTE

    token = begin_grounding_capture(licensed_text=True)
    try:
        attested = rerank._build_user_prompt(
            "Brüstung", [_chunk(licence_class="licensed", ai_processing_attested=True)]
        )
        unattested = rerank._build_user_prompt("Brüstung", [_chunk(licence_class="licensed")])
        public = rerank._build_user_prompt("Brüstung", [_chunk()])
    finally:
        end_grounding_capture(token)

    assert "⟦licensed:lp_" in attested and NORM_LINE not in attested
    assert UNATTESTED_NOTE in unattested and NORM_LINE not in unattested
    assert NORM_LINE in public, "positive control: an unmarked excerpt is read as it was"
