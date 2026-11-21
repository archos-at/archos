# drop after release 2026-W50
from __future__ import annotations

import pytest

from agent_host.jobs.agent_job import JobRequest
from agent_host.jobs.legacy_agent_class_paths import LEGACY_AGENT_CLASS_PATHS
from agent_host.registry import AGENT_REGISTRY
from agent_host.registry import UnknownAgentError


def _request(**agent) -> JobRequest:
    return JobRequest(
        db_url="sqlite://", config_file_path="c.yml", job_id="job-1", input_text="q", agent_config_name="x", **agent
    )


@pytest.mark.parametrize(("class_path", "agent_type"), sorted(LEGACY_AGENT_CLASS_PATHS.items()))
def test_a_job_queued_with_a_class_path_runs_the_same_agent(class_path, agent_type):
    agent_cls = AGENT_REGISTRY[_request(agent_class_path=class_path).registered_agent_type].load()

    assert f"{agent_cls.__module__}.{agent_cls.__qualname__}" == class_path.replace("agents.piloti", "core")
    assert agent_type in AGENT_REGISTRY


def test_every_registered_agent_has_its_old_class_path():
    assert set(LEGACY_AGENT_CLASS_PATHS.values()) == set(AGENT_REGISTRY)


def test_an_unknown_class_path_fails_by_name():
    with pytest.raises(UnknownAgentError, match="pkg.Agent"):
        _ = _request(agent_class_path="pkg.Agent").registered_agent_type


def test_the_agent_type_wins_over_a_class_path():
    assert _request(agent_type="researcher", agent_class_path="pkg.Agent").registered_agent_type == "researcher"
