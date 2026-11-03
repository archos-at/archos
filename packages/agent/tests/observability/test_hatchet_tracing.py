"""Hatchet's spans in Langfuse: our provider, no document in an attribute, one trace from trigger to file.

The SDK's instrumentor is installed for real on ``direct_trace``'s provider
with an in-memory exporter; its two wrappers that matter (a trigger and a step
run) are called with a fake of what they wrap, since no engine runs here.
"""

from __future__ import annotations

import base64
import json

import pytest
from hatchet_sdk import ClientConfig
from hatchet_sdk.opentelemetry.instrumentor import HatchetInstrumentor
from hatchet_sdk.runnables.action import Action
from hatchet_sdk.runnables.action import ActionPayload
from hatchet_sdk.runnables.action import ActionType
from hatchet_sdk.types.trigger import TriggerWorkflowOptions
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from agent.observability import direct_trace
from agent.observability import hatchet_tracing

#: What must never reach a span: a file name, a presigned URL, a payload's text.
SECRETS = ("Bauantrag.pdf", "s3.example", "Gutachten über das Dach")


def _b64(data: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")


def _config() -> ClientConfig:
    claims = {"sub": "tenant-1", "grpc_broadcast_address": "localhost:7077", "server_url": "http://localhost:8888"}
    return ClientConfig(token=f"{_b64({'alg': 'none'})}.{_b64(claims)}.sig", namespace="test_")


@pytest.fixture
def exporter(monkeypatch):
    monkeypatch.delenv(direct_trace.ENDPOINT_ENV, raising=False)
    direct_trace.reset_tracer_provider()
    memory = InMemorySpanExporter()
    direct_trace.install_tracer_provider(None, env={}, exporter=memory)
    yield memory
    hatchet_tracing.uninstrument()
    direct_trace.reset_tracer_provider()


def _spans(memory: InMemorySpanExporter):
    direct_trace._provider.force_flush()
    return memory.get_finished_spans()


def _flat(span) -> str:
    return json.dumps(dict(span.attributes or {}), default=str) + span.name + str(span.status.description)


def test_without_an_endpoint_nothing_is_installed(monkeypatch):
    monkeypatch.delenv(direct_trace.ENDPOINT_ENV, raising=False)
    direct_trace.reset_tracer_provider()

    assert hatchet_tracing.instrument(_config()) is False
    assert hatchet_tracing._instrumentor is None


def test_the_instrumentor_exports_through_our_provider_and_never_to_hatchet(exporter):
    assert hatchet_tracing.instrument(_config()) is True

    instrumentor = hatchet_tracing._instrumentor
    assert instrumentor.tracer_provider is direct_trace._provider
    # The collector exporter is the only processor the instrumentor adds; ours has one, the test's.
    assert len(direct_trace._provider._active_span_processor._span_processors) == 1
    assert {a.value for a in instrumentor.config.otel.excluded_attributes} >= {"payload", "additional_metadata"}


def test_a_trigger_carries_its_traceparent_and_no_payload_on_its_span(exporter):
    hatchet_tracing.instrument(_config())
    instrumentor: HatchetInstrumentor = hatchet_tracing._instrumentor
    sent = {}

    def run_workflow(workflow_name, input, options):
        sent["options"] = options
        return "ref"

    payload = json.dumps({"file_ref": "https://s3.example/Bauantrag.pdf", "text": SECRETS[2]})
    with hatchet_tracing.linked_metadata("ingest-trigger", {"job_id": "job-1"}) as metadata:
        options = TriggerWorkflowOptions(additional_metadata=metadata)
        instrumentor._wrap_run_workflow(run_workflow, None, ("test_ingest-document", payload, options), {})

    spans = {span.name: span for span in _spans(exporter)}
    trigger, run = spans["ingest-trigger"], spans["hatchet.run_workflow"]
    assert run.context.trace_id == trigger.context.trace_id
    assert run.parent.span_id == trigger.context.span_id
    carried = sent["options"].additional_metadata["traceparent"]
    assert carried.split("-")[1] == f"{trigger.context.trace_id:032x}"
    for span in spans.values():
        for secret in SECRETS:
            assert secret not in _flat(span)


async def test_a_step_run_continues_the_trigger_trace_and_names_no_document(exporter):
    hatchet_tracing.instrument(_config())
    instrumentor: HatchetInstrumentor = hatchet_tracing._instrumentor
    with hatchet_tracing.linked_metadata("ingest-trigger", {"job_id": "job-1"}) as metadata:
        pass
    action = Action(
        worker_id="w",
        tenant_id="t",
        workflow_run_id="run-1",
        job_id="j",
        job_name="ingest-document",
        job_run_id="jr",
        step_id="s",
        step_run_id="sr",
        action_id="test_ingest-document:index",
        action_type=ActionType.START_STEP_RUN,
        retry_count=0,
        action_payload=ActionPayload(input={"job_id": "job-1", "payload": SECRETS[2] + " Bauantrag.pdf"}),
        additional_metadata={**metadata, "file_name": "Bauantrag.pdf"},
    )

    async def start_step_run(action):
        with direct_trace.continued_from(hatchet_tracing.traceparent_of(action.additional_metadata)):
            with direct_trace.observed_span("ingest-file", metadata={"job_id": "job-1"}):
                pass

    await instrumentor._wrap_handle_start_step_run(start_step_run, None, (action,), {})

    spans = {span.name: span for span in _spans(exporter)}
    trigger, step, file = spans["ingest-trigger"], spans["hatchet.start_step_run"], spans["ingest-file"]
    assert step.context.trace_id == trigger.context.trace_id == file.context.trace_id
    assert step.parent.span_id == trigger.context.span_id
    for span in spans.values():
        for secret in SECRETS:
            assert secret not in _flat(span)


def test_a_file_trace_is_a_root_without_a_traceparent(exporter):
    with direct_trace.continued_from(None), direct_trace.observed_span("ingest-file"):
        pass
    with direct_trace.continued_from("not-a-traceparent"), direct_trace.observed_span("ingest-file"):
        pass

    assert [span.parent for span in _spans(exporter)] == [None, None]


def test_traceparent_of_reads_only_a_string():
    assert hatchet_tracing.traceparent_of({"traceparent": "00-ab-cd-01"}) == "00-ab-cd-01"
    assert hatchet_tracing.traceparent_of({"traceparent": 7}) is None
    assert hatchet_tracing.traceparent_of(None) is None
