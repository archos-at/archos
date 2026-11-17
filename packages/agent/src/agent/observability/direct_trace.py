from __future__ import annotations

import functools
import json
import logging
import os
import threading
from collections.abc import Iterator
from collections.abc import Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

from agent.common import residency
from agent.common.image_redaction import redact_inline_images
from agent.common.licensed_text import trace_payload
from agent.observability.langfuse_trace_attributes import METADATA_PREFIX
from agent.observability.langfuse_trace_attributes import SESSION_ID_ATTRIBUTE
from agent.observability.langfuse_trace_attributes import TAGS_ATTRIBUTE
from agent.observability.otlp_resource import ENDPOINT_ENV
from agent.observability.otlp_resource import resource_attributes
from agent.observability.otlp_resource import signal_endpoint
from agent.observability.trace_context import OBSERVATION_LEVEL_ATTRIBUTE
from agent.observability.trace_context import OBSERVATION_STATUS_MESSAGE_ATTRIBUTE
from agent.observability.trace_context import OBSERVATION_TYPE_ATTRIBUTE
from agent.observability.trace_context import TRACE_NAME_ATTRIBUTE
from agent.observability.trace_context import process_trace_attributes
from agent.observability.usage_details import GEN_AI_REQUEST_MODEL
from agent.observability.usage_details import OBSERVATION_MODEL_NAME
from agent.observability.usage_details import usage_observation_attributes

logger = logging.getLogger(__name__)

INPUT_ATTRIBUTE = "langfuse.observation.input"
OUTPUT_ATTRIBUTE = "langfuse.observation.output"
OBSERVATION_METADATA_PREFIX = "langfuse.observation.metadata."
GEN_AI_RESPONSE_MODEL = "gen_ai.response.model"

MAX_PAYLOAD_CHARS = 16_000
TRUNCATION_MARKER = "…[truncated]"

AUXILIARY_SURFACE_TAG = "surface:auxiliary"

_SCOPE = "agent.observability.direct_trace"

_parent_span: ContextVar[Any | None] = ContextVar("direct_trace_parent_span", default=None)

_parent_context: ContextVar[Any | None] = ContextVar("direct_trace_parent_context", default=None)

_lock = threading.Lock()
_resolved = False
_provider = None
_tracer = None


def install_tracer_provider(endpoint: str | None, *, env: Mapping[str, str] | None = None, exporter=None):
    global _resolved, _provider, _tracer
    with _lock:
        if _resolved:
            return _provider
        _resolved = True
        if exporter is None and not (endpoint and endpoint.strip()):
            logger.info("direct_trace: no OTLP endpoint configured - direct model-call spans disabled.")
            return None
        _provider = _build(endpoint, env if env is not None else os.environ, exporter)
        _tracer = _provider.get_tracer(_SCOPE)
        return _provider


def reset_tracer_provider() -> None:
    global _resolved, _provider, _tracer
    with _lock:
        if _provider is not None:
            _provider.shutdown()
        _resolved, _provider, _tracer = False, None, None


def _build(endpoint: str | None, env: Mapping[str, str], exporter):
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    if exporter is None:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

        exporter = OTLPSpanExporter(endpoint=signal_endpoint(endpoint or "", "traces"))
    provider = TracerProvider(resource=Resource.create(resource_attributes(env)))
    provider.add_span_processor(BatchSpanProcessor(exporter))
    return provider


def tracer_provider():
    _current_tracer()
    return _provider


def _current_tracer():
    if not _resolved:
        try:
            install_tracer_provider(os.environ.get(ENDPOINT_ENV))
        except Exception:
            logger.debug("direct_trace: could not build the tracer provider", exc_info=True)
    return _tracer


def _clip(text: str) -> str:
    text = trace_payload(redact_inline_images(text))
    if len(text) <= MAX_PAYLOAD_CHARS:
        return text
    return text[:MAX_PAYLOAD_CHARS] + TRUNCATION_MARKER


def _count(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return 0
    return max(0, int(value))


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def generation_start_attributes(
    feature: str,
    *,
    model: str | None,
    messages: list | None,
    session_id: str | None = None,
    metadata: Mapping[str, Any] | None = None,
    nested: bool = False,
) -> dict[str, Any]:
    attributes: dict[str, Any] = {**process_trace_attributes(), OBSERVATION_TYPE_ATTRIBUTE: "generation"}
    if not nested:
        attributes[TRACE_NAME_ATTRIBUTE] = feature
        attributes[TAGS_ATTRIBUTE] = [f"feature:{feature}", AUXILIARY_SURFACE_TAG]
    prefix = OBSERVATION_METADATA_PREFIX if nested else METADATA_PREFIX
    for key, value in {**(metadata or {}), "feature": feature}.items():
        if isinstance(value, str | int | float | bool):
            attributes[f"{prefix}{key}"] = value
    if model:
        attributes[GEN_AI_REQUEST_MODEL] = model
        attributes[OBSERVATION_MODEL_NAME] = model
    if session_id and not nested:
        attributes[SESSION_ID_ATTRIBUTE] = session_id
    if messages is not None:
        attributes[INPUT_ATTRIBUTE] = _clip(json.dumps(messages, ensure_ascii=False, default=str))
    return attributes


def _usage_attributes(usage: Any) -> dict[str, Any]:
    if not isinstance(usage, Mapping):
        return {}
    cost = usage.get("cost")
    return usage_observation_attributes(
        prompt_tokens=_count(usage.get("prompt_tokens")),
        completion_tokens=_count(usage.get("completion_tokens")),
        total_tokens=_count(usage.get("total_tokens")),
        cached_tokens=_count(_mapping(usage.get("prompt_tokens_details")).get("cached_tokens")),
        cache_write_tokens=_count(_mapping(usage.get("prompt_tokens_details")).get("cache_write_tokens")),
        reasoning_tokens=_count(_mapping(usage.get("completion_tokens_details")).get("reasoning_tokens")),
        cost_usd=cost if isinstance(cost, int | float) and not isinstance(cost, bool) else None,
    )


def generation_result_attributes(response: Any) -> dict[str, Any]:
    if not isinstance(response, Mapping):
        return {}
    attributes = _usage_attributes(response.get("usage"))
    served = response.get("model")
    if isinstance(served, str) and served:
        attributes[GEN_AI_RESPONSE_MODEL] = served
        attributes[OBSERVATION_MODEL_NAME] = served
    choices = response.get("choices")
    choice = _mapping(choices[0]) if isinstance(choices, list) and choices else {}
    content = _mapping(choice.get("message")).get("content")
    if isinstance(content, str):
        attributes[OUTPUT_ATTRIBUTE] = _clip(content)
    finish_reason = choice.get("finish_reason")
    if isinstance(finish_reason, str):
        attributes[f"{METADATA_PREFIX}finish_reason"] = finish_reason
    return attributes


def failure_message(exc: BaseException) -> str:
    status = getattr(getattr(exc, "response", None), "status_code", None)
    if isinstance(status, int):
        return f"{type(exc).__name__}: HTTP {status}"
    return type(exc).__name__


class GenerationRecorder:
    __slots__ = ("_span",)

    def __init__(self, span: Any | None) -> None:
        self._span = span

    @property
    def trace_id(self) -> str | None:
        if self._span is None:
            return None
        try:
            trace_id = self._span.get_span_context().trace_id
        except Exception:
            logger.debug("direct_trace: could not read a generation's trace id", exc_info=True)
            return None
        return format(trace_id, "032x") if isinstance(trace_id, int) and trace_id else None

    def finish(self, response: Any) -> None:
        if self._span is None:
            return
        try:
            attributes = generation_result_attributes(response)
            if getattr(self._span, "parent", None) is not None:  # nested: the trace is its parent's
                attributes = {_on_observation(key): value for key, value in attributes.items()}
            self._span.set_attributes(attributes)
        except Exception:
            logger.debug("direct_trace: could not record a generation's reply", exc_info=True)


def _on_observation(key: str) -> str:
    return key.replace(METADATA_PREFIX, OBSERVATION_METADATA_PREFIX, 1)


class _ObservedGeneration:
    def __init__(self, feature: str, attributes: dict[str, Any]) -> None:
        self._feature = feature
        self._attributes = attributes
        self._span: Any | None = None
        self._sink: Any = None

    async def __aenter__(self) -> GenerationRecorder:
        return self.__enter__()

    async def __aexit__(self, exc_type, exc, traceback) -> bool:
        return self.__exit__(exc_type, exc, traceback)

    def __enter__(self) -> GenerationRecorder:
        self._span = _start_span(self._feature, self._attributes)
        self._sink = residency.route_sink().set(functools.partial(_record_route, self._span))
        return GenerationRecorder(self._span)

    def __exit__(self, exc_type, exc, traceback) -> bool:
        residency.route_sink().reset(self._sink)
        _end_span(self._span, exc)
        return False


def _record_route(span: Any, route: Any) -> None:
    if span is not None:
        span.set_attributes({f"{OBSERVATION_METADATA_PREFIX}{key}": value for key, value in route.metadata().items()})


def _start_span(feature: str, attributes: dict[str, Any]) -> Any | None:
    tracer = _current_tracer()
    if tracer is None:
        return None
    try:
        from opentelemetry.context import Context
        from opentelemetry.trace import SpanKind

        parent = _parent_span.get()
        context = Context()
        if parent is not None:
            from opentelemetry.trace import set_span_in_context

            context = set_span_in_context(parent, context)
        return tracer.start_span(
            feature,
            context=context,
            kind=SpanKind.CLIENT,
            attributes=generation_start_attributes(feature, **attributes, nested=parent is not None),
        )
    except Exception:
        logger.debug("direct_trace: could not start a generation span", exc_info=True)
        return None


class SpanRecorder:
    __slots__ = ("_span",)

    def __init__(self, span: Any | None) -> None:
        self._span = span

    @property
    def span(self) -> Any | None:
        return self._span

    def finish(self, output: Mapping[str, Any], *, failed: str | None = None) -> None:
        if self._span is None:
            return
        try:
            self._span.set_attributes(
                {
                    OUTPUT_ATTRIBUTE: _clip(json.dumps(dict(output), ensure_ascii=False, default=str)),
                    **_scalars(output),
                }
            )
            if failed:
                self._span.set_attributes(
                    {OBSERVATION_LEVEL_ATTRIBUTE: "ERROR", OBSERVATION_STATUS_MESSAGE_ATTRIBUTE: failed[:500]}
                )
        except Exception:
            logger.debug("direct_trace: could not record a span's outcome", exc_info=True)


@contextmanager
def observed_span(feature: str, *, metadata: Mapping[str, Any] | None = None) -> Iterator[SpanRecorder]:
    span = None
    tracer = _current_tracer()
    if tracer is not None:
        try:
            from opentelemetry.context import Context
            from opentelemetry.trace import SpanKind

            span = tracer.start_span(
                feature,
                context=_parent_context.get() or Context(),
                kind=SpanKind.INTERNAL,
                attributes={
                    **process_trace_attributes(),
                    OBSERVATION_TYPE_ATTRIBUTE: "span",
                    TRACE_NAME_ATTRIBUTE: feature,
                    TAGS_ATTRIBUTE: [f"feature:{feature}", AUXILIARY_SURFACE_TAG],
                    **_scalars({**(metadata or {}), "feature": feature}),
                },
            )
        except Exception:
            logger.debug("direct_trace: could not start a span", exc_info=True)
            span = None
    token = _parent_span.set(span) if span is not None else None
    try:
        yield SpanRecorder(span)
    finally:
        if token is not None:
            _parent_span.reset(token)
        _end_span(span, None)


@contextmanager
def continued_from(traceparent: str | None) -> Iterator[None]:
    parent = None
    if traceparent:
        try:
            from opentelemetry.trace import get_current_span
            from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

            extracted = TraceContextTextMapPropagator().extract({"traceparent": traceparent})
            parent = extracted if get_current_span(extracted).get_span_context().is_valid else None
        except Exception:
            logger.debug("direct_trace: could not read a traceparent", exc_info=True)
    token = _parent_context.set(parent)
    try:
        yield
    finally:
        _parent_context.reset(token)


def _end_span(span: Any | None, exc: BaseException | None) -> None:
    if span is None:
        return
    try:
        if exc is not None:
            from opentelemetry.trace import Status
            from opentelemetry.trace import StatusCode

            message = failure_message(exc)
            span.set_attributes({OBSERVATION_LEVEL_ATTRIBUTE: "ERROR", OBSERVATION_STATUS_MESSAGE_ATTRIBUTE: message})
            span.set_status(Status(StatusCode.ERROR, message))
    except Exception:
        logger.debug("direct_trace: could not mark a generation as failed", exc_info=True)
    try:
        span.end()
    except Exception:
        logger.debug("direct_trace: could not end a generation span", exc_info=True)


def observed_generation(
    feature: str,
    *,
    model: str | None,
    messages: list | None,
    session_id: str | None = None,
    metadata: Mapping[str, Any] | None = None,
) -> _ObservedGeneration:
    return _ObservedGeneration(
        feature,
        {"model": model, "messages": messages, "session_id": session_id, "metadata": metadata},
    )


def _scalars(metadata: Mapping[str, Any] | None) -> dict[str, Any]:
    return {
        f"{METADATA_PREFIX}{key}": value
        for key, value in (metadata or {}).items()
        if isinstance(value, str | int | float | bool)
    }


def retrieval_attributes(
    feature: str,
    *,
    query: Mapping[str, Any],
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        **process_trace_attributes(),
        OBSERVATION_TYPE_ATTRIBUTE: "retriever",
        TRACE_NAME_ATTRIBUTE: feature,
        TAGS_ATTRIBUTE: [f"feature:{feature}", AUXILIARY_SURFACE_TAG],
        INPUT_ATTRIBUTE: _clip(json.dumps(dict(query), ensure_ascii=False, default=str)),
        **_scalars({**(metadata or {}), "feature": feature}),
    }


class RetrievalRecorder:
    __slots__ = ("_span",)

    def __init__(self, span: Any | None) -> None:
        self._span = span

    def finish(self, picks: Mapping[str, Any], metadata: Mapping[str, Any] | None = None) -> None:
        if self._span is None:
            return
        try:
            output = _clip(json.dumps(dict(picks), ensure_ascii=False, default=str))
            self._span.set_attributes({OUTPUT_ATTRIBUTE: output, **_scalars(metadata)})
        except Exception:
            logger.debug("direct_trace: could not record a retrieval's picks", exc_info=True)


class _ObservedRetrieval:
    def __init__(self, step: str, attributes: dict[str, Any]) -> None:
        self._step = step
        self._attributes = attributes
        self._span: Any | None = None

    def __enter__(self) -> RetrievalRecorder:
        tracer = _current_tracer()
        if tracer is None:
            return RetrievalRecorder(None)
        try:
            from opentelemetry.context import Context
            from opentelemetry.trace import SpanKind

            self._span = tracer.start_span(
                self._step, context=Context(), kind=SpanKind.INTERNAL, attributes=self._attributes
            )
        except Exception:
            logger.debug("direct_trace: could not start a retrieval span", exc_info=True)
        return RetrievalRecorder(self._span)

    def __exit__(self, exc_type, exc, traceback) -> bool:
        _end_span(self._span, exc)
        return False


def observed_retrieval(
    feature: str,
    *,
    step: str,
    query: Mapping[str, Any],
    metadata: Mapping[str, Any] | None = None,
) -> _ObservedRetrieval:
    return _ObservedRetrieval(step, retrieval_attributes(feature, query=query, metadata=metadata))
