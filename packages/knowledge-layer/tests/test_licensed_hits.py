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


def test_a_search_hit_states_the_edition_its_point_was_marked_with():
    """What a citation's role and edition are resolved by: the id the ingest wrote on the point, never its file name."""
    assert _hit(_chunk(knowledge_edition_id="edition:guideline-2-2021")).edition_id == "edition:guideline-2-2021"
    assert _hit(_chunk()).edition_id is None


def test_an_office_or_project_hit_states_what_its_name_says_about_its_revision():
    """The index and the day ride the record (never a header line), so a citation can name the Fassung it read."""

    def named(file_name: str, shelf: str = "project"):
        chunk = _chunk()
        chunk.file_name, chunk.metadata = file_name, {"collection": "proj_a", "shelf": shelf}
        return _hit(chunk).revision

    assert named("EG_Grundriss_Index_C_2026-08-14.pdf").model_dump() == {"index": "C", "date": "2026-08-14"}
    assert named("Brandschutzkonzept_Stand_2026-09-02.pdf", "office_shelf").model_dump() == {
        "index": None,
        "date": "2026-09-02",
    }
    assert named("Raumprogramm.pdf") is None
    # The base corpus's editions are named by the knowledge records, never guessed from a file name.
    assert named("guideline_2_2026-08-14.pdf", "base") is None


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


def test_a_licensed_page_is_read_again_from_its_points_and_its_page_text(monkeypatch):
    """What ``licensed_recall`` checks a later turn's reference against: the page's points and its page text."""
    from knowledge_layer import stored_pages
    from knowledge_layer import vector_store
    from knowledge_layer.estate import render
    from knowledge_layer.stored_pages import PageText

    from agent.common.licensed_text import LicenceTerms

    asked = {}

    class Store:
        def scroll(self, collection, filters, *, limit, fields):
            asked.update(collection=collection, filters=filters, fields=fields)
            return [SimpleNamespace(payload={vector_store.TEXT_FIELD: NORM_LINE})]

    async def read_pages(collection, file_name, *, wanted=None):
        return PageText(
            pages=[Page(number=12, text="page twelve", source="text_layer")], origin="stored", page_count=40
        )

    attested = LicenceTerms(licence_class="licensed", ai_processing=True)
    monkeypatch.setattr(render, "document_licence", lambda collection, file_name: attested)
    monkeypatch.setattr(vector_store, "get_store", Store)
    monkeypatch.setattr(stored_pages, "read_pages", read_pages)

    terms, texts = render.licensed_passage_sources("office-org-a", "oenorm_b_1600.pdf", 12)

    assert terms == attested and texts == [NORM_LINE, "page twelve"]
    assert asked["filters"] == {"file_name": "oenorm_b_1600.pdf", "page_label": "12"}

    monkeypatch.setattr(
        render, "document_licence", lambda collection, file_name: LicenceTerms(licence_class="licensed")
    )
    assert render.licensed_passage_sources("office-org-a", "oenorm_b_1600.pdf", 12)[1] == [], "unattested: no text"


def test_a_document_with_no_point_answers_what_its_caller_says_an_unindexed_one_is(monkeypatch):
    """The office layer indexes no unconfirmed or unattested copy: a caller that may hold one asks closed."""
    from knowledge_layer import vector_store
    from knowledge_layer.estate import document_licence

    class Empty:
        def scroll(self, *_args, **_kwargs):
            return iter(())

    monkeypatch.setenv("QDRANT_URL", "http://qdrant.test:6333")
    monkeypatch.setattr(vector_store, "get_store", Empty)

    assert document_licence("office-org-a", "norm.pdf") is None
    assert document_licence("office-org-a", "norm.pdf", unindexed="closed") == "closed"
