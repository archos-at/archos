from __future__ import annotations

import importlib
import logging
from typing import Any

from agent.common.plan_documents import PlanDocuments

from .event_store import EventStore
from .job_cancellation import CancellationMonitor
from .job_cancellation import run_with_cancellation

logger = logging.getLogger(__name__)


async def _run_agent(
    agent,
    input_text: str,
    monitor: CancellationMonitor,
    available_documents: list[dict] | None = None,
    data_sources: list[str] | None = None,
    event_store: EventStore | None = None,
    user_info: dict | None = None,
    clarifier_result: str | None = None,
    plan_documents: PlanDocuments | None = None,
    project_context: str | None = None,
    platform_lessons: str | None = None,
    organization_id: str | None = None,
) -> Any:
    import inspect

    if not hasattr(agent, "run"):
        raise TypeError(f"Agent {type(agent).__name__} does not have a run method")
    params = list(inspect.signature(agent.run).parameters)
    if params and params[0] in ("input_text", "query", "input"):
        return await run_with_cancellation(agent.run(input_text), monitor, event_store=event_store)
    fields = {
        "user_info": user_info,
        "clarifier_result": clarifier_result,
        "plan_documents": plan_documents,
        "project_context": project_context,
        "platform_lessons": platform_lessons,
        "organization_id": organization_id,
    }
    state_cls = _get_agent_state_class(agent)
    if state_cls:
        state = _model_state(state_cls, input_text, data_sources, available_documents, fields)
    else:
        state = _dict_state(input_text, data_sources, available_documents, fields)
    return await _run_with_reader_controls(agent, state, monitor, event_store)


def _model_state(state_cls: type, input_text: str, data_sources, available_documents, fields: dict) -> Any:
    from langchain_core.messages import HumanMessage

    state_kwargs: dict[str, Any] = {"messages": [HumanMessage(content=input_text)]}
    if data_sources is not None:
        state_kwargs["data_sources"] = data_sources
    declared = getattr(state_cls, "model_fields", {})
    state_kwargs.update({name: value for name, value in fields.items() if value is not None and name in declared})
    if available_documents:
        try:
            from agent.knowledge import AvailableDocument

            state_kwargs["available_documents"] = [AvailableDocument(**doc) for doc in available_documents]
            logger.debug("Research worker passing %d available documents to agent state", len(available_documents))
        except ImportError, TypeError:
            pass
    return state_cls(**state_kwargs)


def _dict_state(input_text: str, data_sources, available_documents, fields: dict) -> dict[str, Any]:
    from langchain_core.messages import HumanMessage

    state: dict[str, Any] = {"messages": [HumanMessage(content=input_text)]}
    if data_sources is not None:
        state["data_sources"] = data_sources
    if available_documents:
        state["available_documents"] = available_documents
    for name in ("user_info", "clarifier_result", "project_context", "platform_lessons"):
        if fields[name] is not None:
            state[name] = fields[name]
    return state


async def _run_with_reader_controls(agent, state: Any, monitor: CancellationMonitor, event_store) -> Any:
    from agent.agents.deep_researcher.control import bind_added_documents
    from agent.agents.deep_researcher.control import bind_write_now
    from agent.agents.deep_researcher.control import reset_added_documents
    from agent.agents.deep_researcher.control import reset_write_now

    token = bind_write_now(monitor.write_now)
    added_token = bind_added_documents(monitor.added_documents)
    try:
        return await run_with_cancellation(agent.run(state), monitor, event_store=event_store)
    finally:
        reset_added_documents(added_token)
        reset_write_now(token)


def _get_agent_state_class(agent) -> type | None:
    declared = getattr(type(agent), "state_model", None)
    if isinstance(declared, type):
        return declared

    agent_module = type(agent).__module__
    agent_name = type(agent).__name__

    state_name_patterns = [
        "AgentState",
        f"{agent_name}State",
        f"{agent_name.replace('Agent', '')}AgentState",  # DeepResearcher -> DeepResearcherAgentState
        f"{agent_name.replace('erAgent', '')}AgentState",  # DeepResearcherAgent -> DeepResearchAgentState
        "State",
    ]

    try:
        # nosemgrep: python.lang.security.audit.non-literal-import.non-literal-import
        models_module = importlib.import_module(agent_module.replace(".agent", ".models"))
        name = _declared_state_name(models_module, state_name_patterns)
        if name is not None:
            return getattr(models_module, name)
        found = _message_state(models_module)
        if found is not None:
            return found
    except ImportError, AttributeError:
        pass

    try:
        # nosemgrep: python.lang.security.audit.non-literal-import.non-literal-import
        module = importlib.import_module(agent_module)
        name = _declared_state_name(module, state_name_patterns)
        if name is not None:
            return getattr(module, name)
    except ImportError:
        pass

    return None


def _declared_state_name(module: Any, patterns: list[str]) -> str | None:
    return next((name for name in patterns if hasattr(module, name)), None)


def _message_state(module: Any) -> type | None:
    for name in dir(module):
        if not name.endswith("State") or name.startswith("_"):
            continue
        cls = getattr(module, name)
        if isinstance(cls, type) and hasattr(cls, "model_fields") and "messages" in cls.model_fields:
            return cls
    return None
