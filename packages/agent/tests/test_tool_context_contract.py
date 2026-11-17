from pathlib import Path

import pytest
import yaml

from agent.project_context import ORGANIZATION_ID_HEADER
from agent.project_context import PROJECT_ID_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_SIG_HEADER
from agent.project_context import TOOL_CONTEXT_REQUIREMENTS
from agent_host.jobs.run_envelope import envelope_headers_for_run
from agent_host.jobs.runner import WORKER_ENVELOPE_HEADERS
from agent_host.jobs.runner import WORKER_IDENTITY_HEADERS

ENVELOPE = (REQUEST_CONTEXT_ENVELOPE_HEADER, REQUEST_CONTEXT_ENVELOPE_SIG_HEADER)

WORKER_SUPPLIED_HEADERS = WORKER_IDENTITY_HEADERS + WORKER_ENVELOPE_HEADERS

CONFIG = Path(__file__).resolve().parents[3] / "configs" / "config_oib_openrouter.yml"


@pytest.fixture(scope="module")
def config() -> dict:
    return yaml.safe_load(CONFIG.read_text(encoding="utf-8"))


def _bound_tool_types(config: dict, agent: str) -> dict[str, str]:
    declared = {**config["functions"], **(config.get("function_groups") or {})}
    return {name: declared[name]["_type"] for name in config["functions"][agent]["tools"] if name in declared}


@pytest.mark.parametrize("agent", ["shallow_research_agent", "deep_research_agent"])
def test_the_worker_supplies_what_every_bound_tool_needs(config: dict, agent: str):
    missing = {
        name: [header for header in TOOL_CONTEXT_REQUIREMENTS.get(kind, ()) if header not in WORKER_SUPPLIED_HEADERS]
        for name, kind in _bound_tool_types(config, agent).items()
    }
    missing = {name: headers for name, headers in missing.items() if headers}
    assert missing == {}, f"{agent} binds tools the job worker cannot serve: {missing}"


def test_the_delegation_tool_declares_its_project_scope_and_its_person():
    assert set(TOOL_CONTEXT_REQUIREMENTS["create_task"]) == {PROJECT_ID_HEADER, *ENVELOPE}


@pytest.mark.parametrize(
    "kind", ["propose_file_change", "file_draft", "create_task", "project_lookup", "document_canvas"]
)
def test_every_tool_that_acts_as_a_person_declares_the_envelope(kind: str):
    assert set(ENVELOPE) <= set(TOOL_CONTEXT_REQUIREMENTS[kind])


def test_the_worker_envelope_headers_are_the_ones_the_context_reads():
    assert set(WORKER_ENVELOPE_HEADERS) == set(ENVELOPE)


async def test_the_worker_supplies_the_envelope_only_from_one_the_run_carries():
    identity = {"organization_id": "org-1", "user_id": "user-1", "project_id": "proj-1"}
    assert await envelope_headers_for_run(None, run_id="run-1", job_id="job-1", identity=identity) == {}


def test_the_memory_tool_declares_its_project_scope():
    assert set(TOOL_CONTEXT_REQUIREMENTS["project_memory_remember"]) == {PROJECT_ID_HEADER, ORGANIZATION_ID_HEADER}


def test_every_declared_requirement_names_a_function_type_the_config_binds(config: dict):
    declared = [*config["functions"].values(), *(config.get("function_groups") or {}).values()]
    bound_types = {entry.get("_type") for entry in declared if isinstance(entry, dict)}
    unknown = [kind for kind in TOOL_CONTEXT_REQUIREMENTS if kind not in bound_types]
    assert unknown == [], unknown
