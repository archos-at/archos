"""A research run binds the knowledge context its payload carries, and fails closed without one (ADR-0175).

A run never calls the turn-context route, so the payload is the only place its law can come from.
Without it the run must read ``knowledge_unavailable``, never Austria by default.
"""

from __future__ import annotations

import contextvars

from agent.citations.roles import get_turn_building_law
from agent.common.knowledge_context import get_turn_knowledge_context
from agent.common.law_gate import law_sources_withheld
from agent_host.jobs.agent_job import JobRequest
from agent_host.jobs.agent_job_setup import bind_knowledge

BASE = dict(
    db_url="postgresql://x/y",
    config_file_path="/c.yml",
    job_id="job-1",
    input_text="q",
    agent_class_path="pkg.Agent",
    agent_config_name="deep",
)

CORE_AUSTRIA = {
    "gate": {"state": "core", "leaves": [{"country": "AT", "coverage": "core"}]},
    "retrieval": {"countries": ["AT", "EU"]},
}

CHAIN = {"text": "Building law at this site, Wien", "date": "2026-11-10", "chain": ["AT-9", "AT", "EU"], "uses": []}


def _bound(**payload: object) -> tuple[object, object, frozenset[str]]:
    def run() -> tuple[object, object, frozenset[str]]:
        bind_knowledge(JobRequest(**BASE, **payload))
        return get_turn_knowledge_context(), get_turn_building_law(), law_sources_withheld()

    return contextvars.copy_context().run(run)


def test_a_run_binds_the_context_and_the_chain_its_payload_carries():
    context, law, withheld = _bound(knowledge_context=CORE_AUSTRIA, building_law=CHAIN)
    assert context.gate == "core"
    assert law.text == "Building law at this site, Wien"
    assert withheld == frozenset()


def test_a_run_without_a_context_fails_closed():
    context, law, withheld = _bound()
    assert context.gate == "knowledge_unavailable"
    assert law is None
    assert withheld == frozenset({"ris"})
