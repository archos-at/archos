from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest
from langchain_core.messages import HumanMessage
from langchain_core.tools import tool

import agent.core.register as register_module
from agent.common import request_llm_context
from agent.core.models import ResearchAgentState
from agent.core.register import ResearchAgentConfig
from agent.core.register import research_agent
from tests.provider_doubles import NAT_LLM_CONFIG
from tests.provider_doubles import nat_langchain_client


@tool(description="Search the web.")
def web_search_tool(query: str) -> str:
    return f"results: {query}"


class _FakeBuilder:
    def __init__(self, tools_by_name):
        self._tools_by_name = tools_by_name
        self.get_tools_calls = []

    async def get_tools(self, tool_names, wrapper_type):
        self.get_tools_calls.append(list(tool_names))
        return [self._tools_by_name[n] for n in tool_names if n in self._tools_by_name]

    async def get_llm(self, ref, wrapper_type):
        return nat_langchain_client(MagicMock())

    def get_llm_config(self, ref):
        return NAT_LLM_CONFIG


def _make_agent_stub():

    def _factory(*args, **kwargs):
        agent = MagicMock()
        agent.run = AsyncMock(side_effect=lambda state, turn=None: state)
        agent.build_tools = kwargs.get("tools")
        agent.init_kwargs = kwargs
        built.append(agent)
        return agent

    built: list = []
    _factory.built = built
    return _factory


async def _get_run_fn(config, builder):
    gen = research_agent.__wrapped__(config, builder)
    function_info = await gen.__anext__()
    return function_info.single_fn, gen


def _skill(name: str):
    skill = MagicMock()
    skill.name = name
    return skill


def _skill_runtime(resolved, *, activated=()):
    from agent.skills.backend import SkillsBackend

    runtime = MagicMock()
    runtime.prompt_block.return_value = "## Skills"
    runtime.backend = SkillsBackend({})
    runtime.activated = list(activated)
    runtime.skills = tuple(resolved)
    runtime.pinned = ()
    runtime.hidden_activated = ()
    runtime.record_applied = MagicMock(return_value=())
    return runtime


def _patch_runtime(runtime):
    cls = MagicMock()
    cls.office.return_value = runtime
    return patch.object(register_module, "SkillRuntime", cls)


@pytest.mark.asyncio
async def test_research_turn_resolves_allows_and_folds_skill_tool():
    builder = _FakeBuilder({"web_search_tool": web_search_tool})
    config = ResearchAgentConfig(
        llm="research_llm",
        tools=["web_search_tool"],
        skills_enabled=True,
    )
    resolved = (_skill("forecast-analysis"), _skill("data-table-analysis"))
    runtime = _skill_runtime(resolved, activated=["forecast-analysis"])
    stub = _make_agent_stub()

    with (
        patch.object(register_module, "ChatAgent", stub),
        patch.object(register_module, "get_organization_id_from_context", return_value="org-1"),
        _patch_runtime(runtime) as RuntimeCls,
        patch.object(register_module, "SkillResolver") as ResolverCls,
    ):
        resolver = ResolverCls.return_value
        resolver.resolve.return_value = resolved

        run_fn, gen = await _get_run_fn(config, builder)

        state = ResearchAgentState(messages=[HumanMessage(content="/forecast-analysis für das Projekt?")])
        result = await run_fn(state)

        ResolverCls.assert_called_once_with(agent="researcher")
        resolver.resolve.assert_called_once_with("org-1")
        RuntimeCls.office.assert_called_once_with(resolved)

        assert len(stub.built) == 1
        turn = stub.built[0].run.await_args.kwargs["turn"]
        assert [getattr(t, "name", None) for t in turn.tools] == ["web_search_tool", "read_file"]
        assert state.skills_block == "## Skills"
        assert result.skills_activated == ["forecast-analysis"]
        await gen.aclose()


@pytest.mark.asyncio
async def test_the_catalog_is_announced_before_the_llm_runs():
    builder = _FakeBuilder({"web_search_tool": web_search_tool})
    config = ResearchAgentConfig(
        llm="research_llm",
        tools=["web_search_tool"],
        skills_enabled=True,
    )
    resolved = (_skill("forecast-analysis"),)
    runtime = _skill_runtime(resolved, activated=["forecast-analysis"])
    announced = []

    with (
        patch.object(register_module, "ChatAgent", _make_agent_stub()),
        patch.object(register_module, "get_organization_id_from_context", return_value="org-1"),
        _patch_runtime(runtime),
        patch.object(register_module, "SkillResolver") as ResolverCls,
        patch.object(register_module, "emit_skills_offered", side_effect=lambda rt: announced.append(rt)),
    ):
        ResolverCls.return_value.resolve.return_value = resolved

        run_fn, gen = await _get_run_fn(config, builder)
        await run_fn(ResearchAgentState(messages=[HumanMessage(content="run forecast-analysis")]))

        assert announced == [runtime]
        await gen.aclose()


@pytest.mark.asyncio
async def test_a_turn_without_skills_announces_nothing():
    builder = _FakeBuilder({"web_search_tool": web_search_tool})
    config = ResearchAgentConfig(
        llm="research_llm",
        tools=["web_search_tool"],
        skills_enabled=True,
    )
    announced = []

    with (
        patch.object(register_module, "ChatAgent", _make_agent_stub()),
        patch.object(register_module, "get_organization_id_from_context", return_value="org-1"),
        patch.object(register_module, "SkillResolver") as ResolverCls,
        patch.object(register_module, "emit_skills_offered", side_effect=lambda rt: announced.append(rt)),
    ):
        ResolverCls.return_value.resolve.return_value = ()

        run_fn, gen = await _get_run_fn(config, builder)
        state = ResearchAgentState(messages=[HumanMessage(content="hallo")])
        await run_fn(state)

        assert announced == []
        await gen.aclose()


@pytest.mark.asyncio
async def test_a_mentioned_skill_is_offered_like_any_other():
    builder = _FakeBuilder({"web_search_tool": web_search_tool})
    config = ResearchAgentConfig(
        llm="research_llm",
        tools=["web_search_tool"],
        skills_enabled=True,
    )
    resolved = (_skill("forecast-analysis"),)
    runtime = _skill_runtime(resolved, activated=["forecast-analysis"])

    with (
        patch.object(register_module, "ChatAgent", _make_agent_stub()),
        patch.object(register_module, "get_organization_id_from_context", return_value="org-1"),
        _patch_runtime(runtime) as RuntimeCls,
        patch.object(register_module, "SkillResolver") as ResolverCls,
    ):
        resolver = ResolverCls.return_value
        resolver.resolve.return_value = resolved

        run_fn, gen = await _get_run_fn(config, builder)

        state = ResearchAgentState(messages=[HumanMessage(content="/forecast-analysis und jetzt?")])
        result = await run_fn(state)

        ResolverCls.assert_called_once_with(agent="researcher")
        RuntimeCls.office.assert_called_once_with(resolved)
        assert result.skills_activated == ["forecast-analysis"]
        await gen.aclose()


@pytest.mark.asyncio
async def test_skills_disabled_skips_resolution():
    builder = _FakeBuilder({"web_search_tool": web_search_tool})
    config = ResearchAgentConfig(
        llm="research_llm",
        tools=["web_search_tool"],
        skills_enabled=False,
    )

    with (
        patch.object(register_module, "ChatAgent", _make_agent_stub()),
        patch.object(register_module, "SkillResolver") as ResolverCls,
    ):
        run_fn, gen = await _get_run_fn(config, builder)

        state = ResearchAgentState(messages=[HumanMessage(content="run forecast-analysis")])
        await run_fn(state)

        ResolverCls.assert_not_called()
        await gen.aclose()


@pytest.mark.asyncio
async def test_allowlist_narrows_resolved_set():
    builder = _FakeBuilder({"web_search_tool": web_search_tool})
    config = ResearchAgentConfig(
        llm="research_llm",
        tools=["web_search_tool"],
        skills_enabled=True,
        skill_allowlist=["forecast-analysis"],
    )
    resolved = (_skill("forecast-analysis"), _skill("data-table-analysis"))
    runtime = _skill_runtime((resolved[0],))

    with (
        patch.object(register_module, "ChatAgent", _make_agent_stub()),
        patch.object(register_module, "get_organization_id_from_context", return_value="org-1"),
        _patch_runtime(runtime) as RuntimeCls,
        patch.object(register_module, "SkillResolver") as ResolverCls,
    ):
        resolver = ResolverCls.return_value
        resolver.resolve.return_value = resolved

        run_fn, gen = await _get_run_fn(config, builder)
        state = ResearchAgentState(messages=[HumanMessage(content="question")])
        await run_fn(state)

        resolver.resolve.assert_called_once_with("org-1")
        RuntimeCls.office.assert_called_once_with((resolved[0],))
        await gen.aclose()


@pytest.mark.asyncio
async def test_a_name_the_allowlist_dropped_is_simply_not_in_the_catalog():
    builder = _FakeBuilder({"web_search_tool": web_search_tool})
    config = ResearchAgentConfig(
        llm="research_llm",
        tools=["web_search_tool"],
        skill_allowlist=["forecast-analysis"],
    )
    resolved = (_skill("forecast-analysis"), _skill("mystery-skill"))
    runtime = _skill_runtime(resolved[:1])

    with (
        patch.object(register_module, "ChatAgent", _make_agent_stub()),
        patch.object(register_module, "get_organization_id_from_context", return_value="org-1"),
        _patch_runtime(runtime) as RuntimeCls,
        patch.object(register_module, "SkillResolver") as ResolverCls,
    ):
        resolver = ResolverCls.return_value
        resolver.resolve.return_value = resolved

        run_fn, gen = await _get_run_fn(config, builder)
        await run_fn(ResearchAgentState(messages=[HumanMessage(content="/mystery-skill bitte")]))

        RuntimeCls.office.assert_called_once_with((resolved[0],))
        await gen.aclose()


@pytest.mark.asyncio
async def test_the_turn_config_reserves_nothing_on_top_of_the_budget():
    builder = _FakeBuilder({"web_search_tool": web_search_tool})
    config = ResearchAgentConfig(
        llm="research_llm",
        tools=["web_search_tool"],
        skills_enabled=True,
        max_tool_iterations=7,
    )
    resolved = (_skill("piloti-voice"), _skill("piloti-cards"))
    runtime = _skill_runtime(resolved)
    stub = _make_agent_stub()

    with (
        patch.object(register_module, "ChatAgent", stub),
        patch.object(register_module, "get_organization_id_from_context", return_value="org-1"),
        _patch_runtime(runtime),
        patch.object(register_module, "SkillResolver") as ResolverCls,
    ):
        ResolverCls.return_value.resolve.return_value = resolved

        run_fn, gen = await _get_run_fn(config, builder)
        await run_fn(ResearchAgentState(messages=[HumanMessage(content="Wie tief?")]))

        assert stub.built[-1].init_kwargs["max_tool_iterations"] == 7
        assert "reserved_tool_iterations" not in stub.built[-1].init_kwargs
        turn = stub.built[-1].run.await_args.kwargs["turn"]
        assert not hasattr(turn, "reserved_tool_iterations")
        await gen.aclose()


@pytest.mark.asyncio
async def test_only_what_was_delivered_is_reported_as_used(caplog):
    builder = _FakeBuilder({"web_search_tool": web_search_tool})
    config = ResearchAgentConfig(llm="research_llm", tools=["web_search_tool"], skills_enabled=True)
    resolved = (_skill("piloti-voice"), _skill("piloti-cards"))
    runtime = _skill_runtime(resolved, activated=["piloti-voice"])

    with (
        patch.object(register_module, "ChatAgent", _make_agent_stub()),
        patch.object(register_module, "get_organization_id_from_context", return_value="org-1"),
        _patch_runtime(runtime),
        patch.object(register_module, "SkillResolver") as ResolverCls,
    ):
        ResolverCls.return_value.resolve.return_value = resolved

        run_fn, gen = await _get_run_fn(config, builder)
        result = await run_fn(ResearchAgentState(messages=[HumanMessage(content="Wie tief?")]))

        assert result.skills_activated == ["piloti-voice"]
        assert not [m for m in caplog.messages if "never loaded" in m]
        await gen.aclose()


@pytest.mark.asyncio
async def test_the_model_credential_and_zdr_lookups_overlap():
    import threading
    import time

    builder = _FakeBuilder({"web_search_tool": web_search_tool})
    config = ResearchAgentConfig(llm="research_llm", tools=["web_search_tool"], skills_enabled=False)
    in_flight = 0
    peak = 0
    lock = threading.Lock()

    def _slow_reader():
        nonlocal in_flight, peak
        with lock:
            in_flight += 1
            peak = max(peak, in_flight)
        try:
            time.sleep(0.2)
        finally:
            with lock:
                in_flight -= 1

    def _slow_overrides():
        _slow_reader()
        return {}

    def _slow_zdr():
        _slow_reader()
        return False

    with (
        patch.object(register_module, "ChatAgent", _make_agent_stub()),
        patch.object(request_llm_context, "get_model_overrides_from_context", side_effect=_slow_overrides),
        patch.object(request_llm_context, "get_org_llm_credential_from_context", side_effect=_slow_reader),
        patch.object(request_llm_context, "get_zdr_only_from_context", side_effect=_slow_zdr),
    ):
        run_fn, gen = await _get_run_fn(config, builder)
        await run_fn(ResearchAgentState(messages=[HumanMessage(content="hallo")]))
        await gen.aclose()

    assert peak == 3, "the three tenant lookups ran one after another on a single thread"


@pytest.mark.asyncio
async def test_one_bad_tenant_reader_does_not_poison_the_others():
    builder = _FakeBuilder({"web_search_tool": web_search_tool})
    config = ResearchAgentConfig(llm="research_llm", tools=["web_search_tool"], skills_enabled=False)

    def _boom():
        raise RuntimeError("BFF down")

    with (
        patch.object(register_module, "ChatAgent", _make_agent_stub()),
        patch.object(request_llm_context, "get_model_overrides_from_context", return_value={"shallow_research": "x/y"}),
        patch.object(request_llm_context, "get_org_llm_credential_from_context", side_effect=_boom),
        patch.object(request_llm_context, "get_zdr_only_from_context", return_value=False),
    ):
        run_fn, gen = await _get_run_fn(config, builder)
        result = await run_fn(ResearchAgentState(messages=[HumanMessage(content="hallo")]))
        await gen.aclose()

    assert result.messages[-1].content == "hallo"


@pytest.mark.asyncio
async def test_the_skill_resolve_runs_off_the_event_loop():
    import threading

    builder = _FakeBuilder({"web_search_tool": web_search_tool})
    config = ResearchAgentConfig(llm="research_llm", tools=["web_search_tool"], skills_enabled=True)
    resolved = (_skill("forecast-analysis"),)
    runtime = _skill_runtime(resolved)
    resolving_threads: list[str] = []

    def resolve(_org):
        resolving_threads.append(threading.current_thread().name)
        return resolved

    with (
        patch.object(register_module, "ChatAgent", _make_agent_stub()),
        patch.object(register_module, "get_organization_id_from_context", return_value="org-1"),
        _patch_runtime(runtime),
        patch.object(register_module, "SkillResolver") as ResolverCls,
    ):
        ResolverCls.return_value.resolve.side_effect = resolve
        run_fn, gen = await _get_run_fn(config, builder)
        await run_fn(ResearchAgentState(messages=[HumanMessage(content="hallo")]))
        await gen.aclose()

    assert resolving_threads and resolving_threads[0] != threading.current_thread().name


@pytest.mark.asyncio
async def test_the_envelope_names_reach_the_runtime_after_the_run():
    builder = _FakeBuilder({"web_search_tool": web_search_tool})
    config = ResearchAgentConfig(llm="research_llm", tools=["web_search_tool"], skills_enabled=True)
    resolved = (_skill("building-class"),)
    runtime = _skill_runtime(resolved)

    def _accept(names):
        runtime.activated = list(names)
        return tuple(names)

    runtime.record_applied = MagicMock(side_effect=_accept)
    stub = _make_agent_stub()

    async def _run(state, turn=None):
        state.skills_applied = ["building-class"]
        return state

    with (
        patch.object(register_module, "ChatAgent", stub),
        patch.object(register_module, "get_organization_id_from_context", return_value="org-1"),
        _patch_runtime(runtime),
        patch.object(register_module, "SkillResolver") as ResolverCls,
    ):
        ResolverCls.return_value.resolve.return_value = resolved
        run_fn, gen = await _get_run_fn(config, builder)
        stub.built[0].run = AsyncMock(side_effect=_run)
        result = await run_fn(ResearchAgentState(messages=[HumanMessage(content="Welche GK?")]))
        await gen.aclose()

    runtime.record_applied.assert_called_once_with(["building-class"])
    assert result.skills_activated == ["building-class"]


@pytest.mark.asyncio
async def test_skills_disabled_offers_no_catalog_and_no_skill_read():
    builder = _FakeBuilder({"web_search_tool": web_search_tool})
    config = ResearchAgentConfig(llm="research_llm", tools=["web_search_tool"], skills_enabled=False)
    stub = _make_agent_stub()

    with patch.object(register_module, "ChatAgent", stub):
        run_fn, gen = await _get_run_fn(config, builder)
        state = ResearchAgentState(messages=[HumanMessage(content="Welche Gebäudeklasse?")])
        await run_fn(state)
        await gen.aclose()

    assert state.skills_block is None
    turn = stub.built[0].run.await_args.kwargs["turn"]
    assert [getattr(t, "name", None) for t in turn.tools] == ["web_search_tool"]


@pytest.mark.asyncio
async def test_a_real_runtime_serves_the_catalog_and_records_what_the_model_read():
    from types import SimpleNamespace

    from agent.skills.models import Skill

    builder = _FakeBuilder({"web_search_tool": web_search_tool})
    config = ResearchAgentConfig(llm="research_llm", tools=["web_search_tool"], skills_enabled=True)
    resolved = (
        Skill(name="building-class", description="Die GK.", body="# GK\n\nZuerst die Geschosse.", origin="org"),
        Skill(name="fire-safety", description="Brandschutz.", body="# BS", origin="org"),
    )
    stub = _make_agent_stub()

    async def _run(state, turn=None):
        read = next(t for t in turn.tools if t.name == "read_file")
        message = await read.coroutine(
            "/skills/office/building-class/SKILL.md", SimpleNamespace(tool_call_id="c1"), offset=0, limit=1000
        )
        assert "Zuerst die Geschosse." in message.content
        return state

    with (
        patch.object(register_module, "ChatAgent", stub),
        patch.object(register_module, "get_organization_id_from_context", return_value="org-1"),
        patch.object(register_module, "SkillResolver") as ResolverCls,
    ):
        ResolverCls.return_value.resolve.return_value = resolved
        run_fn, gen = await _get_run_fn(config, builder)
        stub.built[0].run = AsyncMock(side_effect=_run)
        state = ResearchAgentState(messages=[HumanMessage(content="hallo")])
        result = await run_fn(state)
        await gen.aclose()

    assert "- **building-class**: Die GK." in (state.skills_block or "")
    assert "Zuerst die Geschosse." not in (state.skills_block or "")
    assert result.skills_activated == ["building-class"]
