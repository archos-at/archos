import pytest
from agent_testing.conversation import turn
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage

from agent.agents.deep_researcher.models import DeepResearchAgentState
from agent.core.conversation import CONVERSATION_SCOPED_FIELDS
from agent.core.conversation import TURN_SCOPED_FIELDS
from agent.core.conversation import ConversationGraph
from agent.core.markers import ESCALATION_MARKER
from agent.core.models import ClarifyResult
from agent.core.models import ConversationState
from agent.core.models import ResearchAgentState


def _research_result(messages, answer: str, *, escalating: bool = False, direct: bool = False):
    return ResearchAgentState(
        messages=list(messages) + [AIMessage(content=answer + (f"\n{ESCALATION_MARKER}" if escalating else ""))],
        escalation_requested=escalating,
        source_lookup_attempted=not direct,
    )


class TestConversationGraph:
    @pytest.fixture
    def mock_research(self):

        async def research(state_input):
            messages = state_input.messages if hasattr(state_input, "messages") else state_input
            return _research_result(messages, "Here's a quick answer with sources.")

        return research

    @pytest.fixture
    def mock_deep_research(self):

        async def deep(state):
            return DeepResearchAgentState(
                messages=list(state.messages)
                + [
                    AIMessage(content="Here's a comprehensive report."),
                ]
            )

        return deep

    @pytest.fixture
    def mock_clarifier(self):

        async def clarifier(request):
            return ClarifyResult(research_context="User clarified: technical focus", outcome="approved")

        return clarifier

    def test_init_with_defaults(self, mock_research, mock_deep_research, mock_clarifier):
        agent = ConversationGraph(
            research_fn=mock_research,
            deep_research_fn=mock_deep_research,
            clarifier_fn=mock_clarifier,
        )

        assert agent.graph is not None

    def test_graph_property(self, mock_research, mock_deep_research, mock_clarifier):
        agent = ConversationGraph(
            research_fn=mock_research,
            deep_research_fn=mock_deep_research,
            clarifier_fn=mock_clarifier,
        )

        assert agent.graph is not None

    def test_the_graph_has_no_classifier_and_starts_with_the_answering_agent(
        self, mock_research, mock_deep_research, mock_clarifier
    ):
        agent = ConversationGraph(
            research_fn=mock_research,
            deep_research_fn=mock_deep_research,
            clarifier_fn=mock_clarifier,
        )

        graph = agent.graph.get_graph()
        node_names = set(graph.nodes)
        assert "intent_classifier" not in node_names
        assert {"shallow_research", "clarifier", "deep_research"} <= node_names

        from_start = {edge.target for edge in graph.edges if edge.source == "__start__"}
        assert from_start == {"shallow_research"}

    @pytest.mark.asyncio
    async def test_a_direct_reply_is_observed_as_meta(self, mock_deep_research, mock_clarifier):

        async def direct_research(state_input):
            return _research_result(state_input.messages, "Hello! I'm an AI assistant.", direct=True)

        agent = ConversationGraph(
            research_fn=direct_research,
            deep_research_fn=mock_deep_research,
            clarifier_fn=mock_clarifier,
        )

        state = ConversationState(messages=[HumanMessage(content="Hello!")])
        result = await turn(agent, state, thread_id="test-thread")

        assert result.routing_decision == "meta"
        contents = [m.content for m in result.messages if isinstance(m, AIMessage)]
        assert "Hello! I'm an AI assistant." in contents

    @pytest.mark.asyncio
    async def test_run_shallow_research_flow(self, mock_research, mock_deep_research, mock_clarifier):
        agent = ConversationGraph(
            research_fn=mock_research,
            deep_research_fn=mock_deep_research,
            clarifier_fn=mock_clarifier,
        )

        state = ConversationState(messages=[HumanMessage(content="What is CUDA?")])
        result = await turn(agent, state, thread_id="test-thread")

        assert result is not None
        assert result.routing_decision == "shallow"

    @pytest.mark.asyncio
    async def test_run_deep_research_flow(self, mock_deep_research, mock_clarifier):

        async def escalating_research(state_input):
            return _research_result(state_input.messages, "Partial answer.", escalating=True)

        agent = ConversationGraph(
            research_fn=escalating_research,
            deep_research_fn=mock_deep_research,
            clarifier_fn=mock_clarifier,
        )

        state = ConversationState(
            messages=[HumanMessage(content="Compare CUDA vs OpenCL")],
        )
        result = await turn(agent, state, thread_id="test-thread")

        assert result is not None
        assert result.routing_decision == "deep"
        assert result.messages[-1].content == "Here's a comprehensive report."

    @pytest.mark.asyncio
    async def test_a_direct_reply_never_escalates(self, mock_clarifier):
        deep_called = False

        async def direct_research(state_input):
            return _research_result(state_input.messages, "Notiert: die Firma heißt Example and Partners.", direct=True)

        async def tracking_deep(state):
            nonlocal deep_called
            deep_called = True
            return DeepResearchAgentState(
                messages=list(state.messages)
                + [
                    AIMessage(content="Here's a comprehensive report."),
                ]
            )

        agent = ConversationGraph(
            research_fn=direct_research,
            deep_research_fn=tracking_deep,
            clarifier_fn=mock_clarifier,
        )

        state = ConversationState(
            messages=[HumanMessage(content="Remember for the whole org: the firm is Example and Partners")],
        )
        result = await turn(agent, state, thread_id="test-thread")

        assert result is not None
        assert deep_called is False, "a direct reply must not reach deep research"
        assert result.routing_decision == "meta"
        contents = [m.content for m in result.messages if isinstance(m, AIMessage)]
        assert any("Notiert" in c for c in contents), "The agent should have answered"
        assert not any("comprehensive report" in c for c in contents)

    @pytest.mark.asyncio
    async def test_run_with_empty_messages(self, mock_research, mock_deep_research, mock_clarifier):
        agent = ConversationGraph(
            research_fn=mock_research,
            deep_research_fn=mock_deep_research,
            clarifier_fn=mock_clarifier,
        )

        state = ConversationState(messages=[])
        result = await turn(agent, state, thread_id="test-thread")

        assert result is not None

    @pytest.mark.asyncio
    async def test_run_without_thread_id(self, mock_deep_research, mock_clarifier):

        async def direct_research(state_input):
            return _research_result(state_input.messages, "Hi there!", direct=True)

        agent = ConversationGraph(
            research_fn=direct_research,
            deep_research_fn=mock_deep_research,
            clarifier_fn=mock_clarifier,
        )

        state = ConversationState(messages=[HumanMessage(content="Hi")])
        result = await turn(agent, state)

        assert result is not None

    @pytest.mark.asyncio
    async def test_run_propagates_data_sources(self, mock_deep_research, mock_clarifier):
        captured_state = {}

        async def capturing_research(state_input):
            captured_state["data_sources"] = state_input.data_sources
            return _research_result(state_input.messages, "Hello!", direct=True)

        agent = ConversationGraph(
            research_fn=capturing_research,
            deep_research_fn=mock_deep_research,
            clarifier_fn=mock_clarifier,
        )

        state = ConversationState(
            messages=[HumanMessage(content="Hello!")],
            data_sources=["gdrive", "confluence"],
        )
        await turn(agent, state, thread_id="test-thread")

        assert captured_state["data_sources"] == ["gdrive", "confluence"]

    @pytest.mark.asyncio
    async def test_run_propagates_collection_scope(self, mock_deep_research, mock_clarifier):

        async def direct_research(state_input):
            return _research_result(state_input.messages, "Hello!", direct=True)

        agent = ConversationGraph(
            research_fn=direct_research,
            deep_research_fn=mock_deep_research,
            clarifier_fn=mock_clarifier,
        )

        state = ConversationState(
            messages=[HumanMessage(content="Hello!")],
            collection_scope=["oib_knowledge", "proj_project-1", "s_conv-1"],
        )
        result = await turn(agent, state, thread_id="test-thread")

        assert result.collection_scope == ["oib_knowledge", "proj_project-1", "s_conv-1"]

    @pytest.mark.asyncio
    async def test_run_propagates_none_data_sources(self, mock_deep_research, mock_clarifier):
        captured_state = {}

        async def capturing_research(state_input):
            captured_state["data_sources"] = state_input.data_sources
            return _research_result(state_input.messages, "Hello!", direct=True)

        agent = ConversationGraph(
            research_fn=capturing_research,
            deep_research_fn=mock_deep_research,
            clarifier_fn=mock_clarifier,
        )

        state = ConversationState(
            messages=[HumanMessage(content="Hello!")],
            data_sources=None,
        )
        await turn(agent, state, thread_id="test-thread")

        assert captured_state["data_sources"] is None

    @pytest.mark.asyncio
    async def test_run_propagates_empty_data_sources(self, mock_deep_research, mock_clarifier):
        captured_state = {}

        async def capturing_research(state_input):
            captured_state["data_sources"] = state_input.data_sources
            return _research_result(state_input.messages, "Hello!", direct=True)

        agent = ConversationGraph(
            research_fn=capturing_research,
            deep_research_fn=mock_deep_research,
            clarifier_fn=mock_clarifier,
        )

        state = ConversationState(
            messages=[HumanMessage(content="Hello!")],
            data_sources=[],
        )
        await turn(agent, state, thread_id="test-thread")

        assert captured_state["data_sources"] == []

    @pytest.mark.asyncio
    async def test_chat_sets_the_listing_shelf_from_the_query(self, mock_deep_research, mock_clarifier):
        from agent.knowledge.inventory import Shelf
        from agent.knowledge.inventory import get_listing_shelf

        seen: dict[str, object] = {}

        async def observing_research(state_input):
            seen["shelf"] = get_listing_shelf()
            return _research_result(state_input.messages, "In der Büroablage liegen drei Dateien.", direct=True)

        agent = ConversationGraph(
            research_fn=observing_research,
            deep_research_fn=mock_deep_research,
            clarifier_fn=mock_clarifier,
        )

        await turn(
            agent,
            ConversationState(messages=[HumanMessage(content="welche Dateien hast du in der Büroablage")]),
            thread_id="t",
        )
        assert seen["shelf"] == Shelf.OFFICE_SHELF

        await turn(
            agent,
            ConversationState(messages=[HumanMessage(content="was sagt OIB-RL 2 zum Brandschutz")]),
            thread_id="t2",
        )
        assert seen["shelf"] is None


class TestRoutingBoundary:
    @pytest.fixture
    def trackers(self):
        calls = {"research": False, "deep": False, "clarifier": False}

        def research_answering(answer: str, *, escalating: bool = False, direct: bool = False):
            async def research(state_input):
                calls["research"] = True
                messages = state_input.messages if hasattr(state_input, "messages") else state_input
                return _research_result(messages, answer, escalating=escalating, direct=direct)

            return research

        async def deep(state):
            calls["deep"] = True
            return DeepResearchAgentState(
                messages=list(state.messages) + [AIMessage(content="Here's a comprehensive report.")]
            )

        async def clarifier(request):
            calls["clarifier"] = True
            return ClarifyResult(research_context="clarified", outcome="approved")

        return calls, research_answering, deep, clarifier

    @pytest.mark.asyncio
    async def test_out_of_scope_is_answered_by_chat(self, trackers):
        calls, research_answering, deep, clarifier = trackers

        agent = ConversationGraph(
            research_fn=research_answering("Das liegt außerhalb meines Fachgebiets. …", direct=True),
            deep_research_fn=deep,
            clarifier_fn=clarifier,
        )
        state = ConversationState(messages=[HumanMessage(content="How do I bake a cake?")])
        result = await turn(agent, state, thread_id="t")

        assert calls["research"] is True, "The agent answers every turn, off-topic ones included"
        assert calls["deep"] is False
        assert calls["clarifier"] is False
        assert result.routing_decision == "meta"
        contents = [m.content for m in result.messages if isinstance(m, AIMessage)]
        assert any("Fachgebiet" in c for c in contents)

    @pytest.mark.asyncio
    async def test_well_specified_shallow_answers_without_overclarifying(self, trackers):
        calls, research_answering, deep, clarifier = trackers

        agent = ConversationGraph(
            research_fn=research_answering("Here's a quick answer with sources."),
            deep_research_fn=deep,
            clarifier_fn=clarifier,
        )
        state = ConversationState(messages=[HumanMessage(content="Was regelt die OIB-Richtlinie 2?")])
        result = await turn(agent, state, thread_id="t")

        assert calls["research"] is True
        assert calls["clarifier"] is False, "a well-specified shallow question must not be sent to the clarifier"
        assert calls["deep"] is False
        assert result.routing_decision == "shallow"

    @pytest.mark.asyncio
    async def test_an_escalating_shallow_result_routes_through_clarifier(self, trackers):
        calls, research_answering, deep, clarifier = trackers

        agent = ConversationGraph(
            research_fn=research_answering("Das braucht eine breitere Recherche.", escalating=True),
            deep_research_fn=deep,
            clarifier_fn=clarifier,
        )
        state = ConversationState(
            messages=[HumanMessage(content="Vergleiche die OIB-2-Anforderungen über alle Gebäudeklassen")],
        )
        result = await turn(agent, state, thread_id="t")

        assert calls["research"] is True, "every turn starts with the answering agent"
        assert calls["clarifier"] is True, "an escalation must pass through the clarifier"
        assert calls["deep"] is True
        assert result.routing_decision == "deep"


class TestAppendContextMessage:
    @pytest.fixture
    def trackers(self):
        calls: list[str] = []

        async def research(state_input):
            calls.append("research")
            messages = state_input.messages if hasattr(state_input, "messages") else state_input
            return _research_result(messages, "Quick answer.")

        async def deep(state):
            calls.append("deep")
            return DeepResearchAgentState(messages=list(state.messages))

        return calls, research, deep

    def _agent(self, trackers) -> ConversationGraph:
        from langgraph.checkpoint.memory import InMemorySaver

        _calls, research, deep = trackers
        return ConversationGraph(
            research_fn=research,
            deep_research_fn=deep,
            clarifier_fn=None,
            checkpointer=InMemorySaver(),
        )

    @pytest.mark.asyncio
    async def test_appends_to_the_checkpoint_without_running_a_node(self, trackers):
        calls, *_ = trackers
        agent = self._agent(trackers)

        await agent.append_context_message("conv-1", "Anna Weber: Ja, eigener Abschnitt.")

        snapshot = await agent.graph.aget_state({"configurable": {"thread_id": "conv-1"}})
        assert [m.content for m in snapshot.values["messages"]] == ["Anna Weber: Ja, eigener Abschnitt."]
        assert calls == []

    @pytest.mark.asyncio
    async def test_the_next_real_turn_sees_the_ingested_context(self, trackers):
        calls, *_ = trackers
        agent = self._agent(trackers)

        await turn(
            agent,
            ConversationState(messages=[HumanMessage(content="Ist das Atrium ein eigener Abschnitt?")]),
            thread_id="conv-1",
        )
        after_turn_one = list(calls)
        await agent.append_context_message("conv-1", "Matthias Bigl: @Anna Weber weißt du das?")
        await agent.append_context_message("conv-1", "Anna Weber: Ja, laut Einreichplan eigener Abschnitt.")
        assert calls == after_turn_one, "ingestion must not have run a single node"

        seen: list[str] = []

        async def capture_research(state_input):
            messages = state_input.messages if hasattr(state_input, "messages") else state_input
            seen.extend(str(m.content) for m in messages)
            return _research_result(messages, "Neu geprüft.")

        agent.research_fn = capture_research
        await turn(
            agent,
            ConversationState(messages=[HumanMessage(content="@Agent given that, recheck")]),
            thread_id="conv-1",
        )

        assert "Anna Weber: Ja, laut Einreichplan eigener Abschnitt." in seen
        assert "Matthias Bigl: @Anna Weber weißt du das?" in seen

    @pytest.mark.asyncio
    async def test_a_missing_thread_or_text_is_a_no_op(self, trackers):
        calls, *_ = trackers
        agent = self._agent(trackers)

        await agent.append_context_message("", "Anna: ja")
        await agent.append_context_message("conv-1", "")

        snapshot = await agent.graph.aget_state({"configurable": {"thread_id": "conv-1"}})
        assert snapshot.values == {} or not snapshot.values.get("messages")
        assert calls == []


async def _unused(state):  # pragma: no cover - the route never reaches it
    raise AssertionError("must not be called")


class TestTurnBoundary:
    def test_the_reset_set_is_every_field_that_is_not_conversation_scoped(self):
        assert CONVERSATION_SCOPED_FIELDS == {"messages", "deep_research_declined", "already_read_digest"}
        assert TURN_SCOPED_FIELDS == set(ConversationState.model_fields) - CONVERSATION_SCOPED_FIELDS

    @pytest.mark.asyncio
    async def test_in_flight_documents_reach_chat_agent(self):
        seen: dict[str, object] = {}

        async def research(state_input):
            seen["in_flight"] = state_input.in_flight_documents
            return _research_result(state_input.messages, "Die Datei wird noch gelesen.", direct=True)

        agent = ConversationGraph(research_fn=research, deep_research_fn=_unused, clarifier_fn=None)
        await turn(
            agent,
            ConversationState(messages=[HumanMessage(content="Was steht im Plan?")], in_flight_documents=["plan.pdf"]),
            thread_id="t",
        )

        assert seen["in_flight"] == ["plan.pdf"]

    @pytest.mark.asyncio
    async def test_run_returns_the_typed_state(self):
        async def research(state_input):
            return _research_result(state_input.messages, "Antwort [1].")

        agent = ConversationGraph(research_fn=research, deep_research_fn=_unused, clarifier_fn=None)
        result = await turn(agent, ConversationState(messages=[HumanMessage(content="Was gilt?")]), thread_id="t")
        assert isinstance(result, ConversationState)


class TestEscalation:
    def test_only_an_explicit_ask_escalates(self):
        assert ConversationState(messages=[], escalate_to_deep=True).escalate_to_deep is True
        assert not ConversationState(messages=[], escalate_to_deep=False).escalate_to_deep
        assert not ConversationState(messages=[]).escalate_to_deep

    @pytest.mark.asyncio
    async def test_insufficiency_prose_alone_is_not_an_ask(self):

        async def research(state_input):
            return _research_result(state_input.messages, "Ich konnte keine Informationen dazu finden.")

        agent = ConversationGraph(research_fn=research, deep_research_fn=_unused, clarifier_fn=_unused)
        result = await turn(agent, ConversationState(messages=[HumanMessage(content="Was gilt?")]), thread_id="t")

        assert not result.escalate_to_deep
        assert result.routing_decision == "shallow"


class TestTheWholeTurnIsWrittenBack:
    async def test_tool_results_reach_the_conversation_and_the_answer_stays_last(self):
        from langchain_core.messages import ToolMessage

        from agent.core.conversation import _finalize_answer

        call = {"name": "read_passage", "args": {"document": "OIB-RL 2"}, "id": "c1"}
        turn = [
            AIMessage(content="", tool_calls=[call]),
            ToolMessage(content="Passage aus OIB-RL 2", tool_call_id="c1", name="read_passage"),
            AIMessage(content="Die Antwort."),
        ]
        result = ResearchAgentState(messages=[HumanMessage(content="Q"), *turn], source_lookup_attempted=True)

        update = _finalize_answer(turn[-1], result, turn_messages=turn)

        assert [type(m).__name__ for m in update["messages"]] == ["AIMessage", "ToolMessage", "AIMessage"]
        assert update["messages"][-1].content == "Die Antwort."
        assert update["messages"][1].content == "Passage aus OIB-RL 2"

    async def test_the_written_back_results_are_cut_to_the_cited_passages(self):
        from langchain_core.messages import ToolMessage

        from agent.core.conversation import _finalize_answer
        from agent.core.history import UNCITED_PASSAGE_NOTE

        call = {"name": "knowledge_search", "args": {"query": "REI"}, "id": "c1"}
        content = (
            "Found 2 relevant document(s):\n\n"
            "--- Result 1 ---\nSource: OIB 2\nCitation: oib-rl_2.pdf, p.1\n\nREI 60.\n\n"
            "--- Result 2 ---\nSource: OIB 2\nCitation: oib-rl_2.pdf, p.9\n\nNie zitiert.\n"
        )
        turn = [
            AIMessage(content="", tool_calls=[call]),
            ToolMessage(content=content, tool_call_id="c1", name="knowledge_search"),
            AIMessage(content="REI 60 [1]."),
        ]
        result = ResearchAgentState(
            messages=[HumanMessage(content="Q"), *turn],
            source_lookup_attempted=True,
            verified_sources=[{"number": 1, "citation_key": "oib-rl_2.pdf, p.1"}],
        )

        update = _finalize_answer(turn[-1], result, turn_messages=turn)

        kept = update["messages"][1].content
        assert "REI 60." in kept and "Nie zitiert." not in kept
        assert "Citation: oib-rl_2.pdf, p.9" in kept and UNCITED_PASSAGE_NOTE in kept

    @staticmethod
    def _graph():
        async def research(state_input):
            return _research_result(state_input.messages, "x")

        async def deep(state):
            return DeepResearchAgentState(messages=list(state.messages))

        async def clarifier(request):
            return ClarifyResult(research_context="", outcome="approved")

        return ConversationGraph(research_fn=research, deep_research_fn=deep, clarifier_fn=clarifier)

    @staticmethod
    def _transcript(completed: int) -> list:
        from langchain_core.messages import ToolMessage

        messages = []
        for index in range(completed):
            call = {"name": "read_passage", "args": {"document": "OIB-RL 2"}, "id": f"c{index}"}
            messages += [
                HumanMessage(content=f"Q{index}"),
                AIMessage(content="", tool_calls=[call]),
                ToolMessage(content=f"P{index}", tool_call_id=f"c{index}", name="read_passage"),
                AIMessage(content=f"A{index}"),
            ]
        return [*messages, HumanMessage(content="und in GK 4?")]

    def test_the_next_turns_history_prunes_older_turns_a_batch_at_a_time(self):
        from agent.core.history import PRUNE_BATCH_TURNS

        completed = PRUNE_BATCH_TURNS + 1
        trimmed = self._graph()._trimmed(ConversationState(messages=self._transcript(completed)))

        contents = [m.content for m in trimmed]
        assert f"P{completed - 1}" in contents
        assert not any(f"P{index}" in contents for index in range(PRUNE_BATCH_TURNS))
        assert contents[:2] == ["Q0", "A0"]

    def test_between_two_batches_the_older_results_stay(self):
        trimmed = self._graph()._trimmed(ConversationState(messages=self._transcript(2)))

        contents = [m.content for m in trimmed]
        assert "P0" in contents and "P1" in contents


class TestAFollowUpAnsweredFromTheTranscript:
    async def test_a_previous_turns_search_is_not_this_turns_lookup(self):
        from langchain_core.messages import ToolMessage

        from agent.citations.registry import SourceRegistry
        from agent.core.answer_pipeline import finalize_answer

        call = {"name": "knowledge_search", "args": {"query": "Fluchtweg"}, "id": "c1"}
        messages = [
            HumanMessage(content="Wie lang darf der Fluchtweg sein?"),
            AIMessage(content="", tool_calls=[call]),
            ToolMessage(content="Keine Treffer.", tool_call_id="c1", name="knowledge_search"),
            AIMessage(content="Dazu habe ich nichts gefunden."),
            HumanMessage(content="Und in GK 4?"),
            AIMessage(content="Auch dazu liegt nichts vor; die Frage bleibt offen."),
        ]

        final = await finalize_answer(messages, registry=SourceRegistry(), tools=[], repair=None)

        assert final.answered and not final.source_lookup_attempted
