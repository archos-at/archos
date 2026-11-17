from unittest.mock import AsyncMock
from unittest.mock import patch

from langchain_core.messages import HumanMessage

from agent.agents.piloti.conversation_register import ChatDeepResearcherConfig
from agent.agents.piloti.models import ConversationState
from agent.turn.commission import CommissionedRun
from agent.turn.dispatch import build_run_commissioner


def _config(**overrides):
    kwargs = {"use_async_deep_research": True}
    kwargs.update(overrides)
    return ChatDeepResearcherConfig(**kwargs)


def _state():
    return ConversationState(messages=[HumanMessage(content="Wie hoch darf die Brüstung sein?")])


class TestDispatchGate:
    def test_escalation_on_builds_a_commissioner(self):
        assert build_run_commissioner(_config()) is not None

    def test_escalation_off_answers_in_the_turn(self):
        assert build_run_commissioner(_config(use_async_deep_research=False)) is None


class TestCommissioningReachesTheTaskApi:
    async def test_the_commissioner_commissions_a_run(self):
        commissioned = CommissionedRun(run_id="run-1", run_message_id="msg-1", conversation_id="s_1")
        commission = AsyncMock(return_value=commissioned)
        with patch("agent.turn.dispatch.commission_research_run", commission):
            commissioner = build_run_commissioner(_config())
            assert commissioner is not None
            state = _state()
            state.clarifier_result = "Frage: Welches Geschoss? Antwort: Erdgeschoss."
            run = await commissioner(state)

        assert run is commissioned
        assert commission.await_count == 1
        assert commission.await_args.args[0] == "Wie hoch darf die Brüstung sein?"
        assert commission.await_args.kwargs["context"] == "Frage: Welches Geschoss? Antwort: Erdgeschoss."


class TestJobQuery:
    def test_the_preserved_query_wins(self):
        from agent.turn.dispatch import job_query

        state = ConversationState(messages=[HumanMessage(content="neu")], original_query="ursprünglich")
        assert job_query(state) == "ursprünglich"

    def test_falls_back_to_the_latest_user_message(self):
        from agent.turn.dispatch import job_query

        assert job_query(_state()) == "Wie hoch darf die Brüstung sein?"

    def test_nothing_to_research_is_an_error(self):
        import pytest

        from agent.turn.dispatch import job_query

        with pytest.raises(RuntimeError, match="without a query"):
            job_query(ConversationState(messages=[]))
