from __future__ import annotations

from unittest import mock

import pytest

from agent.common import cache as shared_cache
from agent.skills.models import Skill
from agent.skills.resolver import SkillResolver
from agent.skills.resolver import resolve_served_skills

BUILTIN = (
    Skill(name="calc", description="Base calculator.", body="body-1", origin="platform", collection="research"),
    Skill(name="report", description="Base report writer.", body="body-2", origin="platform", collection="synthesis"),
)


@pytest.fixture(autouse=True)
def _reset_cache():
    shared_cache.reset_local_store()
    yield
    shared_cache.reset_local_store()


@pytest.fixture
def resolver(monkeypatch: pytest.MonkeyPatch) -> SkillResolver:
    monkeypatch.setenv("INTERNAL_API_TOKEN", "test-token")
    resolver = SkillResolver(agent="researcher")
    resolver._builtin_by_name = {s.name: s for s in BUILTIN}
    return resolver


def _row(name: str, **extra: object) -> dict[str, object]:
    return {"name": name, "description": f"{name} org skill.", "body": f"body-{name}", **extra}


def test_builtin_only_without_org(resolver: SkillResolver) -> None:
    assert {s.name for s in resolver.resolve(None)} == {"calc", "report"}


def test_org_rows_shadow_builtin_by_name(resolver: SkillResolver) -> None:
    with mock.patch.object(
        resolver,
        "_fetch_org_skills",
        return_value=[_row("calc", metadata={"grid-agents": "researcher"}), _row("org-only")],
    ):
        resolved = resolver.resolve("org-1")
    assert {s.name: s for s in resolved}["calc"].origin == "org"
    assert "org-only" in {s.name for s in resolved}
    assert resolver.builtin[0].origin == "platform"


def test_invalid_org_row_is_dropped(resolver: SkillResolver) -> None:
    with mock.patch.object(
        resolver,
        "_fetch_org_skills",
        return_value=[_row("bad name!"), _row("UPPERCASE"), _row("valid-org")],
    ):
        resolved = resolver.resolve("org-1")
    assert "valid-org" in {s.name for s in resolved}
    assert "bad name!" not in {s.name for s in resolved}


def test_agents_filter_applies_to_builtin_and_org(resolver: SkillResolver) -> None:
    smart = Skill(
        name="smart",
        description="Deep only.",
        body="b",
        origin="platform",
        metadata={"grid-agents": "deep_researcher"},
    )
    resolver._builtin_by_name["smart"] = smart
    with mock.patch.object(
        resolver,
        "_fetch_org_skills",
        return_value=[_row("org-deep", metadata={"grid-agents": "deep_researcher"})],
    ):
        resolved = resolver.resolve("org-1")
    assert "smart" not in {s.name for s in resolved}
    assert "org-deep" not in {s.name for s in resolved}


def test_a_leftover_legacy_execution_is_ignored_not_honoured(resolver: SkillResolver) -> None:
    for execution in ("chat", "deep-research"):
        skill = Skill(
            name=f"{execution}-mode",
            description="d.",
            body="b",
            origin="platform",
            metadata={"grid-execution": execution},
        )
        resolver._builtin_by_name[skill.name] = skill

    deep = SkillResolver(agent="deep_researcher")
    deep._builtin_by_name = dict(resolver._builtin_by_name)

    for agent_resolver in (resolver, deep):
        names = {s.name for s in agent_resolver.resolve(None)}
        assert {"chat-mode", "deep-research-mode"} <= names


def test_org_row_with_a_stored_legacy_execution_still_resolves(resolver: SkillResolver) -> None:
    with mock.patch.object(
        resolver,
        "_fetch_org_skills",
        return_value=[
            _row(
                "legacy-row",
                metadata={
                    "grid-execution": "deep-research",
                    "grid-schedulable": "true",
                    "grid-agents": "researcher",
                },
            )
        ],
    ):
        resolved = {s.name: s for s in resolver.resolve("org-1")}
    assert "legacy-row" in resolved
    assert resolved["legacy-row"].metadata["grid-execution"] == "deep-research"


def test_agents_is_the_only_scope(resolver: SkillResolver) -> None:
    scheduled_report = Skill(
        name="monthly-report",
        description="d.",
        body="b",
        origin="platform",
        metadata={"grid-execution": "deep-research"},
    )
    deep_only = Skill(
        name="sandbox-writer",
        description="d.",
        body="b",
        origin="platform",
        metadata={"grid-execution": "deep-research", "grid-agents": "deep_researcher"},
    )
    resolver._builtin_by_name["monthly-report"] = scheduled_report
    resolver._builtin_by_name["sandbox-writer"] = deep_only

    names = {s.name for s in resolver.resolve(None)}
    assert "monthly-report" in names
    assert "sandbox-writer" not in names


def test_fetch_failure_fails_open_to_builtins(resolver: SkillResolver) -> None:
    with mock.patch.object(resolver, "_fetch_org_skills", side_effect=RuntimeError("boom")):
        assert {s.name for s in resolver.resolve("org-1")} == {"calc", "report"}


def test_missing_token_fails_open(resolver: SkillResolver, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("INTERNAL_API_TOKEN")
    assert {s.name for s in resolver.resolve("org-1")} == {"calc", "report"}


def test_result_is_cached_in_shared_cache(resolver: SkillResolver) -> None:
    calls = 0

    def fake_fetch(org: str) -> list[dict[str, object]]:
        nonlocal calls
        calls += 1
        return [_row("org-only")]

    with mock.patch.object(resolver, "_fetch_org_skills", side_effect=fake_fetch):
        resolver.resolve("org-cached")
        resolver.resolve("org-cached")
        resolver.resolve("org-cached")
    assert calls == 1
    with mock.patch.object(resolver, "_fetch_org_skills", side_effect=fake_fetch):
        resolver.resolve("org-other")
    assert calls == 2


def test_cache_tty_default_is_60(resolver: SkillResolver, monkeypatch: pytest.MonkeyPatch) -> None:
    from agent.skills.resolver import _cache_ttl_seconds

    assert _cache_ttl_seconds() == 60.0
    monkeypatch.setenv("SKILLS_CACHE_TTL_SECONDS", "120")
    assert _cache_ttl_seconds() == 120.0
    monkeypatch.setenv("SKILLS_CACHE_TTL_SECONDS", "0")
    assert _cache_ttl_seconds() == 60.0
    monkeypatch.setenv("SKILLS_CACHE_TTL_SECONDS", "junk")
    assert _cache_ttl_seconds() == 60.0


class _FakeResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, object]:
        return self._payload


def _capture_fetch_query(agent: str | None, monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    captured: dict[str, str] = {}

    def fake_get(url: str, *, params: dict[str, str], headers: dict[str, str], timeout: float):
        captured.update(params)
        captured["__url"] = url
        captured["__token_header"] = next(iter(headers))
        return _FakeResponse({"skills": []})

    monkeypatch.setenv("INTERNAL_API_TOKEN", "test-token")
    monkeypatch.setenv("FRONTEND_INTERNAL_URL", "http://frontend:3000")
    import httpx

    monkeypatch.setattr(httpx, "get", fake_get)
    SkillResolver(agent=agent)._fetch_org_skills("org-42")
    return captured


def test_fetch_sends_the_snake_case_organization_id(monkeypatch: pytest.MonkeyPatch) -> None:
    query = _capture_fetch_query("researcher", monkeypatch)
    assert query["organization_id"] == "org-42"
    assert "organizationId" not in query
    assert query["agent"] == "researcher"
    assert query["__url"] == "http://frontend:3000/api/internal/skills/resolve"
    assert query["__token_header"] == "x-internal-token"


def test_fetch_omits_agent_entirely_when_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    query = _capture_fetch_query(None, monkeypatch)
    assert "agent" not in query
    assert query["organization_id"] == "org-42"


def test_unknown_agents_names_do_not_delete_the_skill(resolver: SkillResolver) -> None:
    from agent.skills.resolver import _agent_allows

    typo = Skill(name="typo", description="d", body="b", metadata={"grid-agents": "shallow_reseacher"})
    assert _agent_allows(typo, "researcher") is True
    real = Skill(name="real", description="d", body="b", metadata={"grid-agents": "deep_researcher"})
    assert _agent_allows(real, "researcher") is False


def test_the_retired_agent_name_still_scopes_a_skill_to_the_chat_agent() -> None:
    from agent.skills.resolver import _agent_allows

    retired = Skill(name="voice", description="d", body="b", metadata={"grid-agents": "shallow_researcher"})
    assert _agent_allows(retired, "researcher") is True
    assert _agent_allows(retired, "deep_researcher") is False

    both = Skill(
        name="cards", description="d", body="b", metadata={"grid-agents": "shallow_researcher,deep_researcher"}
    )
    assert _agent_allows(both, "researcher") is True
    assert _agent_allows(both, "deep_researcher") is True


def test_a_caller_still_asking_under_the_retired_name_gets_the_same_answer() -> None:
    from agent.skills.resolver import _agent_allows

    migrated = Skill(name="voice", description="d", body="b", metadata={"grid-agents": "researcher"})
    assert _agent_allows(migrated, "shallow_researcher") is True

    deep_only = Skill(name="report", description="d", body="b", metadata={"grid-agents": "deep_researcher"})
    assert _agent_allows(deep_only, "shallow_researcher") is False


CURATED = Skill(
    name="fire-check",
    description="Offered to organizations.",
    body="body-3",
    origin="platform",
    collection="research",
    metadata={"grid-catalog": "curated"},
)


@pytest.fixture
def catalog_resolver(monkeypatch: pytest.MonkeyPatch) -> SkillResolver:
    monkeypatch.setenv("INTERNAL_API_TOKEN", "test-token")
    resolver = SkillResolver(agent="researcher")
    resolver._builtin_by_name = {s.name: s for s in (*BUILTIN, CURATED)}
    return resolver


def test_curated_builtin_is_not_always_on(catalog_resolver: SkillResolver) -> None:
    assert {s.name for s in catalog_resolver.always_on} == {"calc", "report"}
    assert "fire-check" in {s.name for s in catalog_resolver.builtin}
    assert "fire-check" not in {s.name for s in catalog_resolver.resolve(None)}


def test_curated_builtin_arrives_when_the_org_switched_it_on(catalog_resolver: SkillResolver) -> None:
    with mock.patch.object(
        catalog_resolver,
        "_fetch_org_skills",
        return_value=[_row("fire-check")],
    ):
        resolved = catalog_resolver.resolve("org-1")
    assert "fire-check" in {s.name for s in resolved}


def test_machinery_survives_a_failed_fetch(catalog_resolver: SkillResolver) -> None:
    with mock.patch.object(catalog_resolver, "_fetch_org_skills", side_effect=RuntimeError("down")):
        resolved = catalog_resolver.resolve("org-1")
    assert {s.name for s in resolved} == {"calc", "report"}


def test_unrecognised_catalog_value_reads_as_machinery(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_API_TOKEN", "test-token")
    resolver = SkillResolver(agent="researcher")
    typo = Skill(
        name="typo",
        description="Meant to be curated.",
        body="b",
        origin="platform",
        collection="research",
        metadata={"grid-catalog": "curatd"},
    )
    resolver._builtin_by_name = {typo.name: typo}
    assert {s.name for s in resolver.always_on} == {"typo"}


def test_served_skills_leave_the_builtin_FILES_where_they_are(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_API_TOKEN", "test-token")
    with mock.patch.object(
        SkillResolver,
        "_fetch_org_skills",
        return_value=[
            _row("piloti-voice", metadata={"grid-agents": "researcher,deep_researcher"}),
            _row("fire-safety", metadata={"grid-agents": "researcher,deep_researcher"}),
        ],
    ):
        served = resolve_served_skills("deep_researcher", "org-1")
    assert [s.name for s in served] == ["piloti-voice"]
    assert {s.origin for s in served} == {"org"}


def test_served_skills_still_honour_agents(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERNAL_API_TOKEN", "test-token")
    with mock.patch.object(
        SkillResolver,
        "_fetch_org_skills",
        return_value=[_row("chat-only", metadata={"grid-agents": "researcher"})],
    ):
        assert resolve_served_skills("deep_researcher", "org-1") == ()


def test_served_skills_never_raise_without_a_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    assert resolve_served_skills("deep_researcher", "org-1") == ()


def test_served_skills_swallow_a_hard_resolution_failure() -> None:
    with mock.patch.object(SkillResolver, "resolve", side_effect=RuntimeError("boom")):
        assert resolve_served_skills("deep_researcher", "org-1") == ()
