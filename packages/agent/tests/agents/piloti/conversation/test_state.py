from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage

from agent.agents.piloti.models import ConversationState


class TestConversationState:
    def test_create_state_with_messages(self):
        messages = [HumanMessage(content="Test query")]
        state = ConversationState(messages=messages)

        assert len(state.messages) == 1
        assert state.messages[0].content == "Test query"

    def test_create_state_empty_messages(self):
        state = ConversationState(messages=[])

        assert state.messages == []

    def test_state_with_user_info(self):
        state = ConversationState(
            messages=[HumanMessage(content="Test")],
            user_info={"name": "John", "preferences": {"theme": "dark"}},
        )

        assert state.user_info == {"name": "John", "preferences": {"theme": "dark"}}

    def test_state_with_routing_decision(self):
        state = ConversationState(
            messages=[HumanMessage(content="What is CUDA?")],
            routing_decision="shallow",
        )

        assert state.routing_decision == "shallow"

    def test_state_carries_no_classification(self):
        for gone in ("user_intent", "depth_decision", "routing_reason"):
            assert gone not in ConversationState.model_fields

    def test_state_carries_the_escalation_ask_as_two_plain_fields(self):
        state = ConversationState(
            messages=[HumanMessage(content="Test")],
            escalate_to_deep=True,
            escalation_ask_reason="zu breit für eine Antwort",
        )

        assert state.escalate_to_deep is True
        assert state.escalation_ask_reason == "zu breit für eine Antwort"
        assert "shallow_result" not in ConversationState.model_fields

    def test_state_carries_no_field_nothing_reads(self):
        for gone in ("final_report", "cards"):
            assert gone not in ConversationState.model_fields

    def test_state_defaults(self):
        state = ConversationState(messages=[])

        assert state.user_info is None
        assert state.routing_decision is None
        assert state.escalation_reason is None
        assert state.escalate_to_deep is None
        assert state.data_sources is None

    def test_state_with_data_sources(self):
        state = ConversationState(
            messages=[HumanMessage(content="Test")],
            data_sources=["web_search", "confluence"],
        )

        assert state.data_sources == ["web_search", "confluence"]

    def test_state_with_single_data_source(self):
        state = ConversationState(
            messages=[HumanMessage(content="Test")],
            data_sources=["sharepoint"],
        )

        assert state.data_sources == ["sharepoint"]

    def test_state_with_empty_data_sources(self):
        state = ConversationState(
            messages=[HumanMessage(content="Test")],
            data_sources=[],
        )

        assert state.data_sources == []

    def test_state_message_accumulation(self):
        state = ConversationState(
            messages=[
                HumanMessage(content="First"),
                AIMessage(content="Response"),
                HumanMessage(content="Second"),
            ]
        )

        assert len(state.messages) == 3

    def test_state_full_workflow(self):
        state = ConversationState(
            messages=[
                HumanMessage(content="What is CUDA?"),
                AIMessage(content="CUDA is a parallel computing platform."),
            ],
            user_info={"role": "developer"},
            routing_decision="shallow",
            escalate_to_deep=False,
            data_sources=["web_search", "confluence"],
        )

        assert state.routing_decision == "shallow"
        assert state.escalate_to_deep is False
        assert state.data_sources == ["web_search", "confluence"]
