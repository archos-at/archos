from __future__ import annotations

import re

import pytest

from agent.common import retrieval_status
from agent.common import status_keys
from agent.common import tool_calls
from agent.common import turn_notices
from agent.common import turn_status
from agent.common.wire_v2 import StatusStep
from agent.skills.events import ALL_SKILL_KEYS


@pytest.fixture(autouse=True)
def _reset_retrieval_round():
    yield
    turn_status._retrieval_round.set(None)


@pytest.fixture
def steps(emitted):
    return emitted


def _live(emitted) -> list:
    return [step for step in emitted.steps if step.kind == "retrieval" or getattr(step, "channel", None) == "live"]


def _technical(emitted) -> list:
    return [step for step in emitted.steps if step.kind == "status" and step.channel == turn_status.CHANNEL_TECHNICAL]


def _started(emitted, prefix: str) -> list[str]:
    return [step.id for step in emitted.steps if step.id.startswith(prefix)]


class TestOutsideAGraph:
    def test_emission_outside_a_graph_run_is_silent(self) -> None:
        retrieval_status.emit_citation_check()
        retrieval_status.emit_escalation("weil")


class TestDocumentsLoading:
    def test_a_shelf_of_the_readers_own_is_named(self, steps) -> None:
        step = retrieval_status.documents_loading_step(["office_shelf"])
        assert step == StatusStep(
            id="status:documents",
            slot="documents",
            key="status.documents.officeShelf",
            detail={"shelves": ["office_shelf"]},
        )
        assert steps == []

    def test_several_shelves_collapse_into_one_line(self) -> None:
        assert retrieval_status.documents_loading_step(["office_shelf", "project"]).key == "status.documents.several"

    def test_the_base_corpus_alone_says_nothing(self) -> None:
        assert retrieval_status.documents_loading_step(["base"]) is None
        assert retrieval_status.documents_loading_step([]) is None
        assert retrieval_status.documents_loading_step(None) is None


class TestRetrieval:
    def test_it_names_the_corpus_by_ID_and_quotes_the_question(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [{"name": "knowledge_search_tool", "args": {"query": "Fluchtweglänge GK4"}}],
            round_index=0,
        )
        payload = _live(steps)[0]
        assert payload.key == "status.retrieval.withQuery"
        assert payload.values == {"corpus": "knowledge", "query": "Fluchtweglänge GK4"}

    def test_a_group_qualified_tool_name_still_resolves(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [{"name": "sources__ris_search_tool", "args": {"query": "OIB 2"}}],
            round_index=0,
        )
        assert _live(steps)[0].values["corpus"] == "ris"

    def test_a_lookup_in_other_projects_says_where_it_went(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [{"name": "project_lookup", "args": {"action": "search", "query": "Traufe Holzbau"}}],
            round_index=0,
        )
        assert _live(steps)[0].values == {"corpus": "otherProjects", "query": "Traufe Holzbau"}

    @pytest.mark.parametrize(
        "args",
        [
            {"action": "brief", "project_id": "b0000000-0000-4000-8000-000000000002"},
            {"action": "find", "scope": "closed"},
        ],
    )
    def test_a_lookup_without_a_query_never_quotes_its_action_or_id(self, steps, args) -> None:
        retrieval_status.emit_retrieval([{"name": "project_lookup", "args": args}], round_index=0)
        payload = _live(steps)[0]
        assert payload.key == "status.retrieval.plain"
        assert payload.values == {"corpus": "otherProjects"}

    @pytest.mark.parametrize(
        "call",
        [
            {"name": "ls", "args": {"path": "/project/03 Einreichung/"}},
            {"name": "read_file", "args": {"file_path": "/project/Plan.pdf.md"}},
        ],
    )
    def test_a_filesystem_address_is_never_quoted_as_a_query(self, steps, call) -> None:
        retrieval_status.emit_retrieval([call], round_index=0)
        payload = _live(steps)[0]
        assert "query" not in payload.values
        assert "/project/" not in " ".join(payload.values.values())

    def test_a_search_with_no_query_uses_the_other_template(self, steps) -> None:
        retrieval_status.emit_retrieval([{"name": "web_search_tool", "args": {}}], round_index=0)
        payload = _live(steps)[0]
        assert payload.key == "status.retrieval.plain"
        assert payload.values == {"corpus": "web"}

    def test_the_quoted_query_never_outgrows_its_slot(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [{"name": "knowledge_search_tool", "args": {"query": "Frage " * 40}}],
            round_index=0,
        )
        assert len(_live(steps)[0].values["query"]) <= turn_status.MAX_QUERY_CHARS

    def test_a_parallel_batch_is_ONE_line(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [
                {"name": "knowledge_search_tool", "args": {"query": "Fluchtweglänge GK4"}},
                {"name": "ris_search_tool", "args": {"query": "Fluchtweglänge GK4"}},
                {"name": "web_search_tool", "args": {"query": "Fluchtweglänge GK4"}},
            ],
            round_index=0,
        )
        assert len(_live(steps)) == 1
        assert _live(steps)[0].values["corpus"] == "knowledge,ris,web"

    def test_successive_rounds_do_not_collapse_into_one_step(self, steps) -> None:
        retrieval_status.emit_retrieval([{"name": "ris_search_tool", "args": {"query": "a"}}], round_index=0)
        retrieval_status.emit_retrieval([{"name": "ris_search_tool", "args": {"query": "b"}}], round_index=1)
        assert _started(steps, "status:retrieval") == ["status:retrieval:0", "status:retrieval:1"]

    def test_opening_a_named_passage_says_WHAT_is_being_read(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [{"name": "read_passage", "args": {"document": "OIB-Richtlinie 2", "clause": "3.5.2"}}],
            round_index=1,
        )
        payload = _live(steps)[0]
        assert payload.key == "status.retrieval.clause"
        assert payload.values == {"document": "OIB-Richtlinie 2", "clause": "3.5.2"}
        assert payload.tools == ["read_passage"]

    def test_a_page_locator_uses_its_own_key(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [{"name": "read_passage", "args": {"document": "Brandschutzkonzept.pdf", "page": 12}}],
            round_index=1,
        )
        payload = _live(steps)[0]
        assert payload.key == "status.retrieval.page"
        assert payload.values == {"document": "Brandschutzkonzept.pdf", "page": "12"}

    def test_the_locator_is_a_retrieval_round_of_the_spine(self, steps) -> None:
        assert tool_calls.is_retrieval_round([{"name": "read_passage", "args": {"document": "x", "clause": "1"}}])
        assert (
            retrieval_status.emit_retrieval(
                [{"name": "read_passage", "args": {"document": "x", "clause": "1"}}], round_index=3
            )
            is True
        )
        assert turn_status.current_retrieval_round() == 3

    def test_a_document_name_never_outgrows_its_slot(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [{"name": "read_passage", "args": {"document": "Sehr langer Dokumentname " * 6, "clause": "1"}}],
            round_index=0,
        )
        assert len(_live(steps)[0].values["document"]) <= tool_calls.MAX_DOCUMENT_CHARS

    def test_a_round_that_also_searched_shows_the_search_query(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [
                {"name": "read_passage", "args": {"document": "OIB-Richtlinie 2", "clause": "3.5.2"}},
                {"name": "knowledge_search", "args": {"query": "Fluchtweglänge GK4"}},
            ],
            round_index=0,
        )
        payload = _live(steps)[0]
        assert payload.key == "status.retrieval.withQuery"
        assert payload.values["query"] == "Fluchtweglänge GK4"

    def test_a_locator_call_naming_nothing_falls_back_to_the_plain_line(self, steps) -> None:
        retrieval_status.emit_retrieval([{"name": "read_passage", "args": {"document": "OIB 2"}}], round_index=0)
        payload = _live(steps)[0]
        assert payload.key == "status.retrieval.plain"
        assert payload.values == {"corpus": "knowledge"}

    def test_loading_a_skill_is_not_a_retrieval(self, steps) -> None:
        read = {"name": "read_file", "args": {"file_path": "/skills/office/x/SKILL.md", "limit": 1000}}
        retrieval_status.emit_retrieval([read], round_index=0)
        retrieval_status.emit_retrieval([], round_index=1)
        retrieval_status.emit_retrieval(None, round_index=2)
        assert steps == []

    def test_a_draft_read_is_still_narrated_as_one(self, steps) -> None:
        retrieval_status.emit_retrieval([{"name": "read_file", "args": {"file_path": "/drafts/a.md"}}], round_index=0)
        assert _live(steps)[0].key == "status.action.draftRead"

    def test_the_skills_root_is_the_skills_packages(self) -> None:
        from agent.skills import SKILLS_ROOT

        assert tool_calls.SKILLS_ROOT == SKILLS_ROOT
        assert tool_calls.is_skill_read({"name": "read_file", "args": {"file_path": f"{SKILLS_ROOT}o/x/SKILL.md"}})
        assert not tool_calls.is_skill_read({"name": "read_file", "args": {"file_path": "/drafts/x.md"}})
        assert not tool_calls.is_skill_read({"name": "ls", "args": {"path": SKILLS_ROOT}})

    def test_an_interaction_tool_says_what_it_does(self, steps) -> None:
        retrieval_status.emit_retrieval([{"name": "remember", "args": {"text": "Dachneigung 30°"}}], round_index=0)
        assert _live(steps)[0].key == "status.action.remember"

    def test_a_workspace_call_says_it_works_in_the_workspace_and_its_bookkeeping_says_nothing(self, steps) -> None:
        call = {"name": "workspace__call", "args": {"name": "project-members-list", "input": {}}}
        retrieval_status.emit_retrieval([call], round_index=0)
        retrieval_status.emit_retrieval([{"name": "workspace__search", "args": {"query": "Mitglieder"}}], round_index=1)
        retrieval_status.emit_retrieval([{"name": "call", "args": {}}], round_index=2)
        live = _live(steps)
        assert [payload.key for payload in live] == ["status.action.workspaceCall"]
        assert live[0].values == {}

    def test_each_file_verb_says_which_one_it_was(self, steps) -> None:
        verbs = {
            "ls": "status.action.draftList",
            "read_file": "status.action.draftRead",
            "write_file": "status.action.draftWrite",
            "edit_file": "status.action.draftEdit",
        }
        for index, (verb, key) in enumerate(verbs.items()):
            args = {"path": "/drafts/"} if verb == "ls" else {"file_path": "/drafts/a.md"}
            retrieval_status.emit_retrieval([{"name": verb, "args": args}], round_index=index)
        assert [payload.key for payload in _live(steps)] == list(verbs.values())

    def test_a_file_verb_is_an_action_and_never_a_retrieval(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [{"name": "write_file", "args": {"file_path": "/drafts/aktenvermerk.md", "content": "# A"}}],
            round_index=0,
        )
        payload = _live(steps)[0]
        assert payload.key == "status.action.draftWrite"
        assert payload.values == {}

    def test_every_file_operation_shares_one_line(self, steps) -> None:
        operations = ("move", "rename", "create_folder", "assign")
        for index, operation in enumerate(operations):
            retrieval_status.emit_retrieval(
                [{"name": "propose_file_change", "args": {"operation": operation, "document": "plan.pdf"}}],
                round_index=index,
            )
        keys = [payload.key for payload in _live(steps)]
        assert keys == ["status.action.fileProposal"] * len(operations)

    def test_handing_the_work_over_says_so(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [{"name": "create_task", "args": {"title": "Fluchtwege prüfen"}}],
            round_index=0,
        )
        payload = _live(steps)[0]
        assert payload.key == "status.action.taskCreated"
        assert payload.values == {}

    def test_each_annotation_tool_says_which_it_is(self, steps) -> None:
        calls = [
            ("marks", {}),
            ("mark", {}),
            ("mark", {"open": True}),
            ("update", {"annotation": "4", "status": "resolved"}),
            ("delete", {"annotation": "4"}),
            ("reply", {}),
            ("room", {}),
            ("point", {}),
            ("highlight", {}),
        ]
        for index, (tool, args) in enumerate(calls):
            retrieval_status.emit_retrieval([{"name": f"canvas__{tool}", "args": args}], round_index=index)
        keys = [payload.key for payload in _live(steps)]
        assert keys == [
            "status.action.annotationsRead",
            "status.action.annotationsPropose",
            "status.action.annotationsSet",
            "status.action.annotationsUpdate",
            "status.action.annotationsDelete",
            "status.action.annotationsReply",
        ]
        assert all(payload.values == {} for payload in _live(steps))

    def test_a_look_has_its_own_line_without_values(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [{"name": "look", "args": {"document": "Grundriss EG.pdf", "page": 2}}], round_index=0
        )

        [payload] = _live(steps)
        assert (payload.key, payload.values) == ("status.action.look", {})

    def test_a_file_proposal_is_an_action_and_never_a_retrieval(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [
                {
                    "name": "propose_file_change",
                    "args": {"operation": "move", "document": "Brandschutzplan.pdf", "target_folder": "Einreichung"},
                }
            ],
            round_index=0,
        )
        payload = _live(steps)[0]
        assert payload.key == "status.action.fileProposal"
        assert payload.values == {}

    def test_remember_does_not_steal_the_next_search_slot(self, steps) -> None:
        assert retrieval_status.emit_retrieval([{"name": "remember", "args": {"text": "x"}}], round_index=0) is False
        assert (
            retrieval_status.emit_retrieval(
                [{"name": "knowledge_search_tool", "args": {"query": "q"}}],
                round_index=0,
            )
            is True
        )
        assert _started(steps, "status:action") + _started(steps, "status:retrieval") == [
            "status:action:remember",
            "status:retrieval:0",
        ]
        assert turn_status.current_retrieval_round() == 0

    def test_a_conclusion_travels_as_reason_not_as_a_value(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [{"name": "knowledge_search_tool", "args": {"query": "Fluchtweglänge GK4"}}],
            round_index=0,
            conclusion="Fluchtweglänge hängt an Nutzung, GK und dem Treppenraum.",
        )
        payload = _live(steps)[0]
        assert payload.reason == "Fluchtweglänge hängt an Nutzung, GK und dem Treppenraum."
        assert "reason" not in payload.values
        assert "text" not in payload.model_dump()

        retrieval_status.emit_retrieval(
            [{"name": "knowledge_search_tool", "args": {"query": "x"}}],
            round_index=1,
            conclusion="   ",
        )
        assert _live(steps)[1].reason is None

    def test_a_tool_we_cannot_name_says_NOTHING(self, steps) -> None:
        retrieval_status.emit_retrieval([{"name": "sql_probe_v2", "args": {"q": "x"}}], round_index=0)
        assert steps == []


class TestCheckpointIsCountable:
    def test_a_search_round_records_that_its_checkpoint_has_a_body(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [{"name": "knowledge_search_tool", "args": {"query": "Fluchtweg"}}],
            round_index=0,
            conclusion="Die Grundregel steht.",
        )
        (record,) = _technical(steps)
        assert record.detail["round"] == 0
        assert record.detail["hasConclusion"] is True
        assert _started(steps, "status:checkpoint") == ["status:checkpoint:0"]

    def test_a_round_the_model_wrote_no_thought_for_records_the_absence(self, steps) -> None:
        retrieval_status.emit_retrieval([{"name": "knowledge_search_tool", "args": {"query": "q"}}], round_index=1)
        retrieval_status.emit_retrieval(
            [{"name": "knowledge_search_tool", "args": {"query": "q"}}],
            round_index=2,
            conclusion="   ",
        )
        assert [(r.detail["round"], r.detail["hasConclusion"]) for r in _technical(steps)] == [(1, False), (2, False)]

    def test_it_counts_nothing_the_reader_wrote(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [{"name": "knowledge_search_tool", "args": {"query": "Fluchtweglänge GK4"}}],
            round_index=0,
            conclusion="Fluchtweglänge hängt an Nutzung und Geschoss.",
        )
        (record,) = _technical(steps)
        assert set(record.detail) == {"round", "hasConclusion", "source"}
        assert record.channel == turn_status.CHANNEL_TECHNICAL
        assert "Fluchtweg" not in record.model_dump_json()

    def test_the_argument_beats_the_prose(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [
                {
                    "name": "knowledge_search",
                    "args": {"query": "Fluchtweg", "conclusion": "Die Grundregel steht; offen ist der GK."},
                }
            ],
            round_index=0,
            conclusion="Prosa, die das Modell nebenher geschrieben hat.",
        )
        (line,) = _live(steps)
        assert line.reason == "Die Grundregel steht; offen ist der GK."
        (record,) = _technical(steps)
        assert (record.detail["hasConclusion"], record.detail["source"]) == (True, tool_calls.CHECKPOINT_FROM_ARGUMENT)

    def test_prose_still_carries_a_round_that_filled_no_argument(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [{"name": "knowledge_search", "args": {"query": "Fluchtweg"}}],
            round_index=0,
            conclusion="Ich brauche zuerst die Grundregel.",
        )
        (line,) = _live(steps)
        assert line.reason == "Ich brauche zuerst die Grundregel."
        (record,) = _technical(steps)
        assert (record.detail["hasConclusion"], record.detail["source"]) == (True, tool_calls.CHECKPOINT_FROM_PROSE)

    def test_an_empty_first_call_is_recorded_as_no_body_at_all(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [{"name": "knowledge_search", "args": {"query": "Fluchtweg", "conclusion": "   "}}],
            round_index=0,
        )
        (line,) = _live(steps)
        assert line.reason is None
        (record,) = _technical(steps)
        assert (record.detail["hasConclusion"], record.detail["source"]) == (False, tool_calls.CHECKPOINT_FROM_NONE)

    def test_a_parallel_batch_takes_the_first_conclusion_it_finds(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [
                {"name": "knowledge_search", "args": {"query": "a", "conclusion": ""}},
                {"name": "ris_search_tool", "args": {"query": "b", "conclusion": "Beide Korpora, ein Schluss."}},
            ],
            round_index=0,
        )
        assert len(_technical(steps)) == 1
        assert _live(steps)[0].reason == "Beide Korpora, ein Schluss."

    def test_the_conclusion_is_never_quoted_back_as_the_query(self, steps) -> None:
        retrieval_status.emit_retrieval(
            [{"name": "surface_documents", "args": {"conclusion": "Ich brauche den Plan."}}],
            round_index=0,
        )
        payload = _live(steps)[0]
        assert payload.key == "status.retrieval.plain"
        assert "query" not in payload.values

    def test_an_action_round_draws_no_checkpoint(self, steps) -> None:
        retrieval_status.emit_retrieval([{"name": "remember", "args": {"text": "x"}}], round_index=0)
        assert _technical(steps) == []

    def test_successive_rounds_each_leave_their_own_record(self, steps) -> None:
        for index in (0, 1, 2):
            retrieval_status.emit_retrieval(
                [{"name": "knowledge_search_tool", "args": {"query": "q"}}],
                round_index=index,
                conclusion="etwas" if index == 1 else None,
            )
        assert _started(steps, "status:checkpoint") == [
            "status:checkpoint:0",
            "status:checkpoint:1",
            "status:checkpoint:2",
        ]
        assert [r.detail["hasConclusion"] for r in _technical(steps)] == [False, True, False]


class TestEscalation:
    def test_the_line_says_why_in_the_readers_terms(self, steps) -> None:
        retrieval_status.emit_escalation("Shallow agent emitted insufficiency marker")
        payload = _live(steps)[0]
        assert payload.key == "status.escalation"
        assert payload.values == {}
        assert payload.detail == {"reason": "Shallow agent emitted insufficiency marker"}


class TestSynthesis:
    def test_the_line_marks_the_answer_being_written(self, steps) -> None:
        retrieval_status.emit_synthesis()
        payload = _live(steps)[0]
        assert payload.key == "status.synthesis"
        assert payload.values == {}


class TestTheSubjectDocument:
    def test_it_is_a_technical_record_with_no_key(self) -> None:
        step = retrieval_status.subject_document_step(
            loaded=True, document_id="doc-9", version_id="ver-9", state="draft", path="/drafts/Befund.md", chars=42
        )
        assert step == StatusStep(
            id="status:documents:subject",
            slot="documents:subject",
            channel="technical",
            detail={
                "loaded": True,
                "document_id": "doc-9",
                "version_id": "ver-9",
                "state": "draft",
                "path": "/drafts/Befund.md",
                "chars": 42,
            },
        )

    def test_a_miss_carries_a_stable_reason_and_omits_what_is_absent(self) -> None:
        step = retrieval_status.subject_document_step(
            loaded=False, version_id="ver-9", reason=retrieval_status.SUBJECT_UNREACHABLE
        )
        assert step.detail == {"loaded": False, "version_id": "ver-9", "reason": "unreachable"}

    def test_it_is_its_own_slot(self) -> None:
        assert (
            retrieval_status.subject_document_step(loaded=True).id
            != retrieval_status.documents_loading_step(["project"]).id
        )


class TestChannels:
    def test_every_status_here_is_addressed_to_the_reader(self, steps) -> None:
        retrieval_status.emit_retrieval([{"name": "knowledge_search_tool", "args": {"query": "q"}}], round_index=0)
        retrieval_status.emit_citation_check(source_count=3)
        retrieval_status.emit_escalation(None)

        payloads = [retrieval_status.documents_loading_step(["project"]), *_live(steps)]
        assert [payload.kind for payload in payloads] == ["status", "retrieval", "status", "status"]
        for payload in payloads:
            assert getattr(payload, "channel", "live") == turn_status.CHANNEL_LIVE
            assert payload.key in status_keys.ALL_STATUS_KEYS


_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]*(?:[._,][A-Za-z0-9]+)*$")

_ECHOED_BACK = {"query", "skill", "document", "clause", "page"}

_GERMAN_WORDS = (
    "wird",
    "werden",
    "wurde",
    "keine",
    "nötig",
    "reicht",
    "sucht",
    "belege",
    "unterlagen",
    "gesichtet",
    "geprüft",
    "angewendet",
    "angefordert",
    "recherche",
    "gespräch",
    " und ",
    " im ",
    " aus ",
)


def _every_live_payload(steps) -> list:
    setup = [
        retrieval_status.documents_loading_step(["office_shelf"]),
        retrieval_status.documents_loading_step(["project"]),
        retrieval_status.documents_loading_step(["session"]),
        retrieval_status.documents_loading_step(["office_shelf", "project"]),
        retrieval_status.documents_waiting_step(file_count=1),
    ]
    retrieval_status.emit_retrieval(
        [
            {"name": "knowledge_search_tool", "args": {"query": "Fluchtweglänge GK4"}},
            {"name": "ris_search_tool", "args": {"query": "Fluchtweglänge GK4"}},
        ],
        round_index=0,
    )
    retrieval_status.emit_retrieval([{"name": "web_search_tool", "args": {}}], round_index=1)
    retrieval_status.emit_retrieval(
        [{"name": "read_passage", "args": {"document": "OIB-Richtlinie 2", "clause": "3.5.2"}}],
        round_index=4,
    )
    retrieval_status.emit_retrieval(
        [{"name": "read_passage", "args": {"document": "Brandschutzkonzept.pdf", "page": 12}}],
        round_index=5,
    )
    retrieval_status.emit_retrieval([{"name": "remember", "args": {"text": "x"}}], round_index=2)
    retrieval_status.emit_retrieval([{"name": "emit_card", "args": {"kind": "x"}}], round_index=3)
    retrieval_status.emit_retrieval([{"name": "ls", "args": {"path": "/drafts/"}}], round_index=4)
    retrieval_status.emit_retrieval([{"name": "read_file", "args": {"file_path": "/drafts/a.md"}}], round_index=5)
    retrieval_status.emit_retrieval([{"name": "write_file", "args": {"file_path": "/drafts/a.md"}}], round_index=6)
    retrieval_status.emit_retrieval([{"name": "edit_file", "args": {"file_path": "/drafts/a.md"}}], round_index=7)
    retrieval_status.emit_retrieval(
        [{"name": "propose_file_change", "args": {"operation": "move", "document": "plan.pdf"}}],
        round_index=8,
    )
    retrieval_status.emit_retrieval(
        [{"name": "file_draft", "args": {"path": "/drafts/a.md"}}],
        round_index=9,
    )
    retrieval_status.emit_retrieval(
        [{"name": "file_draft", "args": {"path": "/drafts/a.md", "submit": True}}],
        round_index=10,
    )
    retrieval_status.emit_retrieval(
        [{"name": "execute", "args": {"code": "export default () => 1"}}],
        round_index=99,
    )
    retrieval_status.emit_retrieval(
        [{"name": "create_task", "args": {"title": "Fluchtwege prüfen"}}],
        round_index=11,
    )
    canvas = (("marks", {}), ("mark", {}), ("mark", {"open": True}), ("update", {}), ("delete", {}), ("reply", {}))
    for index, (tool, args) in enumerate(canvas):
        retrieval_status.emit_retrieval([{"name": f"canvas__{tool}", "args": args}], round_index=12 + index)
    retrieval_status.emit_retrieval([{"name": "workspace__call", "args": {"name": "tasks-list"}}], round_index=18)
    retrieval_status.emit_retrieval([{"name": "look", "args": {"page": 1}}], round_index=19)
    retrieval_status.emit_retrieval_requery(query_count=2)
    retrieval_status.emit_citation_check(source_count=3)
    retrieval_status.emit_answer_repair(quotes=1)
    retrieval_status.emit_escalation("Shallow agent emitted insufficiency marker")
    retrieval_status.emit_synthesis()
    return [*setup, *_live(steps)]


class TestNothingEmittedIsLanguageSpecific:
    def test_the_text_field_is_gone(self, steps) -> None:
        for payload in _every_live_payload(steps):
            assert "text" not in payload, payload

    def test_every_product_authored_string_is_an_id(self, steps) -> None:
        for payload in _every_live_payload(steps):
            assert _ID_RE.match(payload.key), payload.key
            for name, value in payload.values.items():
                if name in _ECHOED_BACK:
                    continue
                assert _ID_RE.match(value), f"{name}={value!r} in {payload['key']}"

    def test_no_german_survives_anywhere_the_reader_can_see(self, steps) -> None:
        for payload in _every_live_payload(steps):
            visible = " ".join([payload.key, *(v for k, v in payload.values.items() if k not in _ECHOED_BACK)]).lower()
            for word in _GERMAN_WORDS:
                assert word not in f" {visible} ", f"{word!r} leaked into {payload['key']}"

    def test_every_key_emitted_is_one_the_frontend_declares(self, steps) -> None:
        emitted = {payload.key for payload in _every_live_payload(steps)}
        assert emitted <= set(status_keys.ALL_STATUS_KEYS)
        assert set(status_keys.ALL_STATUS_KEYS) == emitted

    def test_the_two_registries_do_not_overlap(self) -> None:
        assert not set(status_keys.ALL_STATUS_KEYS) & set(ALL_SKILL_KEYS)


class TestTheRepairRecordCarriesItsCounts:
    def test_one_step_named_status_repair(self, steps) -> None:
        retrieval_status.emit_answer_repair(quotes=1)
        assert {step.id for step in steps.steps} == {"status:repair"}

    def test_the_count_is_the_camel_case_the_detail_panel_reads(self, steps) -> None:
        retrieval_status.emit_answer_repair(quotes=1)
        payload = _live(steps)[0]
        assert payload.detail == {"quotesFailed": 1}

    def test_the_line_still_resolves_for_the_reader(self, steps) -> None:
        retrieval_status.emit_answer_repair(quotes=1)
        payload = _live(steps)[0]
        assert payload.key == status_keys.KEY_REPAIR
        assert payload.values == {}


def _search_calls():
    return [{"name": "knowledge_search", "args": {"query": "Fluchtweglänge GK4"}}]


def _open_calls():
    return [{"name": "read_passage", "args": {"document": "oib-rl_2.pdf", "clause": "3.5.2"}}]


class TestRoundAnnouncementMirrorsTheLiveFrame:
    def test_a_search_round_records_its_facts_and_no_guessed_purpose(self) -> None:
        record = retrieval_status.record_round_announcement(round_index=0, calls=_search_calls(), conclusion=None)
        assert record == {
            "index": 0,
            "key": status_keys.KEY_RETRIEVAL_WITH_QUERY,
            "tools": ["knowledge_search"],
            "corpora": ["knowledge"],
            "query": "Fluchtweglänge GK4",
        }

    def test_a_locator_round_records_its_key(self) -> None:
        record = retrieval_status.record_round_announcement(round_index=1, calls=_open_calls(), conclusion=None)
        assert record is not None
        assert record["key"] == status_keys.KEY_RETRIEVAL_CLAUSE
        assert record["tools"] == ["read_passage"]

    def test_action_batches_and_empties_record_nothing(self) -> None:
        assert (
            retrieval_status.record_round_announcement(
                round_index=0,
                calls=[{"name": "remember", "args": {}}],
                conclusion=None,
            )
            is None
        )
        assert retrieval_status.record_round_announcement(round_index=0, calls=[], conclusion=None) is None

    def test_the_reason_is_the_ranked_checkpoint_clipped_like_the_frame(self, steps) -> None:
        calls = [
            {
                "name": "knowledge_search",
                "args": {"query": "q", "conclusion": "Die Grundregel steht."},
            }
        ]
        record = retrieval_status.record_round_announcement(
            round_index=0, calls=calls, conclusion="Prose beside the calls."
        )
        assert record is not None
        assert record["reason"] == "Die Grundregel steht."
        retrieval_status.emit_retrieval(calls, round_index=0, conclusion="Prose beside the calls.")
        assert _live(steps)[0].reason == record["reason"]

    def test_record_covers_exactly_the_batches_the_counter_skips(self) -> None:
        batches = [
            _search_calls(),
            _open_calls(),
            [{"name": "remember", "args": {}}],
            [{"name": "acme_custom_tool", "args": {}}],
            [],
        ]
        for index, calls in enumerate(batches):
            record = retrieval_status.record_round_announcement(round_index=index, calls=calls, conclusion=None)
            assert (record is None) == (not retrieval_status.emit_retrieval(calls, round_index=99))


class TestLaneCaptureKeepsRoundsApart:
    def test_hits_land_with_the_current_round(self) -> None:
        token = turn_status.begin_lane_capture()
        try:
            with turn_status.retrieval_round_scope(0):
                turn_status.record_lane_hit("oib-rl_2.pdf", title="OIB-RL 2", detail="p.12")
            with turn_status.retrieval_round_scope(1):
                turn_status.record_lane_hit("oib-rl_2.pdf", title="OIB-RL 2", detail="p.31")
            hits = turn_status.get_lane_captures()
        finally:
            turn_status.end_lane_capture(token)
        assert [(hit["round"], hit["name"], hit.get("detail")) for hit in hits] == [
            (0, "oib-rl_2.pdf", "p.12"),
            (1, "oib-rl_2.pdf", "p.31"),
        ]

    def test_capture_is_scoped_and_best_effort(self) -> None:
        turn_status.record_lane_hit("x.pdf")
        assert turn_status.get_lane_captures() == []
        token = turn_status.begin_lane_capture()
        try:
            turn_status.record_lane_hit("  ")
            turn_status.record_lane_hit("x.pdf")
            assert [hit["name"] for hit in turn_status.get_lane_captures()] == ["x.pdf"]
        finally:
            turn_status.end_lane_capture(token)
        assert turn_status.get_lane_captures() == []
        turn_status.record_lane_hit("y.pdf")
        assert turn_status.get_lane_captures() == []


class TestTheFetchFailureMarker:
    def test_the_marker_is_a_stable_prefix_both_tools_can_write(self) -> None:
        assert tool_calls.FETCH_FAILED_MARKER == "[fetch failed]"

    def test_both_retrieval_tools_start_their_failure_string_with_it(self) -> None:
        from knowledge_layer.read_passage import _store_silent_message

        assert _store_silent_message("OIB-Richtlinie 2, Pkt. 3.5.2").startswith(tool_calls.FETCH_FAILED_MARKER)


class TestFetchSignature:
    def test_a_search_folds_case_and_whitespace_in_the_query(self) -> None:
        first = tool_calls.fetch_signature({"name": "knowledge_search", "args": {"query": "Fluchtweglänge GK4"}})
        second = tool_calls.fetch_signature({"name": "knowledge_search", "args": {"query": "  fluchtweglänge   gk4 "}})
        assert first is not None
        assert first == second

    def test_a_narrowing_argument_is_part_of_the_identity(self) -> None:
        plain = tool_calls.fetch_signature({"name": "knowledge_search", "args": {"query": "Fluchtweg"}})
        narrowed = tool_calls.fetch_signature(
            {"name": "knowledge_search", "args": {"query": "Fluchtweg", "file_name": "Brandschutz.pdf"}}
        )
        foldered = tool_calls.fetch_signature(
            {"name": "knowledge_search", "args": {"query": "Fluchtweg", "folder": "Brandschutz"}}
        )
        assert len({plain, narrowed, foldered}) == 3

    def test_a_file_name_is_matched_case_insensitively(self) -> None:
        upper = tool_calls.fetch_signature(
            {"name": "knowledge_search", "args": {"query": "q", "file_name": "Brandschutz.PDF"}}
        )
        lower = tool_calls.fetch_signature(
            {"name": "knowledge_search", "args": {"query": "q", "file_name": " brandschutz.pdf"}}
        )
        assert upper == lower

    def test_filters_compare_by_content_and_not_by_key_order(self) -> None:
        one = tool_calls.fetch_signature(
            {"name": "knowledge_search", "args": {"query": "q", "filters": {"a": 1, "b": 2}}}
        )
        other = tool_calls.fetch_signature(
            {"name": "knowledge_search", "args": {"query": "q", "filters": {"b": 2, "a": 1}}}
        )
        unfiltered = tool_calls.fetch_signature({"name": "knowledge_search", "args": {"query": "q"}})
        assert one == other
        assert one != unfiltered

    def test_an_empty_narrowing_is_the_same_as_none(self) -> None:
        blank = tool_calls.fetch_signature(
            {"name": "knowledge_search", "args": {"query": "q", "doc_class": "  ", "filters": {}}}
        )
        assert blank == tool_calls.fetch_signature({"name": "knowledge_search", "args": {"query": "q"}})

    def test_a_clause_is_the_same_point_with_or_without_its_trailing_dot(self) -> None:
        dotted = tool_calls.fetch_signature(
            {"name": "read_passage", "args": {"document": "OIB-Richtlinie 2", "clause": "3.5.2."}}
        )
        plain = tool_calls.fetch_signature(
            {"name": "read_passage", "args": {"document": " oib-richtlinie 2 ", "clause": "3.5.2"}}
        )
        assert dotted is not None
        assert dotted == plain

    def test_another_page_of_one_document_is_another_passage(self) -> None:
        twelve = tool_calls.fetch_signature({"name": "read_passage", "args": {"document": "plan.pdf", "page": 12}})
        as_text = tool_calls.fetch_signature({"name": "read_passage", "args": {"document": "plan.pdf", "page": "12"}})
        thirteen = tool_calls.fetch_signature({"name": "read_passage", "args": {"document": "plan.pdf", "page": 13}})
        assert twelve == as_text
        assert twelve != thirteen

    def test_a_group_qualified_tool_name_still_signs(self) -> None:
        assert tool_calls.fetch_signature(
            {"name": "mcp__knowledge_search", "args": {"query": "q"}}
        ) == tool_calls.fetch_signature({"name": "knowledge_search", "args": {"query": "q"}})

    def test_every_other_tool_is_never_guarded(self) -> None:
        for name in ("emit_card", "remember", "ris_search_tool", "web_search_tool", "ifc_measure", "read_file"):
            assert tool_calls.fetch_signature({"name": name, "args": {"query": "q"}}) is None

    def test_a_call_it_cannot_read_is_not_signed(self) -> None:
        assert tool_calls.fetch_signature({"name": "knowledge_search"}) is None
        assert tool_calls.fetch_signature({"name": "knowledge_search", "args": "query=q"}) is None
        assert tool_calls.fetch_signature("knowledge_search") is None


class TestTheRepeatFetchRecord:
    def test_it_never_reaches_the_live_line(self, steps) -> None:
        turn_notices.emit_repeat_fetch(round_index=1, withheld=2)
        assert _live(steps) == []
        (payload,) = _technical(steps)
        assert payload.channel == turn_status.CHANNEL_TECHNICAL
        assert payload.key is None
        assert (payload.detail["round"], payload.detail["withheld"]) == (1, 2)

    def test_each_round_leaves_its_own_step(self, steps) -> None:
        turn_notices.emit_repeat_fetch(round_index=0, withheld=1)
        turn_notices.emit_repeat_fetch(round_index=1, withheld=1)
        assert _started(steps, "status:repeat") == ["status:repeat:0", "status:repeat:1"]


def test_a_call_that_still_names_punkt_reads_as_the_same_clause():
    old = {"name": "read_passage", "args": {"document": "OIB-Richtlinie 2", "punkt": "3.5.2."}}
    new = {"name": "read_passage", "args": {"document": "OIB-Richtlinie 2", "clause": "3.5.2"}}

    assert tool_calls.fetch_signature(old) == tool_calls.fetch_signature(new)


class TestToolBasename:
    @pytest.mark.parametrize(
        ("qualified", "base"),
        [
            ("ifc_measure", "ifc_measure"),
            ("bim__ifc_measure", "ifc_measure"),
            ("mcp__piloti__ifc_measure", "ifc_measure"),
            ("canvas.mark", "mark"),
            ("group__sub.tool", "tool"),
            ("", ""),
        ],
    )
    def test_it_returns_the_final_segment(self, qualified: str, base: str) -> None:
        assert tool_calls.tool_basename(qualified) == base
