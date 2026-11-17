from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage

from agent.agents.deep_researcher.models import DeepResearchAgentState


class TestDeepResearchAgentState:
    def test_create_state_with_messages(self):
        messages = [HumanMessage(content="Test query")]
        state = DeepResearchAgentState(messages=messages)

        assert len(state.messages) == 1
        assert state.messages[0].content == "Test query"

    def test_create_state_empty_messages(self):
        state = DeepResearchAgentState(messages=[])

        assert state.messages == []

    def test_state_with_user_info(self):
        state = DeepResearchAgentState(
            messages=[HumanMessage(content="Test")],
            user_info={"name": "John", "role": "developer"},
        )

        assert state.user_info == {"name": "John", "role": "developer"}

    def test_state_ignores_fields_it_no_longer_declares(self):
        state = DeepResearchAgentState(
            messages=[HumanMessage(content="Test")],
            tools_info=[{"name": "web_search", "description": "Search the web"}],
            subagents=[],
            rubric="x",
        )

        assert not hasattr(state, "tools_info")
        assert not hasattr(state, "rubric")

    def test_state_with_todos(self):
        todos = [
            {"id": "1", "task": "Research topic A", "status": "pending"},
            {"id": "2", "task": "Research topic B", "status": "done"},
        ]
        state = DeepResearchAgentState(
            messages=[HumanMessage(content="Test")],
            todos=todos,
        )

        assert state.todos == todos

    def test_state_with_files(self):
        files = {
            "report.md": "# Research Report\n\nContent here...",
            "notes.txt": "Some notes",
        }
        state = DeepResearchAgentState(
            messages=[HumanMessage(content="Test")],
            files=files,
        )

        assert state.files == files

    def test_state_defaults(self):
        state = DeepResearchAgentState(messages=[])

        assert state.user_info is None
        assert state.todos == []
        assert state.files == {}

    def test_state_message_accumulation(self):
        state = DeepResearchAgentState(
            messages=[
                HumanMessage(content="First message"),
                AIMessage(content="Response"),
                HumanMessage(content="Second message"),
            ]
        )

        assert len(state.messages) == 3

    def test_state_model_validate(self):
        data = {
            "messages": [{"type": "human", "content": "Test"}],
            "user_info": {"name": "Test User"},
        }

        state = DeepResearchAgentState.model_validate(data)

        assert state.user_info == {"name": "Test User"}
