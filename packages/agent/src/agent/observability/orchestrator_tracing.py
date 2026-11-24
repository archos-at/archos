from __future__ import annotations

import logging
import threading
from collections.abc import Iterator
from collections.abc import Mapping
from contextlib import contextmanager
from typing import Any

from agent.observability import direct_trace

logger = logging.getLogger(__name__)

EXCLUDED_ATTRIBUTES = ("payload", "additional_metadata")
TRACEPARENT = "traceparent"

_lock = threading.Lock()
_instrumentor: Any | None = None


def _config(base: Any) -> Any:
    from hatchet_sdk.utils.opentelemetry import OTelAttribute

    excluded = {*base.otel.excluded_attributes, *(OTelAttribute(name) for name in EXCLUDED_ATTRIBUTES)}
    otel = base.otel.model_copy(update={"excluded_attributes": sorted(excluded, key=lambda a: a.value)})
    return base.model_copy(update={"otel": otel})


def instrument(client_config: Any) -> bool:
    global _instrumentor
    with _lock:
        if _instrumentor is not None:
            return True
        if client_config is None:
            return False
        provider = direct_trace.tracer_provider()
        if provider is None:
            logger.info("orchestrator_tracing: no OTLP endpoint; Hatchet spans are not exported")
            return False
        try:
            from hatchet_sdk.opentelemetry.instrumentor import HatchetInstrumentor

            instrumentor = HatchetInstrumentor(
                tracer_provider=provider, config=_config(client_config), enable_hatchet_otel_collector=False
            )
            instrumentor.instrument()
        except Exception:
            logger.warning("orchestrator_tracing: could not install the Hatchet instrumentor", exc_info=True)
            return False
        _instrumentor = instrumentor
        return True


def uninstrument() -> None:
    global _instrumentor
    with _lock:
        if _instrumentor is not None:
            _instrumentor.uninstrument()
        _instrumentor = None


def traceparent(recorder: direct_trace.SpanRecorder) -> dict[str, str]:
    span = recorder.span
    if span is None:
        return {}
    try:
        from opentelemetry.trace import set_span_in_context
        from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

        carrier: dict[str, str] = {}
        TraceContextTextMapPropagator().inject(carrier, context=set_span_in_context(span))
    except Exception:
        logger.debug("orchestrator_tracing: could not render a traceparent", exc_info=True)
        return {}
    return {TRACEPARENT: carrier[TRACEPARENT]} if TRACEPARENT in carrier else {}


@contextmanager
def linked_metadata(feature: str, metadata: Mapping[str, Any]) -> Iterator[dict[str, Any]]:
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
        logger.debug("orchestrator_tracing: could not make a span current", exc_info=True)
        return None


def traceparent_of(metadata: Mapping[str, Any] | None) -> str | None:
    value = (metadata or {}).get(TRACEPARENT)
    return value if isinstance(value, str) and value else None
