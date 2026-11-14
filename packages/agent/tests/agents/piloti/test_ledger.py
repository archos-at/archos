"""The read-but-uncited channel: what the turn read beyond what it cited.

``ledger.assemble_result`` threads ``read_sources`` — one entry per retrieved
but uncited DOCUMENT (document key + lane/kind + page, NO prose) — onto the
finished state, where ``conversation.ANSWER_LIFTS`` and ``turn.response``
carry it to the wire for the "Gelesen, nicht zitiert" disclosure.
"""

from langchain_core.messages import AIMessage

from agent.agents.piloti.answer_pipeline import CitedSource
from agent.agents.piloti.answer_pipeline import FinalAnswer
from agent.agents.piloti.ledger import assemble_result
from agent.agents.piloti.ledger import read_but_uncited
from agent.citations.entries import SourceEntry


def _kb(
    citation_key: str,
    *,
    collection: str = "oib_knowledge",
    doc_class: str | None = "oib_guideline",
    tool_name: str = "knowledge_tool",
) -> SourceEntry:
    return SourceEntry(
        citation_key=citation_key,
        title="OIB-Richtlinie 2",
        source_type="knowledge_layer",
        tool_name=tool_name,
        collection=collection,
        shelf="base",
        doc_class=doc_class,
        chunk_text="Die Fluchtweglänge darf 40 m nicht überschreiten.",
    )


def _cited(entry: SourceEntry, number: int = 1) -> CitedSource:
    return CitedSource(entry=entry, number=number)


class TestReadButUncited:
    def test_a_cited_document_never_reappears_as_read(self):
        """The same document cited at p.12 is not "read" via its p.30 passage."""
        turn_sources = [_kb("oib-rl_2.pdf, p.12"), _kb("oib-rl_2.pdf, p.30")]
        cited = [_cited(_kb("oib-rl_2.pdf, p.12"))]
        assert read_but_uncited(turn_sources, cited) is None

    def test_an_uncited_document_is_listed_once_per_document(self):
        """Two pages of one uncited document are one disclosure entry."""
        wire = read_but_uncited([_kb("oib-rl_2.pdf, p.12"), _kb("oib-rl_2.pdf, p.30")], [])
        assert wire is not None
        assert len(wire) == 1
        assert wire[0]["page"] == 12

    def test_two_documents_are_two_entries(self):
        wire = read_but_uncited([_kb("oib-rl_2.pdf, p.12"), _kb("oib-rl_3.pdf, p.4")], [])
        assert wire is not None
        assert len(wire) == 2

    def test_same_filename_in_two_collections_is_two_documents(self):
        """The document identity is (collection, filename): a project Plan.pdf
        and an Archiv Plan.pdf are two documents, not one."""
        wire = read_but_uncited(
            [
                _kb("Plan.pdf, p.1", collection="proj_abc"),
                _kb("Plan.pdf, p.1", collection="archiv_all"),
            ],
            [],
        )
        assert wire is not None
        assert len(wire) == 2

    def test_a_bare_tool_result_identifies_nothing_and_is_dropped(self):
        """A source with neither citation key nor URL cannot be opened from a
        chip, so it must not become one."""
        bare = SourceEntry(source_type="tool_result", tool_name="some_tool")
        assert read_but_uncited([bare], []) is None

    def test_nothing_uncited_is_absent_not_empty(self):
        assert read_but_uncited([], []) is None

    def test_the_wire_carries_identity_and_placement_but_no_prose(self):
        wire = read_but_uncited([_kb("oib-rl_2.pdf, p.12")], [])
        assert wire is not None
        entry = wire[0]
        assert entry["document_id"] == "doc:oib_knowledge:oib-rl_2.pdf"
        assert entry["file_name"] == "oib-rl_2.pdf"
        assert entry["page"] == 12
        assert entry["kind"] == "building_law"
        assert entry["lane"].startswith("building_law")
        for prose in ("snippet", "content", "score", "clause", "number", "binding_status"):
            assert prose not in entry, f"{prose} must not travel on the read-but-uncited channel"

    def test_a_web_source_keeps_its_url_identity(self):
        web = SourceEntry(
            url="https://example.gv.at/hinweis",
            title="Hinweis",
            source_type="generic",
            tool_name="web_search_tool",
        )
        wire = read_but_uncited([web], [])
        assert wire is not None
        assert wire[0]["url"] == "https://example.gv.at/hinweis"


class TestAssembleResultThreadsReadSources:
    def _final(self, **fields) -> FinalAnswer:
        return FinalAnswer(
            messages=[AIMessage(content="Die Antwort.")],
            answered=False,
            content="Die Antwort.",
            **fields,
        )

    def test_read_sources_reach_the_finished_state(self):
        state = assemble_result(
            {},
            self._final(),
            turn_sources=[_kb("oib-rl_2.pdf, p.12")],
            turn_measurements=[],
        )
        assert state.read_sources is not None
        assert state.read_sources[0]["file_name"] == "oib-rl_2.pdf"

    def test_a_fully_cited_turn_carries_no_field_at_all(self):
        entry = _kb("oib-rl_2.pdf, p.12")
        state = assemble_result(
            {},
            self._final(cited=(_cited(entry),)),
            turn_sources=[entry],
            turn_measurements=[],
        )
        assert state.read_sources is None


class TestAClaimWithoutRecordsCapsLikeUnsettledLaw:
    """Citations spec G27: law stated from the web caps the answer, whatever the gate (``common/binding_claims``)."""

    MIRROR = SourceEntry(
        url="https://www.jusline.at/gesetz/wgarg_2008/paragraf/50a",
        title="§ 50a WGarG 2008 (Wiener Garagengesetz 2008) - JUSLINE Österreich",
        source_type="generic",
        tool_name="web_search_tool",
    )

    def _state(self, content: str, **fields):
        final = FinalAnswer(messages=[AIMessage(content=content)], answered=True, content=content, **fields)
        return assemble_result({}, final, turn_sources=[self.MIRROR], turn_measurements=[])

    def test_law_cited_from_a_mirror_is_unsettled_and_scored(self, monkeypatch):
        from agent.observability import langfuse_scores

        emitted: list = []
        monkeypatch.setattr(langfuse_scores, "emit_scores", lambda scores, **_: emitted.extend(scores) or len(scores))
        state = self._state(
            "§ 50a Wiener Garagengesetz 2008 sieht je nach Zone 70 % vor [1].", cited=(_cited(self.MIRROR, 1),)
        )
        assert state.answer_law_unsettled is True
        assert {score.name: score.value for score in emitted} == {
            "binding-claim-without-records": 1.0,
            "law-cited-from-web": 1.0,
        }

    def test_a_web_page_cited_beside_the_records_for_a_held_work_is_scored(self, monkeypatch):
        """The Wien answer of 2026-11-12: the binding day of a held work cited from a newsletter as well."""
        from agent.common import web_sources
        from agent.observability import langfuse_scores

        emitted: list = []
        monkeypatch.setattr(langfuse_scores, "emit_scores", lambda scores, **_: emitted.extend(scores) or len(scores))
        work = web_sources.HeldWork(
            designation="OIB-Richtlinie 4", where="knowledge_base", names=web_sources._names("OIB-Richtlinie 4")
        )
        monkeypatch.setattr(web_sources, "held_works", lambda: (work,))
        monkeypatch.setattr("agent.common.binding_claims.held_works", lambda: (work,))
        ris = SourceEntry(citation_key="Wiener Bautechnikverordnung 2023, § 5", source_type="knowledge_layer")
        page = SourceEntry(url="https://chamber.example.org/newsletter-2302", title="Newsletter", source_type="generic")
        content = "Es gilt die OIB-Richtlinie 4, Ausgabe Mai 2023, seit 23. Februar 2024 [1]; so auch die Kammer [2]."
        self._state(content, cited=(_cited(ris, 1), _cited(page, 2)))
        assert {score.name: score.value for score in emitted}["law-cited-from-web"] == 1.0

    def test_an_answer_that_states_no_law_from_the_web_is_untouched(self, monkeypatch):
        from agent.observability import langfuse_scores

        emitted: list = []
        monkeypatch.setattr(langfuse_scores, "emit_scores", lambda scores, **_: emitted.extend(scores) or len(scores))
        page = SourceEntry(url="https://blog.example.org/a", title="Ein Artikel", source_type="generic")
        state = self._state("Der Hersteller empfiehlt eine Wartung [1].", cited=(_cited(page, 1),))
        assert state.answer_law_unsettled is False
        assert {score.name: score.value for score in emitted} == {
            "binding-claim-without-records": 0.0,
            "law-cited-from-web": 0.0,
        }
