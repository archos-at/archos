from agent.common.agent_kind import AGENT_KIND
from agent.common.agent_kind import AGENT_KINDS
from agent.common.agent_kind import is_agent_kind
from agent.common.legacy_agent_kind import LEGACY_AGENT_KIND


def test_the_new_value_and_the_old_one_are_both_the_agent():
    assert is_agent_kind(AGENT_KIND)
    assert is_agent_kind(LEGACY_AGENT_KIND)
    assert AGENT_KINDS == (AGENT_KIND, LEGACY_AGENT_KIND)


def test_a_person_and_anything_else_is_not_the_agent():
    assert not is_agent_kind("person")
    assert not is_agent_kind(None)
    assert not is_agent_kind("")
