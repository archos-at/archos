from __future__ import annotations

import re
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi import APIRouter
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agent.common.job_admission import JobAdmissionError
from agent_host.jobs.submit import DuplicateJobIdError
from agent_host.routes.internal_auth import _DEV_DEFAULT_TOKEN

_TOKEN = "real-internal-secret"


def _valid_body(**overrides) -> dict:
    body = {
        "input": "Act as a building-physics advisor: check the OIB thermal requirements.",
        "skills": ["oib-thermal-check", "building-physics-advisor"],
        "output": "deep-research",
        "organization_id": "org_123",
        "user_id": "user_abc",
        "project_id": "proj-uuid-1",
        "owner_email": "creator@example.com",
        "collection_scope": ["oib_knowledge", "proj_uuid_1", "s_conv1"],
        "budget_header": "eyJyZW1haW5pbmdPcmdVc2QiOjF9",
        "model_overrides": {"researcher": "openrouter/some-model"},
    }
    body.update(overrides)
    return body


@pytest.fixture
def submit_mock(monkeypatch):
    from agent_host.jobs import submit as submit_module

    mock = AsyncMock(return_value="job-xyz")
    monkeypatch.setattr(submit_module, "submit_agent_job", mock)
    return mock


@pytest.fixture
def client(submit_mock):
    from agent_host.routes.skills import add_skill_routes

    router = APIRouter()
    add_skill_routes(router)
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def prod_token(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", _TOKEN)
    monkeypatch.setenv("APP_ENV", "production")


def _post(client, body, token=_TOKEN):
    headers = {} if token is None else {"x-internal-token": token}
    return client.post("/v1/internal/skills/submit", json=body, headers=headers)


def test_missing_token_forbidden(client, prod_token):
    resp = _post(client, _valid_body(), token=None)
    assert resp.status_code == 403


def test_wrong_token_forbidden(client, prod_token):
    resp = _post(client, _valid_body(), token="nope")
    assert resp.status_code == 403


def test_dev_default_token_in_prod_disabled(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", _DEV_DEFAULT_TOKEN)
    monkeypatch.setenv("APP_ENV", "production")
    resp = _post(client, _valid_body(), token=_DEV_DEFAULT_TOKEN)
    assert resp.status_code == 503


def test_unset_token_forbidden(client, monkeypatch):
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    resp = _post(client, _valid_body(), token="anything")
    assert resp.status_code == 403


def test_missing_organization_id_422(client, prod_token):
    body = _valid_body()
    del body["organization_id"]
    resp = _post(client, body)
    assert resp.status_code == 422


def test_oversized_input_422(client, prod_token):
    resp = _post(client, _valid_body(input="x" * 48001))
    assert resp.status_code == 422


def test_the_bff_budgets_prompts_against_this_ceiling():
    from agent_host.routes.skills import SUBMIT_INPUT_MAX_CHARS

    types_ts = Path(__file__).resolve().parents[3] / "apps" / "workspace" / "bff" / "jobs" / "types.ts"
    match = re.search(r"export const AGENT_RUN_INPUT_MAX_CHARS = ([\d_]+)", types_ts.read_text(encoding="utf-8"))
    assert match, f"AGENT_RUN_INPUT_MAX_CHARS not found in {types_ts}"
    assert int(match.group(1).replace("_", "")) == SUBMIT_INPUT_MAX_CHARS


def test_composed_input_above_the_old_skill_body_limit_is_accepted(client, prod_token, submit_mock):
    composed = "j" * 16000 + "s" * 16001
    assert len(composed) == 32001
    resp = _post(client, _valid_body(input=composed))
    assert resp.status_code == 200
    assert submit_mock.await_args.kwargs["input_text"] == composed


def test_empty_input_422(client, prod_token):
    resp = _post(client, _valid_body(input=""))
    assert resp.status_code == 422


def test_bad_job_id_pattern_422(client, prod_token):
    resp = _post(client, _valid_body(job_id="bad id!"))
    assert resp.status_code == 422


def test_unknown_output_kind_422(client, prod_token):
    resp = _post(client, _valid_body(output="overnight"))
    assert resp.status_code == 422


def test_unknown_legacy_execution_value_422(client, prod_token):
    body = _valid_body(execution="overnight")
    del body["output"]
    resp = _post(client, body)
    assert resp.status_code == 422


def test_missing_skills_submits_the_prompt_alone(client, prod_token, submit_mock):
    body = _valid_body()
    del body["skills"]
    resp = _post(client, body)
    assert resp.status_code == 200
    assert "force_skills" not in submit_mock.await_args.kwargs


def test_an_empty_skills_list_is_accepted_not_rejected(client, prod_token, submit_mock):
    resp = _post(client, _valid_body(skills=[]))
    assert resp.status_code == 200
    assert "force_skills" not in submit_mock.await_args.kwargs


def test_chat_output_selects_researcher(client, prod_token, submit_mock):
    resp = _post(client, _valid_body(output="chat", agent_type=None))
    assert resp.status_code == 200
    assert submit_mock.await_args.kwargs["agent_type"] == "researcher"


def test_deep_research_output_selects_deep_researcher(client, prod_token, submit_mock):
    resp = _post(client, _valid_body(output="deep-research", agent_type=None))
    assert resp.status_code == 200
    assert submit_mock.await_args.kwargs["agent_type"] == "deep_researcher"


def test_explicit_agent_type_overrides_the_output_default(client, prod_token, submit_mock):
    resp = _post(client, _valid_body(output="chat", agent_type="deep_researcher"))
    assert resp.status_code == 200
    assert submit_mock.await_args.kwargs["agent_type"] == "deep_researcher"


def test_output_only_is_the_new_contract(client, prod_token, submit_mock):
    body = _valid_body(output="chat")
    assert "execution" not in body
    resp = _post(client, body)
    assert resp.status_code == 200
    assert submit_mock.await_args.kwargs["agent_type"] == "researcher"


def test_execution_only_still_works_during_the_deploy_window(client, prod_token, submit_mock):
    body = _valid_body(execution="chat")
    del body["output"]
    resp = _post(client, body)
    assert resp.status_code == 200
    assert submit_mock.await_args.kwargs["agent_type"] == "researcher"


def test_output_wins_when_both_are_sent(client, prod_token, submit_mock):
    resp = _post(client, _valid_body(output="chat", execution="deep-research"))
    assert resp.status_code == 200
    assert submit_mock.await_args.kwargs["agent_type"] == "researcher"


def test_neither_output_nor_execution_is_422_not_500(client, prod_token, submit_mock):
    body = _valid_body()
    del body["output"]
    assert "execution" not in body
    resp = _post(client, body)
    assert resp.status_code == 422
    submit_mock.assert_not_awaited()


def test_unknown_agent_type_maps_to_400(client, prod_token, submit_mock):
    resp = _post(client, _valid_body(agent_type="no_such_agent"))
    assert resp.status_code == 400
    submit_mock.assert_not_awaited()


def test_successful_submit_returns_job_id(client, prod_token, submit_mock):
    resp = _post(client, _valid_body())
    assert resp.status_code == 200
    assert resp.json() == {"job_id": "job-xyz", "queued": True}
    submit_mock.assert_awaited_once()


def test_priority_defaults_to_interactive_and_a_scheduled_fire_can_send_bulk(client, prod_token, submit_mock):
    assert _post(client, _valid_body()).status_code == 200
    assert submit_mock.await_args.kwargs["priority"] == "interactive"

    assert _post(client, _valid_body(priority="bulk")).status_code == 200
    assert submit_mock.await_args.kwargs["priority"] == "bulk"


def test_a_priority_nobody_defined_is_422(client, prod_token, submit_mock):
    resp = _post(client, _valid_body(priority="urgent"))
    assert resp.status_code == 422
    submit_mock.assert_not_awaited()


def test_the_settled_plan_and_the_documents_reach_the_worker(client, prod_token, submit_mock):
    documents = {"basis": [{"name": "Einreichplan.pdf", "shelf": "project"}], "excluded": []}
    resp = _post(client, _valid_body(clarifier_result="Rechercheplan: Fluchtwege", documents=documents))
    assert resp.status_code == 200

    kwargs = submit_mock.await_args.kwargs
    assert kwargs["clarifier_result"] == "Rechercheplan: Fluchtwege"
    assert kwargs["documents"] == documents


def test_a_run_that_settled_nothing_sends_neither(client, prod_token, submit_mock):
    resp = _post(client, _valid_body())
    assert resp.status_code == 200
    kwargs = submit_mock.await_args.kwargs
    assert kwargs["clarifier_result"] is None
    assert kwargs["documents"] is None


def test_successful_submit_forwards_identity_and_scope(client, prod_token, submit_mock):
    resp = _post(client, _valid_body())
    assert resp.status_code == 200

    kwargs = submit_mock.await_args.kwargs
    assert kwargs["agent_type"] == "deep_researcher"
    assert kwargs["input_text"] == "Act as a building-physics advisor: check the OIB thermal requirements."
    assert "force_skills" not in kwargs
    assert kwargs["owner"] == "creator@example.com"
    assert kwargs["collection_scope"] == ["oib_knowledge", "proj_uuid_1", "s_conv1"]
    assert kwargs["project_context"] is None
    assert kwargs["model_overrides"] == {"researcher": "openrouter/some-model"}
    assert kwargs["project_memory"] is None
    assert kwargs["memory_reflection_enabled"] is False

    principal = kwargs["principal"]
    assert principal.type == "jwt"
    assert principal.sub == "user_abc"
    assert principal.email == "creator@example.com"

    usage_context = kwargs["usage_context"]
    assert usage_context == {
        "identity": {
            "organization_id": "org_123",
            "user_id": "user_abc",
            "project_id": "proj-uuid-1",
            "conversation_id": None,
        },
        "budget_header": "eyJyZW1haW5pbmdPcmdVc2QiOjF9",
    }


def test_a_temporary_conversation_is_said_to_the_worker_beside_the_identity(client, prod_token, submit_mock):
    resp = _post(client, _valid_body(temporary_conversation=True, memory_reflection_enabled=True))
    assert resp.status_code == 200

    kwargs = submit_mock.await_args.kwargs
    assert kwargs["usage_context"]["temporary_conversation"] is True
    assert "temporary_conversation" not in kwargs["usage_context"]["identity"]
    assert kwargs["memory_reflection_enabled"] is True


def test_owner_falls_back_to_user_id_when_no_email(client, prod_token, submit_mock):
    resp = _post(client, _valid_body(owner_email=None))
    assert resp.status_code == 200
    kwargs = submit_mock.await_args.kwargs
    assert kwargs["owner"] == "user_abc"
    assert kwargs["principal"].sub == "user_abc"
    assert kwargs["principal"].email is None


def test_chat_output_accepts_an_attached_skill_without_forcing_it(client, prod_token, submit_mock):
    resp = _post(client, _valid_body(output="chat", skills=["only-one"]))
    assert resp.status_code == 200
    assert "force_skills" not in submit_mock.await_args.kwargs


def test_unknown_data_source_ids_422_via_registry_fallback(client, prod_token, submit_mock, monkeypatch):
    from agent_host.routes import builder_state

    monkeypatch.setattr(builder_state, "get_active_builder", lambda: None)
    resp = _post(client, _valid_body(data_sources=["no_such_source"]))
    assert resp.status_code == 422
    submit_mock.assert_not_awaited()


def test_admission_error_maps_to_429_with_retry_after(client, prod_token, submit_mock):
    submit_mock.side_effect = JobAdmissionError("Research queue is full.", retry_after_seconds=45)
    resp = _post(client, _valid_body())
    assert resp.status_code == 429
    assert resp.headers["Retry-After"] == "45"


def test_duplicate_job_id_maps_to_409(client, prod_token, submit_mock):
    submit_mock.side_effect = DuplicateJobIdError("Job ID already exists: dup-1")
    resp = _post(client, _valid_body(job_id="dup-1"))
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Job ID already exists: dup-1"


def test_route_not_on_external_allowlist():
    from agent_host.auth.middleware import EXTERNAL_ALLOWED_PATHS

    path = "/v1/internal/skills/submit"
    assert path not in EXTERNAL_ALLOWED_PATHS
    for allowed in EXTERNAL_ALLOWED_PATHS:
        if allowed.endswith("/"):
            assert not path.startswith(allowed)


def test_memory_digest_and_reflection_flag_are_forwarded(client, prod_token, submit_mock):
    body = _valid_body()
    body["project_memory"] = "PROJECT_MEMORY v1\n- Atrium ist OIB 2.3"
    body["memory_reflection_enabled"] = True
    resp = _post(client, body)
    assert resp.status_code == 200
    kwargs = submit_mock.await_args.kwargs
    assert kwargs["project_memory"] == "PROJECT_MEMORY v1\n- Atrium ist OIB 2.3"
    assert kwargs["memory_reflection_enabled"] is True


def test_run_id_is_forwarded_so_the_worker_can_narrate_the_run(client, prod_token, submit_mock):
    body = _valid_body()
    body["run_id"] = "6f1c2f6e-4a1b-4c2e-9f3a-2b1d4e5f6a7b"
    resp = _post(client, body)
    assert resp.status_code == 200
    assert submit_mock.await_args.kwargs["run_id"] == "6f1c2f6e-4a1b-4c2e-9f3a-2b1d4e5f6a7b"


def test_a_submit_without_a_run_id_still_runs(client, prod_token, submit_mock):
    resp = _post(client, _valid_body())
    assert resp.status_code == 200
    assert submit_mock.await_args.kwargs["run_id"] is None
