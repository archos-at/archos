from __future__ import annotations

import pytest
from langchain_core.messages import AIMessage

from agent.common.turn_admission import TurnAdmissionError
from agent.common.wire_v2 import RunFinishedBody
from agent.common.wire_v2 import StatusStep
from agent.common.wire_v2 import StepFinishedBody
from agent.common.wire_v2 import UserMessage
from agent.core import conversation_register as register_mod
from agent.core.conversation_register import ChatDeepResearcherConfig
from agent.core.models import ResearchAgentState
from agent.turn import admission as admission_mod
from agent.turn import inventory as inventory_mod
from agent.turn import registries as registries_mod
from agent.turn.admission import TurnOutcome
from agent.turn.admission import TurnRefusal

ANSWER = "Die Brüstung muss mindestens 100 cm hoch sein [1]."


async def _shallow(state):
    return ResearchAgentState(
        messages=list(state.messages) + [AIMessage(content=ANSWER)],
        escalation_requested=False,
        source_lookup_attempted=True,
        answer_citation_grounded=True,
        answer_confidence_marker="high",
        confidence_check={"status": "judged", "level": "high", "findings": []},
        skills_activated=["oib-brandschutz"],
    )


def _ask(text: str, **fields) -> UserMessage:
    return UserMessage(conversation_id="conv-1", message_id="msg-1", text=text, **fields)


class TestStageModelWiring:
    def test_each_post_answer_stage_has_its_own_config_field(self):
        for field in ("memory_reflection_llm", "follow_ups_llm"):
            assert field in ChatDeepResearcherConfig.model_fields
            assert ChatDeepResearcherConfig.model_fields[field].default is None


@pytest.fixture
def harness(workflow_harness):
    workflow_harness["shallow"] = _shallow
    return workflow_harness


class TestRun:
    async def test_a_turn_ends_with_one_run_finished_carrying_the_result(self, harness):
        bodies = await harness["turn"](_ask("Wie hoch muss die Brüstung sein?"))

        terminal = bodies[-1]
        assert isinstance(terminal, RunFinishedBody)
        assert [b for b in bodies if isinstance(b, RunFinishedBody)] == [terminal]
        assert terminal.outcome == "answered"
        assert terminal.result.text == ANSWER
        assert terminal.result.routing_decision == "shallow"
        assert terminal.result.answer_confidence == "high"
        assert terminal.result.skills_activated == ["oib-brandschutz"]

    async def test_nat_run_prints_the_run_finished_text(self, harness):
        assert await harness["single"]("Wie hoch muss die Brüstung sein?") == ANSWER

    async def test_the_setup_steps_are_yielded_before_the_graph_starts(self, harness, monkeypatch):
        loading = StatusStep(id="status:documents", slot="documents", key="status.documents.project")
        waiting = StatusStep(id="status:documents:waiting", slot="documents:waiting", key="status.documents.waiting")
        waited: list = []

        async def wait_for_uploads(scope, inventory):
            waited.append(scope)
            return inventory

        monkeypatch.setattr(register_mod, "documents_loading_step", lambda shelves: loading)
        monkeypatch.setattr(register_mod, "pending_uploads", lambda inventory: waiting)
        monkeypatch.setattr(register_mod, "wait_for_uploads", wait_for_uploads)

        bodies = await harness["turn"](_ask("Was gilt?"))

        assert bodies[:2] == [StepFinishedBody(step=loading), StepFinishedBody(step=waiting)]
        assert len(waited) == 1

    async def test_the_post_answer_stages_get_the_turn_facts(self, harness):
        await harness["turn"](_ask("Wie hoch muss die Brüstung sein?"))

        (facts,) = harness["scheduled"]
        assert facts.query == "Wie hoch muss die Brüstung sein?"
        assert facts.answer == ANSWER
        assert facts.routing_decision == "shallow"
        assert facts.answer_confidence == "high"

    async def test_the_request_envelope_is_parsed_once_per_turn(self, harness):
        await harness["turn"](_ask("Was gilt?"))
        assert harness["from_context"] == 1

    async def test_a_refused_turn_delivers_one_refused_terminal_and_no_stage(self, harness, monkeypatch):
        async def refuse(agent, state, **_kwargs):
            yield TurnOutcome(state=None, refusal=TurnRefusal("Gerade zu viele Anfragen.", 15))

        monkeypatch.setattr(register_mod, "answer_turn", refuse)

        (terminal,) = await harness["turn"](_ask("Was gilt?"))

        assert terminal.outcome == "refused"
        assert terminal.result.text == "Gerade zu viele Anfragen."
        assert terminal.result.retry_after_seconds == 15
        assert harness["scheduled"] == []

    async def test_the_focus_of_one_turn_does_not_leak_into_the_next(self, harness):
        seen: list[tuple] = []

        async def shallow(state):
            seen.append((state.focus_file_name, state.focus_shelf))
            return await _shallow(state)

        await harness["turn"](_ask("fass zusammen", focus_file_name="Plan.pdf", focus_shelf="session"), shallow)
        await harness["turn"](_ask("welche OIB-Richtlinien gelten in Wien?"), shallow)

        assert seen == [("Plan.pdf", "session"), (None, None)]


class TestTurnLedgers:
    def _root(self, spans):
        return next(span for span in spans if span["kind"] == "turn")

    async def test_a_refusal_posts_the_root_span_carrying_its_outcome(self, harness, monkeypatch):
        def refuse(_organization_id):
            raise TurnAdmissionError("Gerade zu viele Anfragen.", retry_after_seconds=7)

        monkeypatch.setattr(admission_mod, "admit_turn_async", refuse)

        (terminal,) = await harness["turn"](_ask("Was gilt?"))

        assert terminal.outcome == "refused"
        assert terminal.result.text == "Gerade zu viele Anfragen."
        assert terminal.result.retry_after_seconds == 7

        spans = harness["spans"]
        root = self._root(spans)
        assert root["name"] == "chat_researcher"
        assert root["status"] == "ok"
        assert (root["metadata"] or {}).get("outcome") == "admission_refused"
        wait = next(span for span in spans if span["name"] == "admission.wait")
        assert wait["status"] == "ok"
        assert (wait["metadata"] or {}).get("refused") is True

    async def test_a_failing_setup_branch_does_not_lose_the_turn(self, harness, monkeypatch):

        def hydration_down(_conversation_id):
            raise RuntimeError("cache down")

        monkeypatch.setattr(registries_mod, "get_or_create_session_registry", hydration_down)

        bodies = await harness["turn"](_ask("Wie hoch muss die Brüstung sein?"))

        assert bodies[-1].result.text == ANSWER
        assert self._root(harness["spans"])["status"] == "ok"

    async def test_an_exception_out_of_the_turn_body_still_posts_the_ledgers(self, harness, monkeypatch):

        async def boom(*_args, **_kwargs):
            raise RuntimeError("agent down")
            yield  # pragma: no cover - an async generator that raises on its first step

        monkeypatch.setattr(register_mod, "answer_turn", boom)

        with pytest.raises(RuntimeError, match="agent down"):
            await harness["turn"](_ask("Was gilt?"))

        assert self._root(harness["spans"])["status"] == "error"


class TestTheInventoryFactsReachTheAnswer:
    async def test_the_families_and_the_cap_drops_are_bound_for_the_agent(self, harness, monkeypatch):
        from agent.knowledge.inventory import get_inventory_drops
        from agent.knowledge.inventory import get_norm_families
        from agent.knowledge.schema import AvailableDocument

        monkeypatch.setenv("AVAILABLE_DOCUMENTS_MAX", "3")
        names = ["oib-rl_2_ausgabe_mai_2023.pdf", "oib-rl_2.1_ausgabe_mai_2023.pdf"]
        names += [f"anhang_{i}.pdf" for i in range(8)]

        async def base_shelf(_collection):
            return [AvailableDocument(file_name=name) for name in names]

        monkeypatch.setattr(inventory_mod, "get_available_documents_async", base_shelf)
        seen: dict = {}

        async def shallow(state):
            seen["families"] = [(f.key, f.members) for f in get_norm_families()]
            seen["dropped"] = sum(get_inventory_drops().values())
            return await _shallow(state)

        await harness["turn"](_ask("Was gilt?"), shallow)

        assert seen == {"families": [("2", ("2", "2.1"))], "dropped": 7}


class TestTheProjectModelsReachTheToolBinding:
    async def test_the_kinds_the_bff_sent_are_bound_for_the_agent(self, harness, monkeypatch):
        from dataclasses import replace

        from agent.core import turn_tools
        from agent.turn import context as context_mod

        real_blocks = context_mod._context_blocks

        async def with_models(request, query_text):
            return replace(await real_blocks(request, query_text), project_models=frozenset({"dxf"}))

        monkeypatch.setattr(context_mod, "_context_blocks", with_models)
        seen: dict = {}

        async def shallow(state):
            seen["models"] = turn_tools._project_models.get()
            return await _shallow(state)

        turn_tools.set_project_models(None)
        await harness["turn"](_ask("Wie groß ist das Grundstück?"), shallow)

        assert seen == {"models": frozenset({"dxf"})}


class TestTheBuildingLawReachesTheCitations:
    async def test_the_role_of_a_cited_edition_is_bound_for_the_agent(self, harness, monkeypatch):
        from dataclasses import replace

        from agent.citations.entries import SourceEntry
        from agent.citations.roles import use_for_entry
        from agent.common.knowledge_context import parse_knowledge_context
        from agent.common.knowledge_context import set_turn_knowledge_context
        from agent.turn import context as context_mod

        law = parse_knowledge_context(
            {
                "gate": {"state": "core", "reason": None, "leaves": [{"country": "AT", "coverage": "core"}]},
                "retrieval": {"countries": ["AT"]},
                "text": "Building law at this site, Steiermark (AT-6, AT, EU) …",
                "chains": {"AT-6": ["AT-6", "AT", "EU"]},
                "date": "2026-11-10",
                "uses": [
                    {
                        "workId": "work:oib-rl-2",
                        "editionId": "edition:oib-rl-2-2023",
                        "role": "guidance",
                        "qualifier": None,
                        "via": "none",
                        "corpusFiles": ["oib-rl_2_ausgabe_mai_2023.pdf"],
                        "designation": "OIB-Richtlinie 2",
                        "editionLabel": "Ausgabe Mai 2023",
                    }
                ],
            }
        )
        real_blocks = context_mod._context_blocks

        async def with_law(request, query_text):
            return replace(await real_blocks(request, query_text), knowledge_context=law)

        monkeypatch.setattr(context_mod, "_context_blocks", with_law)
        cited = SourceEntry(
            citation_key="oib-rl_2_ausgabe_mai_2023.pdf, p.5", source_type="knowledge_layer", shelf="base"
        )
        seen: dict = {}

        async def shallow(state):
            use = use_for_entry(cited)
            seen["role"] = use.role if use else None
            return await _shallow(state)

        set_turn_knowledge_context(None)
        await harness["turn"](_ask("Was gilt?"), shallow)

        assert seen == {"role": "guidance"}
