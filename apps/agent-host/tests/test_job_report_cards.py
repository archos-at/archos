from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from agent.auth import Principal
from agent_host.routes import job_handlers

LEGAL_BASIS_CARD = {
    "type": "legal_basis",
    "title": "OIB-Richtlinie 2",
    "lane": "oib",
    "original_text": "Die Anforderungen an das Brandverhalten ...",
}
VERDICT_CARD = {"type": "verdict_header", "title": "Zulässig", "verdict": "REI 90"}


@pytest.fixture
def report_app(tmp_path, monkeypatch):

    monkeypatch.setenv("REQUIRE_AUTH", "false")
    monkeypatch.setattr(job_handlers, "require_verified_principal", lambda: Principal(type="jwt", sub="user-1"))

    job_store = MagicMock()
    job_store.get_job = AsyncMock(return_value=None)
    from nat.front_ends.fastapi.async_jobs import job_store as nat_job_store

    monkeypatch.setattr(nat_job_store, "JobStore", lambda **kwargs: job_store)

    worker = SimpleNamespace(
        _db_url=f"sqlite+aiosqlite:///{tmp_path / 'test_job_report_cards.db'}",
        _config_file_path="config.yml",
        _log_level=20,
        _front_end_config=SimpleNamespace(expiry_seconds=86400),
    )
    return SimpleNamespace(app=FastAPI(), builder=MagicMock(), worker=worker, job_store=job_store)


async def _fetch_report(report_app, output) -> dict:
    import agent_host.routes.jobs as jobs_routes

    report_app.job_store.get_job.return_value = SimpleNamespace(job_id="job-1", output=output)
    await jobs_routes.register_job_routes(report_app.app, report_app.builder, report_app.worker)
    with TestClient(report_app.app) as client:
        response = client.get("/v1/jobs/async/job/job-1/report")
    assert response.status_code == 200
    return response.json()


@pytest.mark.asyncio
async def test_report_response_carries_the_runs_cards(report_app):
    body = await _fetch_report(
        report_app,
        json.dumps({"report": "# Bericht\n\nText.", "cards": [VERDICT_CARD, LEGAL_BASIS_CARD]}),
    )

    assert body["report"] == "# Bericht\n\nText."
    assert body["cards"] == [VERDICT_CARD, LEGAL_BASIS_CARD]


@pytest.mark.asyncio
async def test_cards_are_returned_verbatim_and_unfiltered(report_app):
    body = await _fetch_report(
        report_app,
        json.dumps({"report": "# Bericht", "cards": [LEGAL_BASIS_CARD, VERDICT_CARD]}),
    )

    assert [card["type"] for card in body["cards"]] == ["legal_basis", "verdict_header"]
    assert body["cards"][0]["original_text"] == LEGAL_BASIS_CARD["original_text"]


@pytest.mark.asyncio
async def test_report_without_cards_reports_none(report_app):
    body = await _fetch_report(report_app, json.dumps({"report": "# Bericht"}))

    assert body["has_report"] is True
    assert body["cards"] is None


@pytest.mark.asyncio
async def test_cards_are_withheld_when_there_is_no_report(report_app):
    body = await _fetch_report(report_app, json.dumps({"cards": [LEGAL_BASIS_CARD]}))

    assert body["has_report"] is False
    assert body["cards"] is None


@pytest.mark.parametrize("stored", ["not-a-list", 5, {"type": "legal_basis"}])
@pytest.mark.asyncio
async def test_a_malformed_cards_value_never_costs_the_report(report_app, stored):
    body = await _fetch_report(report_app, json.dumps({"report": "# Bericht", "cards": stored}))

    assert body["report"] == "# Bericht"
    assert body["cards"] is None


@pytest.mark.asyncio
async def test_a_list_that_holds_no_usable_card_reads_as_no_cards(report_app):
    body = await _fetch_report(report_app, json.dumps({"report": "# Bericht", "cards": ["junk", None]}))

    assert body["cards"] is None


@pytest.mark.asyncio
async def test_unusable_card_entries_are_dropped_individually(report_app):
    body = await _fetch_report(
        report_app,
        json.dumps({"report": "# Bericht", "cards": [LEGAL_BASIS_CARD, "junk", None]}),
    )

    assert body["cards"] == [LEGAL_BASIS_CARD]


@pytest.mark.asyncio
async def test_output_stored_as_a_dict_is_read_the_same_way(report_app):
    body = await _fetch_report(report_app, {"report": "# Bericht", "cards": [LEGAL_BASIS_CARD]})

    assert body["cards"] == [LEGAL_BASIS_CARD]


@pytest.mark.asyncio
async def test_report_carries_the_project_the_run_was_commissioned_in(report_app, monkeypatch):
    from agent_host.jobs import access

    async def _commissioned_in(job_id, db_url):
        assert job_id == "job-1"
        return "proj_wien"

    monkeypatch.setattr(access, "get_job_project_collection", _commissioned_in)
    body = await _fetch_report(report_app, json.dumps({"report": "# Bericht"}))

    assert body["project_collection"] == "proj_wien"


@pytest.mark.asyncio
async def test_a_run_with_no_project_reports_none_rather_than_a_guess(report_app, monkeypatch):
    from agent_host.jobs import access

    async def _no_project(job_id, db_url):
        return None

    monkeypatch.setattr(access, "get_job_project_collection", _no_project)
    body = await _fetch_report(report_app, json.dumps({"report": "# Bericht"}))

    assert body["project_collection"] is None


@pytest.mark.asyncio
async def test_a_poll_with_no_report_yet_pays_for_no_access_read(report_app, monkeypatch):
    from agent_host.jobs import access

    calls = []

    async def _counted(job_id, db_url):
        calls.append(job_id)
        return "proj_wien"

    monkeypatch.setattr(access, "get_job_project_collection", _counted)
    body = await _fetch_report(report_app, json.dumps({"status": "running"}))

    assert body["has_report"] is False
    assert body["project_collection"] is None
    assert calls == []


NUMBERED_SOURCE = {
    "title": "OIB-Richtlinie 2",
    "file_name": "oib-rl_2_ausgabe_mai_2023.pdf",
    "page": 7,
    "number": 3,
    "collection": "oib_base",
}


@pytest.mark.asyncio
async def test_report_response_carries_the_runs_numbered_sources(report_app):
    body = await _fetch_report(
        report_app,
        json.dumps({"report": "# Bericht [3]", "sources": [NUMBERED_SOURCE]}),
    )

    assert body["sources"] == [NUMBERED_SOURCE]


@pytest.mark.asyncio
async def test_sources_are_withheld_when_there_is_no_report(report_app):
    body = await _fetch_report(report_app, json.dumps({"sources": [NUMBERED_SOURCE]}))

    assert body["has_report"] is False
    assert body["sources"] is None


@pytest.mark.parametrize("stored", ["not-a-list", 5, {"number": 1}, [], ["a string", 7]])
@pytest.mark.asyncio
async def test_a_malformed_sources_value_never_costs_the_report(report_app, stored):
    body = await _fetch_report(report_app, json.dumps({"report": "# Bericht", "sources": stored}))

    assert body["report"] == "# Bericht"
    assert body["sources"] is None
