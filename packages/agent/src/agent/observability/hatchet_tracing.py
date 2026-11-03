"""Hatchet's own spans in Langfuse: the SDK's instrumentor, exporting through our provider (ADR-0089, ADR-0150).

The Hatchet SDK ships an OpenTelemetry instrumentor (``HatchetInstrumentor``,
the ``otel`` extra). It wraps a worker's step runs (``hatchet.start_step_run``,
parented on the run's ``traceparent`` metadata) and every trigger
(``hatchet.run_workflow``, which writes that metadata). Installed here, on the
two Python worker tiers (``ingest-worker``, ``agent-worker``):

* **Our provider, not Hatchet's collector.** The spans go to
  ``direct_trace``'s private ``TracerProvider``, the one Langfuse already reads
  for ingest files and direct generations, with
  ``enable_hatchet_otel_collector=False``: the instrumentor's default exports
  every span into Hatchet's own database, which holds ids and ciphertext only.
  The provider is never made the global one.
* **No document in an attribute.** The instrumentor copies a run's whole input
  (``hatchet.payload``) and its metadata (``hatchet.additional_metadata``) onto
  its spans. An ingest input is ciphertext and ids, but a research run's and a
  later workflow's need not be, so both are excluded on every span
  (``EXCLUDED_ATTRIBUTES``, merged into whatever
  ``HATCHET_CLIENT_OPENTELEMETRY_EXCLUDED_ATTRIBUTES`` says). What is left is
  ids, names, counts and the priority. A step's error is recorded on its span
  as the stand-in the step raised (``task_failures``): a class and a category.
* **One trace per ingest.** ``linked_metadata`` puts the trigger's
  ``traceparent`` into the run's metadata, so the trigger span, the step run
  (whose start minus the trigger's is the queue wait) and every file's trace
  (``direct_trace.continued_from``) share one trace id.

Fail-open: no OTLP endpoint, or an SDK without the extra, installs nothing and
the worker runs as before.
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Iterator
from collections.abc import Mapping
from contextlib import contextmanager
from typing import Any

from agent.observability import direct_trace

logger = logging.getLogger(__name__)

#: The instrumentor's attributes that can carry what a run is about: its input, its metadata.
EXCLUDED_ATTRIBUTES = ("payload", "additional_metadata")
TRACEPARENT = "traceparent"

_lock = threading.Lock()
_instrumentor: Any | None = None


def _config(base: Any) -> Any:
    """``base`` (the client's ``ClientConfig``) with :data:`EXCLUDED_ATTRIBUTES` always excluded."""
    from hatchet_sdk.utils.opentelemetry import OTelAttribute

    excluded = {*base.otel.excluded_attributes, *(OTelAttribute(name) for name in EXCLUDED_ATTRIBUTES)}
    otel = base.otel.model_copy(update={"excluded_attributes": sorted(excluded, key=lambda a: a.value)})
    return base.model_copy(update={"otel": otel})


def instrument(client_config: Any) -> bool:
    """Install the SDK's instrumentor on ``direct_trace``'s provider; whether it is installed. Idempotent."""
    global _instrumentor
    with _lock:
        if _instrumentor is not None:
            return True
        if client_config is None:
            return False
        provider = direct_trace.tracer_provider()
        if provider is None:
            logger.info("hatchet_tracing: no OTLP endpoint; Hatchet spans are not exported")
            return False
        try:
            from hatchet_sdk.opentelemetry.instrumentor import HatchetInstrumentor

            instrumentor = HatchetInstrumentor(
                tracer_provider=provider, config=_config(client_config), enable_hatchet_otel_collector=False
            )
            instrumentor.instrument()
        except Exception:
            logger.warning("hatchet_tracing: could not install the Hatchet instrumentor", exc_info=True)
            return False
        _instrumentor = instrumentor
        return True


def uninstrument() -> None:
    """Remove the instrumentor (tests)."""
    global _instrumentor
    with _lock:
        if _instrumentor is not None:
            _instrumentor.uninstrument()
        _instrumentor = None


def traceparent(recorder: direct_trace.SpanRecorder) -> dict[str, str]:
    """``{"traceparent": …}`` naming the recorder's span (W3C), for a run's metadata; empty when off."""
    span = recorder.span
    if span is None:
        return {}
    try:
        from opentelemetry.trace import set_span_in_context
        from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

        carrier: dict[str, str] = {}
        TraceContextTextMapPropagator().inject(carrier, context=set_span_in_context(span))
    except Exception:
        logger.debug("hatchet_tracing: could not render a traceparent", exc_info=True)
        return {}
    return {TRACEPARENT: carrier[TRACEPARENT]} if TRACEPARENT in carrier else {}


@contextmanager
def linked_metadata(feature: str, metadata: Mapping[str, Any]) -> Iterator[dict[str, Any]]:
    """A trigger's span, and ``metadata`` with its traceparent; the span is current inside the block.

    Current, so an instrumented trigger (``hatchet.run_workflow``) nests under
    it and writes a traceparent of the same trace. ``metadata`` is ids only:
    the scalars go on the span as well.
    """
    with direct_trace.observed_span(feature, metadata=metadata) as recorder:
        token = _attach(recorder.span)
        try:
            yield {**metadata, **traceparent(recorder)}
        finally:
            if token is not None:
                from opentelemetry import context

                context.detach(token)


def _attach(span: Any | None) -> Any | None:
    if span is None:
        return None
    try:
        from opentelemetry import context
        from opentelemetry.trace import set_span_in_context

        return context.attach(set_span_in_context(span))
    except Exception:
        logger.debug("hatchet_tracing: could not make a span current", exc_info=True)
        return None


def traceparent_of(metadata: Mapping[str, Any] | None) -> str | None:
    """The traceparent a run's metadata carries, or None."""
    value = (metadata or {}).get(TRACEPARENT)
    return value if isinstance(value, str) and value else None
