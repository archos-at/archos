"""The old module path of the agent resolves to agent.core: drop after release 2026-W48."""

import importlib


def test_the_old_module_path_yields_the_moved_class_itself():
    from agent.core.agent import ChatAgent

    old = importlib.import_module("agent.agents.piloti.agent")

    assert old.ChatAgent is ChatAgent
    assert importlib.import_module("agent.agents.piloti") is importlib.import_module("agent.core")


def test_a_queued_job_with_the_old_class_path_loads_the_moved_class():
    from agent.core.agent import ChatAgent

    module_path, class_name = "agent.agents.piloti.agent.ChatAgent".rsplit(".", 1)

    assert getattr(importlib.import_module(module_path), class_name) is ChatAgent


def test_a_checkpointed_type_restores_under_its_old_module_path():
    from agent.core.models.state import ResearchAgentState

    old = importlib.import_module("agent.agents.piloti.models.state")

    assert old.ResearchAgentState is ResearchAgentState
