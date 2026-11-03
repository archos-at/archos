"""The ``ingest-document`` workflow as we hand it to Hatchet, and one attempt of each step.

No engine runs here: the fake client (``agent_testing.hatchet_fake``) records
the declaration, and a test calls a step's function with a fake ``Context``.
What a real engine does with it (the retries, the cancel, the fairness and the
cap) is ``test_ingest_hatchet_engine.py``'s, the main evidence, which runs
against one. These pin our own logic around one attempt.
"""

from __future__ import annotations

import io
import json
from datetime import datetime
from unittest.mock import patch

import pytest
from agent_testing import hatchet_fake
from agent_testing.hatchet_fake import FakeContext
from hatchet_sdk import ConcurrencyLimitStrategy
from hatchet_sdk import NonRetryableException
from hatchet_sdk import RetryAfterException
from hatchet_sdk.exceptions import TaskRunError

from agent.common import bff_http
from agent.common import hatchet_client
from agent.common.task_failures import TransientTaskError
from agent.knowledge import ingest_execution
from agent.knowledge import ingest_hatchet
from agent.knowledge import ingest_run_hold
from agent.knowledge import ingest_status_store
from agent.knowledge.base import PreparedIngestJob
from agent.knowledge.ingest_hatchet import IngestDocumentInput
from agent.knowledge.schema import FileProgress
from agent.knowledge.schema import FileStatus
from agent.knowledge.schema import IngestionJobStatus
from agent.knowledge.schema import JobState


@pytest.fixture
def hatchet():
    fake = hatchet_fake.install()
    yield fake
    hatchet_client.reset_for_tests(None)


@pytest.fixture
def db(tmp_path, monkeypatch):
    url = f"sqlite:///{tmp_path}/jobs.db"
    monkeypatch.setenv("SUMMARY_DB", url)
    yield url
    ingest_status_store._initialized.discard(url)


def _status(job_id: str = "job-1", state: JobState = JobState.PENDING, files=None) -> IngestionJobStatus:
    return IngestionJobStatus(
        job_id=job_id,
        status=state,
        submitted_at=datetime(2026, 11, 3, 10, 0, 0),
        total_files=1,
        collection_name="proj_1",
        backend="llamaindex",
        file_details=files or [],
    )


def _prepared(job_id: str = "job-1") -> PreparedIngestJob:
    return PreparedIngestJob(job_id, _status(job_id), ["<download>"], "proj_1", {"organization_id": "org-1"})


class _Ingestor:
    """Ends every job the way ``ends`` says, as the adapter would write it."""

    supports_durable_jobs = True

    def __init__(self, ends=None, *, while_running=None) -> None:
        self.ends = ends
        self.while_running = while_running
        self.ran: list[str] = []

    def run_prepared(self, prepared, still_owner=None) -> None:
        self.ran.append(prepared.job_id)
        if self.while_running is not None:
            self.while_running(prepared, still_owner)
        if self.ends is not None:
            ingest_status_store.put(self.ends(prepared))

    def get_job_status(self, job_id):
        return ingest_status_store.get(job_id)


def _completed(prepared):
    return _status(prepared.job_id, JobState.COMPLETED)


def _failed(retryable: bool, message: str):
    def ends(prepared):
        detail = FileProgress(file_id="f", file_name="plan.pdf", status=FileStatus.FAILED, error_message=message)
        detail.retryable = retryable
        failed = _status(prepared.job_id, JobState.FAILED, [detail])
        failed.error_message = "1/1 file(s) failed"
        return failed

    return ends


@pytest.fixture
def serving(monkeypatch):
    """The workflow as served: an ingestor, and a decode that hands back ``_prepared``."""

    def start(ingestor):
        monkeypatch.setattr(ingest_hatchet._runtime, "ingestor", ingestor)
        monkeypatch.setattr(ingest_hatchet._runtime, "decode", lambda payload: _prepared(json.loads(payload)["job"]))
        return ingestor

    return start


def _input(job_id: str = "job-1") -> IngestDocumentInput:
    return IngestDocumentInput(
        job_id=job_id, organization_id="org-1", priority="interactive", payload=json.dumps({"job": job_id})
    )


def _index(_hatchet=None):
    """One attempt of the ``index`` step: our function, called as the worker calls it."""
    return ingest_hatchet.execute


# ------------------------------------------------------------- wiring


def test_the_dag_settles_after_indexing_and_on_failure(hatchet):
    """The one wiring check without an engine: which step follows which. The rest is the engine tests'."""
    workflow = ingest_hatchet.ingest_workflow()

    index = workflow.step("index")
    assert workflow.step("settle").options["parents"] == [index]
    assert workflow.step("settle-failed").on_failure is True
    assert "parents" not in index.options


async def test_the_workers_lifespan_holds_the_ingestor_for_the_steps(hatchet):
    import contextlib

    ingestor = _Ingestor()

    @contextlib.asynccontextmanager
    async def lifespan():
        yield ingestor

    ingest_hatchet.serve(lifespan, lambda payload: None, slots=1)
    worker_lifespan = hatchet.workers[0].lifespan()

    assert await anext(worker_lifespan) is ingestor
    assert ingest_hatchet._runtime.ingestor is ingestor
    with pytest.raises(StopAsyncIteration):
        await anext(worker_lifespan)
    assert ingest_hatchet._runtime.ingestor is None


# ------------------------------------------------------------- index step


def test_a_completed_job_ends_the_step_with_ids_only(db, serving):
    serving(_Ingestor(_completed))
    ingest_status_store.put(_status())

    out = _index()(_input(), FakeContext())

    assert out == {"job_id": "job-1", "status": "completed"}


def test_the_run_goes_on_while_it_is_not_cancelled(db, serving):
    seen = []
    serving(_Ingestor(_completed, while_running=lambda prepared, still_owner: seen.append(still_owner())))

    _index()(_input(), FakeContext())

    assert seen == [True]


def test_a_failure_of_the_bytes_is_not_tried_again(db, serving):
    serving(_Ingestor(_failed(False, "no content extracted")))

    with pytest.raises(NonRetryableException) as raised:
        _index()(_input(), FakeContext(attempt=1))

    assert "plan.pdf" not in str(raised.value)
    assert ingest_status_store.get("job-1").status == JobState.FAILED


def test_a_failure_of_the_moment_waits_for_the_next_attempt_and_reads_pending(db, serving):
    serving(_Ingestor(_failed(True, "original_download_failed: x")))

    with pytest.raises(RuntimeError, match="tried again"):
        _index()(_input(), FakeContext(attempt=1, max_attempts=3))

    waiting = ingest_status_store.get("job-1")
    assert waiting.status == JobState.PENDING
    assert waiting.metadata[ingest_execution.RETRYING_KEY]["attempt"] == 1


def test_a_failure_of_the_moment_on_the_last_attempt_is_final(db, serving):
    serving(_Ingestor(_failed(True, "original_download_failed: x")))

    with pytest.raises(NonRetryableException):
        _index()(_input(), FakeContext(attempt=3, max_attempts=3))

    assert ingest_status_store.get("job-1").status == JobState.FAILED


def test_the_last_attempt_stops_vouching_for_the_row(db, serving, monkeypatch):
    released = []
    monkeypatch.setattr(ingest_hatchet.ingest_run_hold, "release", released.append)
    serving(_Ingestor(_completed))

    _index()(_input(), FakeContext(attempt=1, max_attempts=3))
    assert released == []
    _index()(_input(), FakeContext(attempt=3, max_attempts=3))
    assert released == ["job-1"]


def test_an_unreadable_payload_is_never_run_and_reads_failed(db, serving, monkeypatch):
    ingestor = serving(_Ingestor(_completed))
    monkeypatch.setattr(ingest_hatchet._runtime, "decode", lambda payload: (_ for _ in ()).throw(ValueError("forged")))
    ingest_status_store.put(_status())

    with pytest.raises(NonRetryableException, match="unreadable_job"):
        _index()(_input(), FakeContext())

    assert ingestor.ran == []
    failed = ingest_status_store.get("job-1")
    assert failed.status == JobState.FAILED
    assert failed.error_message == ingest_execution.UNREADABLE_JOB_MESSAGE


def test_a_job_a_person_cancelled_settles_cancelled_even_if_it_wrote_itself_live_again(db, serving):
    def runs_then_writes_live(prepared, still_owner):
        ingest_status_store.put(_status(prepared.job_id, JobState.PROCESSING))
        ingest_run_hold.hold(prepared.job_id, "run-1", 60)  # the dispatch
        ingest_run_hold.mark_stopped_by_person(prepared.job_id)  # the cancel route, before its cancel
        ingest_status_store.settle_cancelled(prepared.job_id)  # the cancel route
        ingest_status_store.put(_status(prepared.job_id, JobState.PROCESSING))  # a write before its next check

    serving(_Ingestor(while_running=runs_then_writes_live))

    out = _index()(_input(), FakeContext(cancelled=True))

    assert out["status"] == "cancelled"
    assert ingest_status_store.get("job-1").status == JobState.CANCELLED


def test_a_last_attempt_out_of_time_settles_interrupted(db, serving, monkeypatch):
    monkeypatch.setenv("INGEST_MAX_JOB_SECONDS", "60")
    readings = iter([0.0])
    monkeypatch.setattr(ingest_hatchet, "_monotonic", lambda: next(readings, 61.0))
    serving(_Ingestor(lambda prepared: _status(prepared.job_id, JobState.PROCESSING)))

    out = _index()(_input(), FakeContext(attempt=3, max_attempts=3, cancelled=True))

    assert out["status"] == "timed_out"
    settled = ingest_status_store.get("job-1")
    assert settled.status == JobState.FAILED
    assert settled.error_message.startswith("interrupted:")


def test_a_step_that_ends_without_a_final_status_is_tried_again(db, serving):
    serving(_Ingestor(lambda prepared: _status(prepared.job_id, JobState.PROCESSING)))

    with pytest.raises(RuntimeError, match="without a final status"):
        _index()(_input(), FakeContext())


def test_a_job_that_raises_reaches_hatchet_as_a_class_and_a_category_and_is_tried_again(db, serving):
    """``run_job``'s exception may name the file and its presigned URL; Hatchet stores neither."""
    url = "https://s3.example/uploads/Bauantrag.pdf?X-Amz-Signature=secret"

    def raises(prepared, still_owner):
        try:
            raise OSError(f"reading {url}")
        except OSError as inner:
            raise TimeoutError(f"download of plan.pdf from {url} timed out") from inner

    serving(_Ingestor(while_running=raises))

    with pytest.raises(TransientTaskError) as raised:
        _index()(_input(), FakeContext(attempt=1))

    stored = TaskRunError.from_exception(raised.value, "step-run-1").serialize(include_metadata=True)
    assert str(raised.value) == "TimeoutError (transient)"
    for secret in ("Bauantrag", "s3.example", "plan.pdf", "OSError"):
        assert secret not in stored
    assert raised.value.__cause__ is None and raised.value.__suppress_context__ is True


def test_the_step_refuses_to_run_in_a_process_that_does_not_serve_it(monkeypatch):
    monkeypatch.setattr(ingest_hatchet._runtime, "ingestor", None)

    with pytest.raises(RuntimeError, match="serves it"):
        _index()(_input(), FakeContext())


# ------------------------------------------------------------ settle step


class _Answer(io.BytesIO):
    status = 202

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False


@pytest.fixture
def token(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "test-token")
    monkeypatch.setenv("FRONTEND_INTERNAL_URL", "http://frontend:3000")


def test_the_settle_step_tells_the_bff_which_job_settled(token):
    with patch.object(bff_http._opener, "open", return_value=_Answer(b'{"settled": 1}')) as sent:
        out = ingest_hatchet.settle_step("job-1")

    request = sent.call_args.args[0]
    assert request.full_url == "http://frontend:3000/api/internal/ingest/settled"
    assert json.loads(request.data) == {"job_ids": ["job-1"]}
    assert out == {"job_id": "job-1", "settled": 1}


def _refusal(status: int):
    import urllib.error

    return urllib.error.HTTPError("http://frontend:3000/x", status, "no", {}, io.BytesIO(b"{}"))


def test_a_bff_that_is_away_fails_the_settle_step_so_it_is_tried_again(token):
    with (
        patch.object(bff_http._opener, "open", side_effect=_refusal(503)),
        pytest.raises(TransientTaskError, match=r"^BffRefusedError \(transient\)$"),
    ):
        ingest_hatchet.settle_step("job-1")


def test_a_bff_that_refuses_the_call_is_not_asked_again(token):
    with (
        patch.object(bff_http._opener, "open", side_effect=_refusal(422)),
        pytest.raises(NonRetryableException),
    ):
        ingest_hatchet.settle_step("job-1")


def test_without_a_service_token_nothing_is_sent(monkeypatch):
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)

    with patch.object(bff_http._opener, "open") as sent:
        assert ingest_hatchet.settle_step("job-1") == {"job_id": "job-1", "settled": 0}
    sent.assert_not_called()


# ------------------------------------------------- two workflows, one fairness


def test_both_workflows_share_one_org_limit_and_one_supersede_limit(hatchet):
    standard, heavy = ingest_hatchet.ingest_workflow(), ingest_hatchet.ingest_workflow(heavy=True)

    assert standard.options["name"] == "ingest-document"
    assert heavy.options["name"] == "ingest-document-heavy"
    for workflow in (standard, heavy):
        # The engine refuses tenant-scoped limits on a multi-task workflow, so they sit on index.
        assert "concurrency" not in workflow.options
        org, supersede = workflow.step("index").options["concurrency"]
        assert (org.name, org.expression, org.is_tenant_scoped) == ("ingest-org", "input.organization_id", True)
        assert org.limit_strategy is ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN
        assert org.max_runs == ingest_hatchet.DEFAULT_MAX_RUNS_PER_ORG
        assert (supersede.name, supersede.expression, supersede.max_runs) == (
            "ingest-supersede",
            "input.document_id",
            1,
        )
        assert supersede.limit_strategy is ConcurrencyLimitStrategy.CANCEL_IN_PROGRESS
        assert supersede.is_tenant_scoped is True
    assert [c.to_proto() for c in standard.step("index").options["concurrency"]] == [
        c.to_proto() for c in heavy.step("index").options["concurrency"]
    ]


def test_the_heavy_index_needs_a_highmem_worker_to_itself(hatchet, monkeypatch):
    monkeypatch.setenv("INGEST_HEAVY_WORKER_SLOTS", "2")
    standard = ingest_hatchet.ingest_workflow().step("index").options
    heavy = ingest_hatchet.ingest_workflow(heavy=True).step("index").options

    assert "desired_worker_labels" not in standard and "slot_cost" not in standard
    (label,) = heavy["desired_worker_labels"]
    assert (label.key, label.value, label.required) == ("pool", "highmem", True)
    assert heavy["slot_cost"] == 2
    for options in (standard, heavy):
        assert options["retries"] == ingest_hatchet.RETRIES + ingest_hatchet.CREDIT_WAIT_RETRIES
        assert [limit.static_key for limit in options["rate_limits"]] == ["ingest-provider-credits"]


@pytest.mark.parametrize(
    ("size", "threshold", "workflow"),
    [
        (None, None, "ingest-document"),
        (10 * 1024 * 1024, None, "ingest-document"),
        (40 * 1024 * 1024, None, "ingest-document-heavy"),
        (2_000, "1000", "ingest-document-heavy"),
        (10**12, "0", "ingest-document"),
    ],
)
def test_the_originals_size_picks_the_workflow(hatchet, db, monkeypatch, size, threshold, workflow):
    if threshold is not None:
        monkeypatch.setenv("INGEST_HEAVY_FILE_BYTES", threshold)

    assert ingest_hatchet.trigger("job-1", "org-1", "bulk", "enc:x", document_id="doc-1", byte_size=size)

    (started,) = [w for w in hatchet.workflows if w.runs]
    assert started.options["name"] == workflow
    run = started.runs[0]
    assert run.input.document_id == "doc-1"
    assert run.additional_metadata["job_id"] == "job-1"


def test_a_job_without_a_document_supersedes_nothing_but_itself(hatchet, db):
    ingest_hatchet.trigger("corpus-job", None, "bulk", "enc:x")

    (run,) = hatchet.workflow_runs
    assert run.input.document_id == "corpus-job"


def test_the_heavy_pool_serves_the_heavy_workflow_with_its_label(hatchet, monkeypatch):
    import contextlib

    monkeypatch.setenv("INGEST_HEAVY_WORKER_SLOTS", "3")

    @contextlib.asynccontextmanager
    async def lifespan():
        yield _Ingestor()

    ingest_hatchet.serve(lifespan, lambda payload: None, slots=2, pool="highmem")
    ingest_hatchet.serve(lifespan, lambda payload: None, slots=2)

    heavy, standard = hatchet.workers
    assert (heavy.labels, heavy.slots, heavy.workflows[0].options["name"]) == (
        {"pool": "highmem"},
        3,
        "ingest-document-heavy",
    )
    assert (standard.labels, standard.slots, standard.workflows[0].options["name"]) == (
        {"pool": "standard"},
        2,
        "ingest-document",
    )
    # The key exists before a step consumes it, and holds nothing back.
    assert {key for key, _, _ in hatchet.rate_limits.put_calls} == {"ingest-provider-credits"}


# -------------------------------------------------------- credits in flight

IN_FLIGHT = "Error code: 402 - insufficient credits: your requests in flight have reserved the remaining credits"


class _CreditRefusal(Exception):
    status_code = 402


def _credit_ctx(attempt: int = 1) -> FakeContext:
    return FakeContext(attempt=attempt, max_attempts=1 + ingest_hatchet.INDEX_RETRIES)


def test_a_402_for_credits_in_flight_pauses_new_starts_and_retries_after_a_minute(db, serving, hatchet):
    serving(_Ingestor(_failed(True, f"vision failed: {IN_FLIGHT}")))
    ctx = _credit_ctx(attempt=ingest_hatchet.ORDINARY_ATTEMPTS)  # an ordinary failure here would be final

    with pytest.raises(RetryAfterException) as raised:
        _index()(_input(), ctx)

    assert raised.value.after == ingest_hatchet.CREDIT_WAIT
    assert str(raised.value) == "ProviderCreditsInFlight (transient)"
    ((key, until),) = ctx.paused
    assert key == "ingest-provider-credits"
    assert until.tzinfo is not None
    assert ingest_status_store.get("job-1").status == JobState.PENDING


def test_a_402_raised_by_the_job_waits_the_same_way(db, serving, hatchet):
    def raises(prepared, still_owner):
        raise _CreditRefusal(IN_FLIGHT)

    serving(_Ingestor(while_running=raises))
    ingest_status_store.put(_status())

    with pytest.raises(RetryAfterException):
        _index()(_input(), _credit_ctx())

    assert ingest_status_store.get("job-1").status == JobState.PENDING


def test_a_402_on_the_last_retry_fails_for_good(db, serving, hatchet):
    serving(_Ingestor(_failed(True, IN_FLIGHT)))

    with pytest.raises(NonRetryableException):
        _index()(_input(), _credit_ctx(attempt=1 + ingest_hatchet.INDEX_RETRIES))


def test_an_account_without_credits_is_not_waited_for(db, serving, hatchet):
    serving(_Ingestor(_failed(True, "Error code: 402 - insufficient credits")))

    with pytest.raises(RuntimeError, match="tried again") as raised:
        _index()(_input(), _credit_ctx())

    assert not isinstance(raised.value, RetryAfterException)


def test_an_ordinary_failure_is_final_after_its_own_attempts_whatever_retries_remain(db, serving):
    serving(_Ingestor(_failed(True, "original_download_failed: x")))

    with pytest.raises(NonRetryableException):
        _index()(_input(), _credit_ctx(attempt=ingest_hatchet.ORDINARY_ATTEMPTS))


def test_a_retry_of_a_job_settled_for_good_runs_nothing(db, serving):
    ingestor = serving(_Ingestor(_completed))
    failed = _status(state=JobState.FAILED)
    ingest_status_store.put(failed)

    with pytest.raises(NonRetryableException, match="already failed"):
        _index()(_input(), _credit_ctx(attempt=4))

    assert ingestor.ran == []


# ---------------------------------------------------------------- supersede


def test_a_run_a_newer_upload_cancelled_is_superseded_not_a_persons_cancel(db, serving, monkeypatch):
    pushed = []
    monkeypatch.setattr(ingest_status_store.ingest_settle_push, "notify_settled", pushed.extend)

    def runs(prepared, still_owner):
        ingest_run_hold.hold(prepared.job_id, "run-1", 60)
        ingest_status_store.put(_status(prepared.job_id, JobState.PROCESSING))

    serving(_Ingestor(while_running=runs))

    out = _index()(_input(), FakeContext(cancelled=True))

    assert out["status"] == "superseded"
    settled = ingest_status_store.get("job-1")
    assert settled.status == JobState.CANCELLED
    assert settled.metadata[ingest_execution.SUPERSEDED_KEY] is True
    assert pushed == []


def test_a_persons_cancel_is_remembered_across_the_runs_own_writes(db):
    ingest_status_store.put(_status(state=JobState.PROCESSING))
    ingest_run_hold.hold("job-1", "run-1", 60)

    assert ingest_run_hold.stopped_by_person("job-1") is False
    assert ingest_run_hold.mark_stopped_by_person("job-1") is True
    ingest_status_store.put(_status(state=JobState.PROCESSING))

    assert ingest_run_hold.stopped_by_person("job-1") is True
    assert ingest_run_hold.run_id_of("job-1") == "run-1"
    assert ingest_run_hold.mark_stopped_by_person("job-1") is False


# --------------------------------------------------------------- the trace


def test_each_file_trace_continues_the_trace_the_trigger_put_in_the_metadata(db, serving, monkeypatch):
    seen = []
    monkeypatch.setattr(
        ingest_hatchet.direct_trace, "continued_from", lambda traceparent: seen.append(traceparent) or _null()
    )
    serving(_Ingestor(_completed))
    traceparent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"

    _index()(_input(), FakeContext(metadata={"job_id": "job-1", "traceparent": traceparent}))

    assert seen == [traceparent]


def _null():
    import contextlib

    return contextlib.nullcontext()


def test_a_trigger_before_any_worker_registered_the_workflow_is_refused_not_lost(hatchet, db):
    # The engine answers such a trigger with a run id and creates nothing.
    hatchet.workflows.registered = False
    with pytest.raises(ingest_hatchet.WorkflowNotRegistered):
        ingest_hatchet.trigger("job-early", "org-a", "interactive", "sealed")
    assert hatchet.workflow_runs == []

    hatchet.workflows.registered = True
    assert ingest_hatchet.trigger("job-early", "org-a", "interactive", "sealed")
    assert [run.input.job_id for run in hatchet.workflow_runs] == ["job-early"]
