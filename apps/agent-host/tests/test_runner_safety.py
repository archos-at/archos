from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest

from agent_host.jobs.conversation_output import write_job_turn
from agent_host.jobs.run_result import ANSWER_CONFIDENCE_FIELDS
from agent_host.jobs.run_result import build_job_output
from agent_host.jobs.run_result import extract_answer_transparency
from agent_host.jobs.run_result import extract_skills_activated
from agent_host.jobs.run_result import mark_degraded
from agent_host.jobs.runner import _DEGRADED_EVENT_FIELDS
from agent_host.jobs.runner import _GRAPH_RECURSION_ERROR_MSG
from agent_host.jobs.runner import _WALL_CLOCK_TIMEOUT_MSG
from agent_host.jobs.runner import JOB_DEGRADED_EVENT_TYPE
from agent_host.jobs.runner import CancellationMonitor
from agent_host.jobs.runner import _b64url_encode_text
from agent_host.jobs.runner import _create_agent_instance
from agent_host.jobs.runner import _generate_answer_cards
from agent_host.jobs.runner import _purge_deep_checkpoint
from agent_host.jobs.runner import _resolve_deep_research_checkpointer
from agent_host.jobs.runner import _update_status_if_not_terminal
from agent_host.jobs.runner import sanitize_job_error


def _ensure_job_info_table(db_url: str) -> None:
    from sqlalchemy import text

    from agent_host.jobs.event_store import EventStore

    engine = EventStore._get_or_create_sync_engine(db_url)
    with engine.connect() as conn:
        conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS job_info ("
                "  job_id TEXT PRIMARY KEY,"
                "  status TEXT,"
                "  config_file TEXT,"
                "  error TEXT,"
                "  output_path TEXT,"
                "  created_at DATETIME,"
                "  updated_at DATETIME,"
                "  expiry_seconds INTEGER,"
                "  output TEXT,"
                "  is_expired BOOLEAN DEFAULT 0"
                ")"
            )
        )
        conn.commit()


def _seed_job(db_url: str, job_id: str, status: str) -> None:
    from datetime import UTC
    from datetime import datetime
    from datetime import timedelta

    from sqlalchemy import text

    from agent_host.jobs.event_store import EventStore

    _ensure_job_info_table(db_url)
    engine = EventStore._get_or_create_sync_engine(db_url)
    ts = (datetime.now(UTC) - timedelta(seconds=10)).replace(tzinfo=None)
    with engine.connect() as conn:
        conn.execute(
            text(
                "INSERT OR REPLACE INTO job_info "
                "(job_id, status, created_at, updated_at, expiry_seconds, is_expired) "
                "VALUES (:job_id, :status, :ts, :ts, 3600, 0)"
            ),
            {"job_id": job_id, "status": status, "ts": ts},
        )
        conn.commit()


def _make_store(db_url: str):
    from nat.front_ends.fastapi.async_jobs.job_store import JobStore

    return JobStore(scheduler_address="", db_url=db_url)


@pytest.fixture
def job_db(tmp_path):
    return f"sqlite+aiosqlite:///{tmp_path / 'test_stickiness.db'}"


@pytest.fixture(autouse=True)
def clear_event_store_caches():
    from agent_host.jobs.event_store import EventStore

    EventStore._tables_initialized.clear()
    yield
    EventStore._tables_initialized.clear()


class TestTerminalStatusStickiness:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("terminal_status", ["success", "failure", "interrupted"])
    async def test_success_write_skipped_when_already_terminal(self, job_db, terminal_status):
        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

        _seed_job(job_db, "job-1", terminal_status)
        store = _make_store(job_db)

        written = await _update_status_if_not_terminal(store, "job-1", JobStatus.SUCCESS, output={"report": "r"})

        assert written is False
        job = await store.get_job("job-1")
        assert job.status == terminal_status
        assert job.output is None
        assert job.error is None

    @pytest.mark.asyncio
    async def test_failure_write_skipped_when_already_interrupted(self, job_db):
        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

        _seed_job(job_db, "job-1", "interrupted")
        store = _make_store(job_db)
        await store.update_status("job-1", JobStatus.INTERRUPTED, error="cancelled by user")

        written = await _update_status_if_not_terminal(store, "job-1", JobStatus.FAILURE, error="boom")

        assert written is False
        job = await store.get_job("job-1")
        assert job.status == "interrupted"
        assert job.error == "cancelled by user"

    @pytest.mark.asyncio
    async def test_writes_when_job_still_running(self, job_db):
        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

        _seed_job(job_db, "job-1", "running")
        store = _make_store(job_db)

        written = await _update_status_if_not_terminal(store, "job-1", JobStatus.SUCCESS, output={"report": "r"})

        assert written is True
        job = await store.get_job("job-1")
        assert job.status == "success"
        assert json.loads(job.output) == {"report": "r"}

    @pytest.mark.asyncio
    async def test_running_to_running_write_is_allowed(self, job_db):
        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

        _seed_job(job_db, "job-1", "running")
        store = _make_store(job_db)

        assert await _update_status_if_not_terminal(store, "job-1", JobStatus.RUNNING) is True
        assert (await store.get_job("job-1")).status == "running"

    @pytest.mark.asyncio
    async def test_missing_job_raises_value_error(self, job_db):
        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

        _ensure_job_info_table(job_db)
        store = _make_store(job_db)

        with pytest.raises(ValueError, match="job-missing"):
            await _update_status_if_not_terminal(store, "job-missing", JobStatus.FAILURE, error="boom")

    @pytest.mark.asyncio
    async def test_basemodel_output_serialized_like_nat(self, job_db):
        from pydantic import BaseModel

        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

        class _Out(BaseModel):
            report: str

        _seed_job(job_db, "job-1", "running")
        _seed_job(job_db, "job-2", "running")
        store = _make_store(job_db)

        await _update_status_if_not_terminal(store, "job-1", JobStatus.SUCCESS, output=_Out(report="r"))
        await store.update_status("job-2", JobStatus.SUCCESS, output=_Out(report="r"))

        assert (await store.get_job("job-1")).output == (await store.get_job("job-2")).output


class TestTerminalStickinessUnderRace:
    _REAPER_ERROR = "Job timed out (no heartbeat received from worker)"

    @pytest.mark.asyncio
    async def test_reaper_failure_before_runner_write_stays_failure(self, job_db):
        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

        _seed_job(job_db, "job-1", "running")

        reaped = await _update_status_if_not_terminal(
            _make_store(job_db), "job-1", JobStatus.FAILURE, error=self._REAPER_ERROR
        )
        assert reaped is True

        finalized = await _update_status_if_not_terminal(
            _make_store(job_db), "job-1", JobStatus.SUCCESS, output={"report": "late"}
        )
        assert finalized is False

        job = await _make_store(job_db).get_job("job-1")
        assert job.status == "failure"
        assert job.error == self._REAPER_ERROR
        assert job.output is None

    @pytest.mark.asyncio
    async def test_runner_success_before_reaper_write_stays_success(self, job_db):
        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

        _seed_job(job_db, "job-1", "running")

        finalized = await _update_status_if_not_terminal(
            _make_store(job_db), "job-1", JobStatus.SUCCESS, output={"report": "r"}
        )
        assert finalized is True

        reaped = await _update_status_if_not_terminal(
            _make_store(job_db), "job-1", JobStatus.FAILURE, error=self._REAPER_ERROR
        )
        assert reaped is False

        job = await _make_store(job_db).get_job("job-1")
        assert job.status == "success"
        assert json.loads(job.output) == {"report": "r"}
        assert job.error is None

    @pytest.mark.asyncio
    async def test_concurrent_terminal_writes_have_exactly_one_winner(self, job_db):
        from nat.front_ends.fastapi.async_jobs.job_store import JobStatus

        _seed_job(job_db, "job-1", "running")

        results = await asyncio.gather(
            _update_status_if_not_terminal(_make_store(job_db), "job-1", JobStatus.SUCCESS, output={"report": "r"}),
            _update_status_if_not_terminal(_make_store(job_db), "job-1", JobStatus.FAILURE, error=self._REAPER_ERROR),
        )

        assert sorted(results) == [False, True]

        job = await _make_store(job_db).get_job("job-1")
        if job.status == "success":
            assert json.loads(job.output) == {"report": "r"}
            assert job.error is None
        else:
            assert job.status == "failure"
            assert job.error == self._REAPER_ERROR
            assert job.output is None


class TestCancellationMonitorStopStatuses:
    def _monitor(self) -> CancellationMonitor:
        return CancellationMonitor(
            db_url="sqlite:///test.db",
            job_id="job-1",
            poll_interval=0.01,
        )

    @staticmethod
    def _patch_job_store(monkeypatch, status: str) -> None:
        import nat.front_ends.fastapi.async_jobs.job_store as nat_job_store

        class FakeJobStore:
            def __init__(self, scheduler_address=None, db_url=None, db_engine=None):
                pass

            async def get_job(self, job_id):
                return SimpleNamespace(status=status)

        monkeypatch.setattr(nat_job_store, "JobStore", FakeJobStore)

    @pytest.mark.asyncio
    async def test_monitor_stops_on_interrupted(self, monkeypatch):
        self._patch_job_store(monkeypatch, "interrupted")
        monitor = self._monitor()

        await asyncio.wait_for(monitor._poll_job_status(), timeout=2.0)

        assert monitor.is_cancelled

    @pytest.mark.asyncio
    async def test_monitor_stops_on_failure(self, monkeypatch):
        self._patch_job_store(monkeypatch, "failure")
        monitor = self._monitor()

        await asyncio.wait_for(monitor._poll_job_status(), timeout=2.0)

        assert monitor.is_cancelled

    @pytest.mark.asyncio
    async def test_monitor_keeps_running_job_alive(self, monkeypatch):
        self._patch_job_store(monkeypatch, "running")
        monitor = self._monitor()

        task = asyncio.create_task(monitor._poll_job_status())
        await asyncio.sleep(0.1)

        assert not monitor.is_cancelled
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


class TestSanitizeJobError:
    def test_internal_error_never_leaks_exception_text(self):
        message = sanitize_job_error(RuntimeError("postgresql://user:s3cret@db.internal:5432/jobs failed"))

        assert message == "The job failed due to an internal error."
        assert "s3cret" not in message
        assert "db.internal" not in message

    def test_timeout_classified(self):
        assert sanitize_job_error(TimeoutError("upstream at 10.0.0.5 timed out")) == (
            "The job timed out while waiting on an external service."
        )

    def test_connection_error_classified(self):
        message = sanitize_job_error(ConnectionError("refused by 10.0.0.5:5432"))

        assert message == "A connection error occurred while running the job."
        assert "10.0.0.5" not in message

    def test_llm_provider_error_classified_by_module(self):
        class FakeProviderError(Exception):
            pass

        FakeProviderError.__module__ = "openai.error"

        message = sanitize_job_error(FakeProviderError("401 from https://api.example.com key=sk-abc"))

        assert message == "The LLM provider returned an error while running the job."
        assert "sk-abc" not in message

    def test_a_zdr_refusal_is_named_not_generic(self):
        from agent.common.canned_replies import ZDR_MODEL_REFUSED_MESSAGE

        class FakeProviderError(Exception):
            pass

        FakeProviderError.__module__ = "openai.error"

        refusal = FakeProviderError("Error code: 404 - No endpoints found matching your data policy")

        assert sanitize_job_error(refusal) == ZDR_MODEL_REFUSED_MESSAGE

    def test_network_stack_error_classified_by_module(self):
        class FakeTransportError(Exception):
            pass

        FakeTransportError.__module__ = "httpx"

        message = sanitize_job_error(FakeTransportError("connect to internal-host:8443 failed"))

        assert message == "A connection error occurred while running the job."
        assert "internal-host" not in message

    def test_budget_exceeded_error_message_persisted_verbatim(self):
        from agent.common import RunBudgetExceededError

        message = sanitize_job_error(RunBudgetExceededError(ceiling=50_000, used=50_123))

        assert message == "run exceeded the configured completion-token budget of 50000"


class TestBudgetMessagesSurvive:
    def test_organization_budget_exhaustion_keeps_its_actionable_message(self) -> None:
        from agent.common.cost_tracking import BudgetExceededError

        message = sanitize_job_error(BudgetExceededError("organization"))

        assert "budget is exhausted" in message
        assert "raise limits" in message


class TestResolveDeepResearchCheckpointer:
    @pytest.mark.asyncio
    async def test_returns_none_for_non_deep_research_agent(self):
        fn_config = SimpleNamespace(type="research_agent", checkpoint_db="./checkpoints.db")

        result = await _resolve_deep_research_checkpointer(fn_config)

        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_checkpoint_db_unset(self):
        fn_config = SimpleNamespace(type="deep_research_agent", checkpoint_db=None)

        result = await _resolve_deep_research_checkpointer(fn_config)

        assert result is None

    @pytest.mark.asyncio
    async def test_builds_checkpointer_via_get_checkpointer_when_configured(self):
        import agent.common as common_module

        fn_config = SimpleNamespace(type="deep_research_agent", checkpoint_db="./deep_research_checkpoints.db")
        fake_checkpointer = MagicMock(name="fake_checkpointer")
        get_checkpointer_mock = AsyncMock(return_value=fake_checkpointer)

        with patch.object(common_module, "get_checkpointer", get_checkpointer_mock):
            result = await _resolve_deep_research_checkpointer(fn_config)

        get_checkpointer_mock.assert_awaited_once_with("./deep_research_checkpoints.db")
        assert result is fake_checkpointer


class TestCreateAgentInstanceForwardsCheckpointer:
    def test_deep_research_agent_receives_checkpointer(self):
        from agent.agents.deep_researcher.register import DeepResearchAgentConfig

        fn_config = DeepResearchAgentConfig(orchestrator_llm="llm")
        fake_checkpointer = MagicMock(name="fake_checkpointer")
        captured_kwargs = {}

        def _agent_cls(*args, **kwargs):
            captured_kwargs.update(kwargs)
            return MagicMock()

        _create_agent_instance(
            agent_cls=_agent_cls,
            llm_provider=MagicMock(),
            llm=MagicMock(),
            tools=[],
            fn_config=fn_config,
            verbose=False,
            callbacks=[],
            job_id="job-1",
            checkpointer=fake_checkpointer,
        )

        assert captured_kwargs["checkpointer"] is fake_checkpointer

    def test_deep_research_agent_defaults_checkpointer_to_none(self):
        from agent.agents.deep_researcher.register import DeepResearchAgentConfig

        fn_config = DeepResearchAgentConfig(orchestrator_llm="llm")
        captured_kwargs = {}

        def _agent_cls(*args, **kwargs):
            captured_kwargs.update(kwargs)
            return MagicMock()

        _create_agent_instance(
            agent_cls=_agent_cls,
            llm_provider=MagicMock(),
            llm=MagicMock(),
            tools=[],
            fn_config=fn_config,
            verbose=False,
            callbacks=[],
            job_id="job-1",
        )

        assert captured_kwargs["checkpointer"] is None

    def test_deep_research_agent_receives_max_run_seconds(self):
        from agent.agents.deep_researcher.register import DeepResearchAgentConfig

        fn_config = DeepResearchAgentConfig(orchestrator_llm="llm", max_run_seconds=999)
        captured_kwargs = {}

        def _agent_cls(*args, **kwargs):
            captured_kwargs.update(kwargs)
            return MagicMock()

        _create_agent_instance(
            agent_cls=_agent_cls,
            llm_provider=MagicMock(),
            llm=MagicMock(),
            tools=[],
            fn_config=fn_config,
            verbose=False,
            callbacks=[],
            job_id="job-1",
        )

        assert captured_kwargs["max_run_seconds"] == 999

    def test_deep_research_agent_receives_max_run_seconds_zero(self):
        from agent.agents.deep_researcher.register import DeepResearchAgentConfig

        fn_config = DeepResearchAgentConfig(orchestrator_llm="llm", max_run_seconds=0)
        captured_kwargs = {}

        def _agent_cls(*args, **kwargs):
            captured_kwargs.update(kwargs)
            return MagicMock()

        _create_agent_instance(
            agent_cls=_agent_cls,
            llm_provider=MagicMock(),
            llm=MagicMock(),
            tools=[],
            fn_config=fn_config,
            verbose=False,
            callbacks=[],
            job_id="job-1",
        )

        assert captured_kwargs["max_run_seconds"] == 0


class TestWallClockTimeout:
    def test_wall_clock_timeout_uses_curated_message(self):
        message = sanitize_job_error(TimeoutError("deep research exceeded the 2400 s wall-clock budget"))
        assert message == _WALL_CLOCK_TIMEOUT_MSG

    def test_wall_clock_timeout_case_insensitive(self):
        message = sanitize_job_error(TimeoutError("WALL-CLOCK"))
        assert message == _WALL_CLOCK_TIMEOUT_MSG

    def test_generic_timeout_not_confused_with_wall_clock(self):
        message = sanitize_job_error(TimeoutError("connection to upstream timed out"))
        assert message == "The job timed out while waiting on an external service."


class TestGraphRecursionErrorClassification:
    def test_graph_recursion_uses_curated_message(self):
        try:
            from langgraph.errors import GraphRecursionError
        except ImportError:
            pytest.skip("langgraph not installed")

        message = sanitize_job_error(GraphRecursionError("Recursion limit reached"))
        assert message == _GRAPH_RECURSION_ERROR_MSG

    def test_graph_recursion_not_confused_with_internal_error(self):
        try:
            from langgraph.errors import GraphRecursionError
        except ImportError:
            pytest.skip("langgraph not installed")

        message = sanitize_job_error(GraphRecursionError("some error"))
        assert "internal error" not in message


class TestPurgeDeepCheckpointImportable:
    def test_purge_function_exists_in_runner(self):
        assert callable(_purge_deep_checkpoint)

    def test_purge_is_noop_without_dsn(self, monkeypatch):
        monkeypatch.delenv("DEEP_CHECKPOINT_DB", raising=False)
        _purge_deep_checkpoint("job-x")  # must not raise


class TestExtractSkillsActivated:
    def test_reads_it_off_an_agent_state(self) -> None:
        state = SimpleNamespace(skills_activated=["oib-brandschutznachweis"])
        assert extract_skills_activated(state) == ["oib-brandschutznachweis"]

    def test_reads_it_off_a_dict_result(self) -> None:
        assert extract_skills_activated({"skills_activated": ["a", "b"]}) == ["a", "b"]

    def test_an_agent_without_the_field_simply_has_none(self) -> None:
        assert extract_skills_activated(SimpleNamespace()) is None
        assert extract_skills_activated({}) is None
        assert extract_skills_activated("just a report string") is None

    def test_an_empty_or_malformed_list_is_none_not_an_empty_claim(self) -> None:
        assert extract_skills_activated(SimpleNamespace(skills_activated=[])) is None
        assert extract_skills_activated(SimpleNamespace(skills_activated="oib")) is None
        assert extract_skills_activated(SimpleNamespace(skills_activated=[None, 3, "ok"])) == ["ok"]


class TestCardFailureIsADegradedReason:
    def test_appends_after_the_agent_reasons_without_duplicating(self) -> None:
        transparency: dict = {"degraded_reasons": ["no_valid_citations"]}

        mark_degraded(transparency, "cards_generation_failed")
        mark_degraded(transparency, "cards_generation_failed")

        assert transparency["degraded_reasons"] == ["no_valid_citations", "cards_generation_failed"]

    def test_creates_the_list_when_the_agent_recorded_none(self) -> None:
        transparency: dict = {"research_truncated": True}

        mark_degraded(transparency, "cards_generation_failed")

        assert transparency == {"research_truncated": True, "degraded_reasons": ["cards_generation_failed"]}

    @pytest.mark.asyncio
    async def test_generate_answer_cards_reports_a_lost_attempt(self) -> None:
        with patch(
            "agent.cards.generate.generate_cards_result",
            AsyncMock(side_effect=RuntimeError("the worker has no card model")),
        ):
            result = await _generate_answer_cards(MagicMock(), "q", "report")

        assert result.cards is None
        assert result.failed is True


class TestExtractAnswerTransparency:
    def test_reads_the_cutoff_off_an_agent_state(self) -> None:
        state = SimpleNamespace(research_truncated=True, truncation_reason="wall_clock")
        assert extract_answer_transparency(state) == {
            "research_truncated": True,
            "truncation_reason": "wall_clock",
        }

    def test_reads_it_off_a_dict_result(self) -> None:
        result = {
            "research_truncated": True,
            "truncation_reason": "step_limit",
            "degraded_reasons": ["no_report_file"],
        }
        assert extract_answer_transparency(result) == result

    def test_a_clean_run_contributes_nothing(self) -> None:
        assert extract_answer_transparency(SimpleNamespace()) == {}
        assert extract_answer_transparency({}) == {}
        assert extract_answer_transparency("just a report string") == {}

    def test_a_completed_run_is_absent_not_false(self) -> None:
        state = SimpleNamespace(research_truncated=None, truncation_reason=None, degraded_reasons=None)
        assert extract_answer_transparency(state) == {}
        assert extract_answer_transparency(SimpleNamespace(research_truncated=False)) == {}

    def test_only_literal_true_counts_as_a_cutoff(self) -> None:
        assert extract_answer_transparency(SimpleNamespace(research_truncated=1)) == {}
        assert extract_answer_transparency(SimpleNamespace(research_truncated="yes")) == {}

    def test_a_malformed_reason_is_dropped_rather_than_forwarded(self) -> None:
        assert extract_answer_transparency(SimpleNamespace(truncation_reason="")) == {}
        assert extract_answer_transparency(SimpleNamespace(truncation_reason="   ")) == {}
        assert extract_answer_transparency(SimpleNamespace(truncation_reason=17)) == {}

    def test_degraded_reasons_keeps_only_the_stable_tokens(self) -> None:
        state = SimpleNamespace(degraded_reasons=["no_report_file", None, 3, "", "no_valid_citations"])
        assert extract_answer_transparency(state) == {"degraded_reasons": ["no_report_file", "no_valid_citations"]}

    def test_an_empty_degraded_list_is_not_a_claim(self) -> None:
        assert extract_answer_transparency(SimpleNamespace(degraded_reasons=[])) == {}
        assert extract_answer_transparency(SimpleNamespace(degraded_reasons="no_report_file")) == {}

    def test_citations_removed_survives_the_job_path_too(self) -> None:
        removed = {"count": 2, "reasons": ["dead link"]}
        assert extract_answer_transparency(SimpleNamespace(citations_removed=removed)) == {"citations_removed": removed}
        assert extract_answer_transparency(SimpleNamespace(citations_removed={})) == {}
        assert extract_answer_transparency(SimpleNamespace(citations_removed="two")) == {}


class TestBuildJobOutput:
    def test_a_clean_run_is_just_the_report(self) -> None:
        assert build_job_output("# Report", cards=None, transparency={}) == {"report": "# Report"}

    def test_the_transparency_fields_land_next_to_the_report(self) -> None:
        output = build_job_output(
            "# Report",
            cards=[{"type": "next_step"}],
            transparency={
                "research_truncated": True,
                "truncation_reason": "wall_clock",
                "degraded_reasons": ["no_valid_citations"],
            },
        )
        assert output == {
            "report": "# Report",
            "cards": [{"type": "next_step"}],
            "research_truncated": True,
            "truncation_reason": "wall_clock",
            "degraded_reasons": ["no_valid_citations"],
        }

    def test_a_state_straight_off_the_agent_reaches_the_output(self) -> None:
        state = SimpleNamespace(
            research_truncated=True,
            truncation_reason="step_limit",
            degraded_reasons=["no_report_file"],
            citations_removed={"count": 1},
        )
        output = build_job_output("# Report", cards=None, transparency=extract_answer_transparency(state))
        assert output["research_truncated"] is True
        assert output["truncation_reason"] == "step_limit"
        assert output["degraded_reasons"] == ["no_report_file"]
        assert output["citations_removed"] == {"count": 1}

    def test_nothing_empty_is_written(self) -> None:
        output = build_job_output("# Report", cards=[], transparency=extract_answer_transparency({}))
        assert output == {"report": "# Report"}


class TestDegradedEvent:
    def test_the_event_type_is_a_job_lifecycle_event(self) -> None:
        assert JOB_DEGRADED_EVENT_TYPE == "job.degraded"

    def test_the_payload_carries_only_the_stable_tokens(self) -> None:
        assert _DEGRADED_EVENT_FIELDS == ("research_truncated", "truncation_reason", "degraded_reasons")
        assert "citations_removed" not in _DEGRADED_EVENT_FIELDS


class TestExtractAnswerConfidence:
    def test_the_level_and_its_reasons_ride_the_transparency_dict(self) -> None:
        state = SimpleNamespace(
            answer_confidence="low",
            answer_confidence_reason="Keine bindende Quelle gefunden.",
            answer_confidence_capped_reason="ungrounded",
        )
        assert extract_answer_transparency(state) == {
            "answer_confidence": "low",
            "answer_confidence_reason": "Keine bindende Quelle gefunden.",
            "answer_confidence_capped_reason": "ungrounded",
        }

    def test_reads_it_off_a_dict_result_too(self) -> None:
        assert extract_answer_transparency({"answer_confidence": "high"}) == {"answer_confidence": "high"}

    def test_an_agent_that_does_not_record_it_yet_writes_nothing(self) -> None:
        assert extract_answer_transparency(SimpleNamespace()) == {}
        assert extract_answer_transparency(SimpleNamespace(answer_confidence=None)) == {}

    def test_a_malformed_level_is_dropped_rather_than_forwarded(self) -> None:
        assert extract_answer_transparency(SimpleNamespace(answer_confidence="")) == {}
        assert extract_answer_transparency(SimpleNamespace(answer_confidence="   ")) == {}
        assert extract_answer_transparency(SimpleNamespace(answer_confidence=3)) == {}
        assert extract_answer_transparency(SimpleNamespace(answer_confidence_reason=[])) == {}

    def test_confidence_is_not_a_degraded_run(self) -> None:
        for field_name in ANSWER_CONFIDENCE_FIELDS:
            assert field_name not in _DEGRADED_EVENT_FIELDS

    def test_the_confidence_fields_land_in_the_job_output(self) -> None:
        state = SimpleNamespace(answer_confidence="medium", answer_confidence_reason="Nur eine Quelle.")
        output = build_job_output("# Report", cards=None, transparency=extract_answer_transparency(state))
        assert output["answer_confidence"] == "medium"
        assert output["answer_confidence_reason"] == "Nur eine Quelle."


class TestTransparencyReachesBothSurfaces:
    @pytest.mark.asyncio
    async def test_every_field_lands_in_the_output_and_in_the_metadata(self) -> None:
        state = SimpleNamespace(
            research_truncated=True,
            truncation_reason="wall_clock",
            degraded_reasons=["no_report_file"],
            citations_removed={"count": 1, "reasons": ["duplicate"]},
            answer_confidence="low",
            answer_confidence_reason="Recherche abgebrochen.",
            answer_confidence_capped_reason="ungrounded",
        )
        transparency = extract_answer_transparency(state)

        output = build_job_output("# Report", cards=None, transparency=transparency)

        with patch(
            "agent_host.jobs.conversation_output.post_internal_conversation_message",
            new_callable=AsyncMock,
        ) as post:
            await write_job_turn(
                conversation_id="s_abc",
                job_id="job-1",
                usage_context={"identity": {"organization_id": "org_1"}},
                prompt="q",
                answer="# Report",
                transparency=transparency,
            )
        metadata = post.await_args_list[-1].kwargs["metadata"]

        for key, value in transparency.items():
            assert output[key] == value, key
            assert metadata[key] == value, key

    @pytest.mark.asyncio
    async def test_a_clean_run_marks_neither_surface(self) -> None:
        transparency = extract_answer_transparency(SimpleNamespace())
        assert build_job_output("# Report", cards=None, transparency=transparency) == {"report": "# Report"}

        with patch(
            "agent_host.jobs.conversation_output.post_internal_conversation_message",
            new_callable=AsyncMock,
        ) as post:
            await write_job_turn(
                conversation_id="s_abc",
                job_id="job-1",
                usage_context={"identity": {"organization_id": "org_1"}},
                prompt="q",
                answer="# Report",
                transparency=transparency,
            )
        metadata = post.await_args_list[-1].kwargs["metadata"]
        assert "research_truncated" not in metadata
        assert "answer_confidence" not in metadata

    @pytest.mark.asyncio
    async def test_a_transparency_failure_cannot_fail_the_job(self) -> None:
        with patch(
            "agent_host.jobs.conversation_output.post_internal_conversation_message",
            new_callable=AsyncMock,
        ) as post:
            await write_job_turn(
                conversation_id="s_abc",
                job_id="job-1",
                usage_context={"identity": {"organization_id": "org_1"}},
                prompt="q",
                answer="# Report",
                transparency="research_truncated",  # type: ignore[arg-type]
            )

        assert post.await_args_list[-1].kwargs["text"] == "# Report"


class TestWorkerHeaderTextEncoding:
    GERMAN_CONTEXT = "Projekt: Holzbau Wien\nNotiz: Der Nachweis „GK 5 — Fluchtniveau 12 m“ fehlt noch."

    def test_raw_german_text_is_not_header_safe(self) -> None:
        from starlette.datastructures import Headers

        with pytest.raises(UnicodeEncodeError):
            Headers(headers={"x-grid-project-context": self.GERMAN_CONTEXT})

    def test_encoded_text_is_header_safe_and_round_trips(self) -> None:
        from starlette.datastructures import Headers

        from agent.project_context import RequestContext

        encoded = _b64url_encode_text(self.GERMAN_CONTEXT)
        assert encoded.isascii()
        headers = Headers(headers={"x-grid-project-context": encoded})
        ctx = RequestContext.from_headers(dict(headers))
        assert ctx.project_context == self.GERMAN_CONTEXT


class TestTheReportsOwnAccountReachesTheMessage:
    def test_the_retrieval_ledger_and_the_hidden_skills_are_lifted(self) -> None:
        from types import SimpleNamespace

        from agent_host.jobs.run_result import extract_answer_transparency

        state = SimpleNamespace(retrieval_ledger=[{"round": 0}], skills_hidden=["house-voice", 3, ""])
        assert extract_answer_transparency(state) == {
            "retrieval_ledger": [{"round": 0}],
            "skills_hidden": ["house-voice"],
        }

    def test_an_empty_ledger_or_list_writes_nothing(self) -> None:
        from types import SimpleNamespace

        from agent_host.jobs.run_result import extract_answer_transparency

        assert extract_answer_transparency(SimpleNamespace(retrieval_ledger=[], skills_hidden=[])) == {}


class TestReportFollowUps:
    @pytest.mark.asyncio
    async def test_the_org_flag_gates_the_stage_like_a_chat_turn(self, monkeypatch) -> None:
        from unittest.mock import AsyncMock

        from agent_host.jobs import runner

        monkeypatch.setattr(
            "agent.stages.flags.resolve_enabled_stages", AsyncMock(return_value=frozenset({"memory_reflection"}))
        )
        llm = AsyncMock()
        assert await runner._propose_report_follow_ups(llm, query="q", report="r", organization_id="org") is None
        llm.ainvoke.assert_not_called()

    @pytest.mark.asyncio
    async def test_the_stages_handler_payload_rides_the_message(self, monkeypatch) -> None:
        from unittest.mock import AsyncMock

        from agent_host.jobs import runner

        monkeypatch.setattr(
            "agent.stages.flags.resolve_enabled_stages", AsyncMock(return_value=frozenset({"follow_ups"}))
        )
        import dataclasses

        from agent.stages import follow_ups as follow_ups_module

        stage = dataclasses.replace(
            follow_ups_module.FOLLOW_UPS, handler=AsyncMock(return_value={"items": [{"question": "Und in GK 5?"}]})
        )
        monkeypatch.setattr(follow_ups_module, "FOLLOW_UPS", stage)
        payload = await runner._propose_report_follow_ups(object(), query="q", report="r", organization_id="org")
        assert payload == {"items": [{"question": "Und in GK 5?"}]}


class TestTheFindingsRideIntoMemory:
    def test_each_finding_is_one_line_after_the_report(self) -> None:
        from agent_host.jobs.runner import _reflection_text

        text = _reflection_text(
            "Bericht.",
            {
                "items": [
                    {"requirement": "Feuerwiderstand", "value": "REI 60", "status": "met", "comment": "x"},
                    {"requirement": "Fluchtweg", "status": "open", "comment": "Fluchtniveau unbekannt."},
                ]
            },
        )
        assert text == (
            "Bericht.\n\n## Befunde\n- Feuerwiderstand — REI 60 — met\n- Fluchtweg — open (Fluchtniveau unbekannt.)"
        )

    def test_a_row_without_a_status_states_none(self) -> None:
        from agent_host.jobs.runner import _reflection_text

        text = _reflection_text("Bericht.", {"items": [{"requirement": "Stellplätze", "value": "12"}]})
        assert text == "Bericht.\n\n## Befunde\n- Stellplätze — 12"

    def test_no_findings_leaves_the_report_as_it_was(self) -> None:
        from agent_host.jobs.runner import _reflection_text

        assert _reflection_text("Bericht.", None) == "Bericht."
        assert _reflection_text("Bericht.", {"items": []}) == "Bericht."


class TestReportReflectionHasNoScopeCheck:
    def test_the_reflection_takes_no_collection_scope(self) -> None:
        import inspect

        from agent_host.jobs import runner

        assert "collection_scope" not in inspect.signature(runner._run_deep_research_reflection).parameters

    @pytest.mark.asyncio
    async def test_a_report_still_reflects(self, monkeypatch) -> None:
        from agent import common
        from agent_host.jobs import runner

        get_llm = AsyncMock(side_effect=RuntimeError("stop before the model call"))
        monkeypatch.setattr(common, "get_langchain_llm", get_llm)
        await runner._run_deep_research_reflection(
            builder=object(),
            job_id="job-1",
            reflection_llm_ref="card_llm",
            reflection_enabled=True,
            query="q",
            report="Bericht.",
            usage_context={"identity": {"project_id": "p1", "organization_id": "o1"}},
            memory_digest=None,
            org_credential=None,
            model_overrides=None,
        )
        get_llm.assert_called_once()
