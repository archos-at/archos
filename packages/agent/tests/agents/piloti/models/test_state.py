from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage

from agent.agents.piloti.models import ResearchAgentState


class TestResearchAgentState:
    def test_create_state_with_messages(self):
        messages = [HumanMessage(content="Test query")]
        state = ResearchAgentState(messages=messages)

        assert len(state.messages) == 1
        assert state.messages[0].content == "Test query"

    def test_create_state_empty_messages(self):
        state = ResearchAgentState(messages=[])

        assert state.messages == []

    def test_state_with_user_info(self):
        state = ResearchAgentState(
            messages=[HumanMessage(content="Test")],
            user_info={"name": "John", "role": "developer"},
        )

        assert state.user_info == {"name": "John", "role": "developer"}

    def test_state_with_tools_info(self):
        tools_info = [
            {"name": "web_search", "description": "Search the web"},
            {"name": "doc_search", "description": "Search documents"},
        ]
        state = ResearchAgentState(
            messages=[HumanMessage(content="Test")],
            tools_info=tools_info,
        )

        assert state.tools_info == tools_info
        assert len(state.tools_info) == 2

    def test_state_defaults(self):
        state = ResearchAgentState(messages=[])

        assert state.user_info is None
        assert state.tools_info is None

    def test_state_message_accumulation(self):
        state = ResearchAgentState(
            messages=[
                HumanMessage(content="First"),
                AIMessage(content="Response"),
                HumanMessage(content="Second"),
            ]
        )

        assert len(state.messages) == 3

    def test_state_full_workflow(self):
        state = ResearchAgentState(
            messages=[
                HumanMessage(content="What is CUDA?"),
                AIMessage(content="CUDA is a parallel computing platform."),
            ],
            user_info={"role": "developer"},
            tools_info=[{"name": "web_search", "description": "Search"}],
        )

        assert state.user_info["role"] == "developer"
        assert len(state.tools_info) == 1
