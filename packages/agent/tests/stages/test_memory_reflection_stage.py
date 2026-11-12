"""Memory reflection as a post-answer stage.

The gate cases moved here verbatim from
``packages/agent/tests/agents/piloti/test_register_helpers.py`` — the
predicate is the same predicate, it just reads ``TurnFacts`` instead of the graph
state now. The new cases are the two defects the migration closes: a hard
timeout, and a gate that finally reads ``research_truncated``.
"""

import dataclasses
from unittest.mock import patch

import pytest

from agent.common.bff_http import SignedEnvelope
from agent.common.canned_replies import GENERIC_ERROR_MESSAGE
from agent.knowledge.project_memory import TurnMemoryNote
from agent.memory.restriction import RestrictionEvidence
from agent.stages import get_stage
from agent.stages.flags import legacy_enabled_stages
from agent.stages.flags import stages_for_flag_slug
from agent.stages.memory_reflection import MAX_NOTED_ITEMS
from agent.stages.memory_reflection import MEMORY_REFLECTION
from agent.stages.memory_reflection import MemoryReflectionPayload
from agent.stages.memory_reflection import matches_escalation_keywords
from agent.stages.spec import StageContext
from agent.stages.spec import StageEmpty
from agent.stages.spec import TurnFacts


def _facts(**overrides) -> TurnFacts:
    base = TurnFacts(
        conversation_id="conv_1",
        ws_parent_id="msg_1",
        organization_id="org_1",
        project_id="proj_1",
        query="Wie hoch darf die Brüstung sein?",
        answer="Das Gebäude ist Gebäudeklasse 4.",
        routing_decision="shallow",
        enabled_stages=frozenset({"memory_reflection"}),
    )
    return dataclasses.replace(base, **overrides)


def _gate(**overrides):
    return MEMORY_REFLECTION.gate(_facts(**overrides))


#: What `run_memory_reflection` reports it wrote — one row per project_memory
#: insert, in write order, as the reader will see it.
_WRITTEN = [
    {"id": "9d2f6b41", "kind": "constraint", "content": "Das Projekt liegt in Wien."},
    {"id": "1a7c9e02", "kind": "derived_fact", "content": "Das oberste Fluchtniveau beträgt 9,80 m."},
]


class TestDeclaration:
    def test_it_is_registered_under_its_wire_id(self):
        assert get_stage("memory_reflection") is MEMORY_REFLECTION

    def test_it_declares_a_hard_timeout(self):
        """The defect this migration closes: before, the only bound was the
        provider's 120s x 2 retries, holding one of four concurrency slots."""
        assert MEMORY_REFLECTION.timeout_s == 45.0

    def test_it_delivers_a_frame_and_keeps_its_flag(self):
        """Slice 4b: the DB write is still the durable act, and the turn that
        caused it is now TOLD. That frame is the whole reason the per-answer
        memory poll could be deleted rather than merely slowed down — with
        `silent` there was no channel, so a browser had to guess when to ask.

        The flag does not move: an operator who switches `memory-reflection` off
        still switches off the writes AND the frame, which is what they mean.
        """
        assert MEMORY_REFLECTION.delivery == "frame"
        assert MEMORY_REFLECTION.flag_slug == "memory-reflection"


class TestFlagPlumbing:
    def test_the_legacy_boolean_still_switches_the_stage_on(self):
        """One release of overlap: an older BFF sends only
        `memoryReflectionEnabled`, and a mixed deployment must not go dark."""
        assert "memory_reflection" in legacy_enabled_stages(memory_reflection_enabled=True)

    def test_the_legacy_boolean_off_switches_it_off(self):
        assert legacy_enabled_stages(memory_reflection_enabled=False) == frozenset()

    def test_the_mapping_follows_the_declared_slug_not_a_hardcoded_id(self):
        assert stages_for_flag_slug(MEMORY_REFLECTION.flag_slug) == frozenset({"memory_reflection"})
        assert stages_for_flag_slug("no-such-flag") == frozenset()


class TestGate:
    def test_real_research_answer_passes(self):
        assert _gate().run is True

    def test_direct_reply_skipped(self):
        """A greeting, a listing, an off-topic decline: the turn consulted
        nothing and graded nothing, so there is nothing to remember."""
        decision = _gate(routing_decision="meta", answer="Hello! How can I help?")
        assert decision.run is False
        assert decision.reason == "routing_meta"

    def test_error_route_skipped(self):
        assert _gate(routing_decision="error", answer="Something went wrong.").reason == "routing_error"

    def test_an_unobserved_route_still_runs(self):
        """``None`` is "not recorded", not "direct reply": a deep-research
        answer delivered off the WebSocket path has no observation and must
        not be filed as small talk."""
        assert _gate(routing_decision=None).run is True

    def test_insufficiency_answer_skipped(self):
        decision = _gate(answer="I don't have enough information to answer that.")
        assert decision.run is False
        assert decision.reason == "escalation"

    def test_canned_error_answer_skipped(self):
        decision = _gate(answer=GENERIC_ERROR_MESSAGE)
        assert decision.reason == "canned_non_answer"

    def test_empty_answer_skipped(self):
        assert _gate(answer="   ").reason == "empty_turn"

    def test_a_truncated_turn_is_not_reflected_on(self):
        """`research_truncated` rides the wire but the old gate never read it, so
        durable project memory was distilled out of evidence-gathering that had
        been cut off at the tool-iteration ceiling."""
        decision = _gate(research_truncated=True)
        assert decision.run is False
        assert decision.reason == "research_truncated"

    def test_a_turn_that_only_commissioned_a_run_is_skipped(self):
        # The run reflects on its own report, on the worker, once it exists.
        assert _gate(run_id="run_1").reason == "commissioned_run"

    def test_a_project_less_conversation_has_nothing_it_may_write(self):
        assert _gate(project_id=None).reason == "no_project"


class TestHandler:
    @pytest.mark.asyncio
    async def test_nothing_durable_is_an_empty_payload_not_an_invention(self):
        with patch("agent.memory.reflection.run_memory_reflection", return_value=[]) as run:
            payload = await MEMORY_REFLECTION.handler(StageContext(facts=_facts(), llm=object()))
        assert payload is None
        assert run.await_count == 1

    @pytest.mark.asyncio
    async def test_written_items_are_reported_as_the_payload(self):
        with patch("agent.memory.reflection.run_memory_reflection", return_value=_WRITTEN):
            payload = await MEMORY_REFLECTION.handler(StageContext(facts=_facts(), llm=object()))
        assert payload == {"items": _WRITTEN}
        assert MemoryReflectionPayload.model_validate(payload).items[0].kind == "constraint"

    @pytest.mark.asyncio
    async def test_the_payload_carries_the_item_text_and_not_only_its_id(self):
        """What the chip renders is the finding's own words.

        A payload of ids would leave the browser holding a receipt for text it
        cannot read, and the only way to read it would be the GET this slice
        exists to delete — the poll would come back, wearing a frame as a
        trigger. The writer had the words in hand; it sends them.
        """
        with patch("agent.memory.reflection.run_memory_reflection", return_value=_WRITTEN):
            payload = await MEMORY_REFLECTION.handler(StageContext(facts=_facts(), llm=object()))
        items = MemoryReflectionPayload.model_validate(payload).items
        assert [item.content for item in items] == [row["content"] for row in _WRITTEN]
        assert all(item.id and item.kind for item in items)

    @pytest.mark.asyncio
    async def test_the_pass_sees_the_digest_the_agent_saw_this_turn(self):
        facts = _facts(memory_digest='- [decision | high | verified] "Flachdach"')
        with patch("agent.memory.reflection.run_memory_reflection", return_value=[]) as run:
            await MEMORY_REFLECTION.handler(StageContext(facts=facts, llm="the-llm"))
        kwargs = run.await_args.kwargs
        assert kwargs["memory_digest"] == facts.memory_digest
        assert kwargs["llm"] == "the-llm"
        assert kwargs["project_id"] == "proj_1"
        assert kwargs["organization_id"] == "org_1"
        assert kwargs["conversation_id"] == "conv_1"


class TestMatchesEscalationKeywords:
    """The insufficiency heuristic, read ONLY by this stage's gate: escalation
    itself requires Piloti's explicit structured ask."""

    def test_english_phrase_hits(self):
        assert matches_escalation_keywords("Unfortunately I don't have enough information to answer.") is True

    def test_german_phrase_one_hits(self):
        assert matches_escalation_keywords("Es liegen nicht genügend Informationen vor.") is True

    def test_german_phrase_two_hits(self):
        assert matches_escalation_keywords("Weitere Recherche erforderlich, um dies zu klären.") is True

    def test_adequate_german_answer_no_hit(self):
        content = "Die OIB-Richtlinie 2 regelt den Brandschutz umfassend und eindeutig."
        assert matches_escalation_keywords(content) is False

    def test_keyword_before_last_800_chars_no_hit(self):
        # Keyword placed well before the last 800 characters is not matched.
        content = "unable to find" + ("x" * 900)
        assert matches_escalation_keywords(content) is False


class TestRestrictedContent:
    """ADR-0087: a turn that could read a restricted folder still reflects; what
    it writes is restricted memory (``memory/restriction.py``)."""

    _EVIDENCE = RestrictionEvidence(scope=("proj_1_r0123456789ab",), read=("proj_1_r0123456789ab",))

    def test_a_restricted_turn_is_not_skipped(self):
        assert _gate(restriction=self._EVIDENCE).run

    def test_an_open_turn_still_proceeds(self):
        assert _gate().run

    @pytest.mark.asyncio
    async def test_the_handler_hands_the_evidence_to_the_reflection_pass(self):
        seen = {}

        async def fake_reflection(**kwargs):
            seen.update(kwargs)
            return []

        with patch("agent.memory.reflection.run_memory_reflection", fake_reflection):
            await MEMORY_REFLECTION.handler(StageContext(facts=_facts(restriction=self._EVIDENCE), llm=object()))
        assert seen["restriction"] is self._EVIDENCE


class TestTemporaryConversation:
    """ADR-0180: a temporary conversation keeps nothing, and the skip says so by name."""

    def test_the_gate_declines_and_names_the_reason(self):
        decision = _gate(temporary=True)
        assert (decision.run, decision.reason) == (False, "temporary_conversation")

    def test_it_outranks_every_other_reason(self):
        assert _gate(temporary=True, project_id=None, run_id="run_1", answer="").reason == "temporary_conversation"

    def test_a_conversation_that_is_not_temporary_proceeds(self):
        assert _gate(temporary=False).run


class TestPersonalNotes:
    """ADR-0180: the frame is stored on the answer's message, which everyone the
    conversation is shared with reads, so a personal note never rides it."""

    _ENVELOPE = SignedEnvelope(header="env-header", signature="env-signature")
    _PERSONAL = {"id": "n-1", "kind": "profile", "content": "Leitet die Einreichplanung.", "about": "person"}
    _PROJECT = {"id": "p-1", "kind": "constraint", "content": "Das Projekt liegt in Wien.", "about": "project"}

    async def _run(self, written):
        seen = {}

        async def run(**kwargs):
            seen.update(kwargs)
            return written

        facts = _facts(envelope=self._ENVELOPE, personal_memory="PERSONAL_MEMORY v1")
        with patch("agent.memory.reflection.run_memory_reflection", run):
            result = await MEMORY_REFLECTION.handler(StageContext(facts=facts, llm=object()))
        return result, seen

    @pytest.mark.asyncio
    async def test_the_handler_hands_the_envelope_and_the_personal_block_to_the_pass(self):
        _result, seen = await self._run([])
        assert seen["envelope"] == self._ENVELOPE
        assert seen["personal_memory"] == "PERSONAL_MEMORY v1"

    @pytest.mark.asyncio
    async def test_the_frame_carries_the_projects_rows_only(self):
        result, _seen = await self._run([self._PERSONAL, self._PROJECT])
        assert result == {"items": [{"id": "p-1", "kind": "constraint", "content": "Das Projekt liegt in Wien."}]}
        MemoryReflectionPayload.model_validate(result)

    @pytest.mark.asyncio
    async def test_a_pass_that_wrote_only_personal_notes_is_empty_by_name(self):
        result, _seen = await self._run([self._PERSONAL])
        assert result == StageEmpty("personal_notes_only")

    def test_the_envelope_is_not_in_the_facts_repr(self):
        assert "env-signature" not in repr(_facts(envelope=self._ENVELOPE))


def _note(note_id: str = "n-1", **overrides) -> TurnMemoryNote:
    base = {"id": note_id, "kind": "decision", "content": "Die Bauherrschaft will ein Flachdach.", "scope": "project"}
    return TurnMemoryNote(**{**base, **overrides})


class TestInTurnNotes:
    """What the ``remember`` tool wrote while answering is on the same frame (ADR-0180: every save on its answer)."""

    @pytest.mark.asyncio
    async def test_the_frame_lists_the_tools_notes_ahead_of_the_stages(self):
        facts = _facts(noted_this_turn=(_note("n-1"), _note("n-2", scope="organization", kind="preference")))
        with patch("agent.memory.reflection.run_memory_reflection", return_value=_WRITTEN):
            payload = await MEMORY_REFLECTION.handler(StageContext(facts=facts, llm=object()))
        items = MemoryReflectionPayload.model_validate(payload).model_dump(exclude_none=True)["items"]
        assert [item["id"] for item in items] == ["n-1", "n-2", "9d2f6b41", "1a7c9e02"]
        assert items[0] == {
            "id": "n-1",
            "kind": "decision",
            "content": "Die Bauherrschaft will ein Flachdach.",
            "provenance": "agent",
        }
        assert items[1]["scope"] == "organization"
        # The stage's own rows keep the shape they always had: no provenance key.
        assert "provenance" not in items[2]

    @pytest.mark.asyncio
    async def test_a_replaced_and_a_restricted_note_say_so(self):
        note = _note(supersedes="Die Bauherrschaft will ein Satteldach.", restricted=True)
        with patch("agent.memory.reflection.run_memory_reflection", return_value=[]):
            payload = await MEMORY_REFLECTION.handler(StageContext(facts=_facts(noted_this_turn=(note,)), llm=object()))
        assert payload["items"] == [
            {
                "id": "n-1",
                "kind": "decision",
                "content": "Die Bauherrschaft will ein Flachdach.",
                "provenance": "agent",
                "supersedes": "Die Bauherrschaft will ein Satteldach.",
                "restricted": True,
            }
        ]

    def test_a_turn_with_notes_gets_its_frame_where_reflection_is_declined(self):
        """A direct reply, a short answer, a turn outside a project: the tool's notes still owe the answer a record."""
        for declined in ({"routing_decision": "meta"}, {"project_id": None}, {"research_truncated": True}):
            assert _gate(**declined).run is False
            assert _gate(**declined, noted_this_turn=(_note(),)).run is True

    @pytest.mark.asyncio
    async def test_where_reflection_is_declined_the_handler_reports_and_reflects_on_nothing(self):
        facts = _facts(routing_decision="meta", noted_this_turn=(_note(),))
        with patch("agent.memory.reflection.run_memory_reflection") as run:
            payload = await MEMORY_REFLECTION.handler(StageContext(facts=facts, llm=object()))
        run.assert_not_called()
        assert [item["id"] for item in payload["items"]] == ["n-1"]

    @pytest.mark.asyncio
    async def test_a_cross_project_turn_reports_its_notes_and_pays_for_no_pass(self):
        facts = _facts(drew_on_other_projects=True, noted_this_turn=(_note(),))
        with patch("agent.memory.reflection.run_memory_reflection") as run:
            payload = await MEMORY_REFLECTION.handler(StageContext(facts=facts, llm=object()))
        run.assert_not_called()
        assert len(payload["items"]) == 1

    @pytest.mark.asyncio
    async def test_the_frame_is_bounded(self):
        notes = tuple(_note(f"n-{index}") for index in range(MAX_NOTED_ITEMS + 4))
        with patch("agent.memory.reflection.run_memory_reflection", return_value=[]):
            payload = await MEMORY_REFLECTION.handler(StageContext(facts=_facts(noted_this_turn=notes), llm=object()))
        assert len(payload["items"]) == MAX_NOTED_ITEMS

    def test_a_temporary_conversation_has_no_notes_and_no_frame(self):
        """Nothing is kept from it (the tool answers without writing), so there is nothing to report."""
        decision = _gate(temporary=True)
        assert (decision.run, decision.reason) == (False, "temporary_conversation")


class TestWhatThePassWrote:
    """The stage reads each row's outcome from what the BFF answered, under a memory log of its own."""

    @staticmethod
    def _pass_that_writes(*answers):
        """A reflection pass whose project writes the BFF answered with ``answers``, one per row."""
        from agent.knowledge import project_memory as pm

        async def run(**_kwargs):
            rows = []
            for answer, payload in answers:
                pm._record_write(answer, payload)
                rows.append(
                    {**answer["item"], "kind": payload["kind"], "content": payload["content"], "about": "project"}
                )
            return rows

        return run

    @pytest.mark.asyncio
    async def test_a_correction_and_a_restricted_row_are_marked_on_the_frame(self):
        run = self._pass_that_writes(
            (
                {"item": {"id": "r-1"}, "supersededId": "old-1", "created": True},
                {
                    "scope": "project",
                    "kind": "derived_fact",
                    "content": "OIB-RL 2.1 gilt.",
                    "supersedesContent": "OIB-RL 2.1 gilt nicht.",
                },
            ),
            (
                {"item": {"id": "r-2"}, "supersededId": None},
                {
                    "scope": "project",
                    "kind": "constraint",
                    "content": "Die Statik ist freigegeben.",
                    "restrictedCollections": ["proj_1_rabc"],
                    "supersedesContent": "Unresolved quote.",
                },
            ),
        )
        with patch("agent.memory.reflection.run_memory_reflection", run):
            payload = await MEMORY_REFLECTION.handler(StageContext(facts=_facts(), llm=object()))
        assert payload["items"] == [
            {
                "id": "r-1",
                "kind": "derived_fact",
                "content": "OIB-RL 2.1 gilt.",
                "supersedes": "OIB-RL 2.1 gilt nicht.",
            },
            # A quote the BFF did not resolve retired nothing, and the frame does not claim it did.
            {"id": "r-2", "kind": "constraint", "content": "Die Statik ist freigegeben.", "restricted": True},
        ]

    @pytest.mark.asyncio
    async def test_a_restated_note_the_bff_only_refreshed_is_not_reported_as_written(self):
        run = self._pass_that_writes(
            (
                {"item": {"id": "old"}, "created": False},
                {"scope": "project", "kind": "decision", "content": "Flachdach."},
            )
        )
        with patch("agent.memory.reflection.run_memory_reflection", run):
            result = await MEMORY_REFLECTION.handler(StageContext(facts=_facts(), llm=object()))
        assert result == StageEmpty("restated_notes_only")

    @pytest.mark.asyncio
    async def test_the_pass_writes_under_this_answers_id_and_leaves_no_log_bound(self):
        from agent.knowledge import project_memory as pm
        from agent.turn.response import answer_message_id

        seen = {}

        async def run(**_kwargs):
            seen["answer"] = pm.turn_answer_message()
            return []

        with patch("agent.memory.reflection.run_memory_reflection", run):
            await MEMORY_REFLECTION.handler(StageContext(facts=_facts(), llm=object()))
        assert seen["answer"] == answer_message_id("conv_1", "msg_1")
        assert pm.turn_answer_message() is None

    @pytest.mark.asyncio
    async def test_off_the_socket_a_personal_note_is_stored_under_no_answer(self):
        from agent.knowledge import project_memory as pm

        seen = {}

        async def run(**_kwargs):
            seen["answer"] = pm.turn_answer_message()
            return []

        with patch("agent.memory.reflection.run_memory_reflection", run):
            await MEMORY_REFLECTION.handler(StageContext(facts=_facts(ws_parent_id=None), llm=object()))
        assert seen["answer"] is None
