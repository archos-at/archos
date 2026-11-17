from __future__ import annotations

import base64
import functools
import json
import logging
from collections.abc import Mapping
from concurrent.futures import Future
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from contextvars import ContextVar
from contextvars import copy_context
from dataclasses import dataclass
from threading import Lock
from types import SimpleNamespace
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler

from agent.common import bff_http
from agent.common.provider_usage import ACCOUNTING_FIELDS
from agent.common.provider_usage import as_int as _as_int
from agent.common.provider_usage import install_chat_stream_cost_carrier
from agent.common.provider_usage import reported_cost as _reported_cost
from agent.common.provider_usage import usage_from_langchain_metadata as _usage_from_langchain_metadata

logger = logging.getLogger(__name__)

BUDGET_HEADER = "x-grid-budget"
USER_ID_HEADER = "x-grid-user-id"

RESPONSES_ACCOUNTING_KEY = "grid_usage_accounting"

_REQUEST_TIMEOUT_SECONDS = 5
_FLUSH_BATCH_SIZE = 5

_flush_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="usage-flush")


class BudgetExceededError(RuntimeError):
    expected_outcome = True

    def __init__(self, scope: str, message: str | None = None) -> None:
        self.scope = scope
        super().__init__(
            message
            or (
                "The organization's LLM budget is exhausted "
                f"(limit scope: {scope}). An org admin can raise limits under Organization → Usage & budgets."
            )
        )


@dataclass
class BudgetSnapshot:
    remaining_org_usd: float | None = None
    remaining_user_usd: float | None = None
    remaining_project_usd: float | None = None
    remaining_org_tokens: float | None = None
    remaining_user_tokens: float | None = None
    remaining_project_tokens: float | None = None

    @classmethod
    def from_header(cls, raw: str | None) -> BudgetSnapshot | None:
        if not raw:
            return None
        try:
            padded = raw + "=" * (-len(raw) % 4)
            data = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
        except Exception:
            logger.warning("Ignoring malformed %s header", BUDGET_HEADER, exc_info=True)
            return None
        if not isinstance(data, dict):
            return None

        def _num(key: str) -> float | None:
            value = data.get(key)
            return float(value) if isinstance(value, int | float) else None

        return cls(
            remaining_org_usd=_num("remainingOrgUsd"),
            remaining_user_usd=_num("remainingUserUsd"),
            remaining_project_usd=_num("remainingProjectUsd"),
            remaining_org_tokens=_num("remainingOrgTokens"),
            remaining_user_tokens=_num("remainingUserTokens"),
            remaining_project_tokens=_num("remainingProjectTokens"),
        )

    def exhausted_scope(self, pending_cost_usd: float, pending_tokens: int = 0) -> str | None:
        for scope, remaining_usd, remaining_tokens in (
            ("organization", self.remaining_org_usd, self.remaining_org_tokens),
            ("member", self.remaining_user_usd, self.remaining_user_tokens),
            ("project", self.remaining_project_usd, self.remaining_project_tokens),
        ):
            if remaining_usd is not None and pending_cost_usd >= remaining_usd:
                return scope
            if remaining_tokens is not None and pending_tokens >= remaining_tokens:
                return scope
        return None


USAGE_ROLE_RERANK = "rerank"

USAGE_ROLE_INGEST_VISION = "ingest_vision"
USAGE_ROLE_INGEST_TRANSCRIPTION = "ingest_transcription"
USAGE_ROLE_EMBEDDING = "embedding"

USAGE_ROLE_LOOK_READING = "look_reading"
USAGE_ROLE_REVISION_COMPARE = "revision_compare"

USAGE_ACTIVITY_INGEST = "ingest"

USAGE_ROLE_DICTATION = "dictation"
USAGE_ACTIVITY_DICTATION = "dictation"


@dataclass
class UsageEvent:
    model: str | None
    requested_model: str | None
    generation_id: str | None
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cached_tokens: int
    reasoning_tokens: int
    cost_usd: float
    cost_source: str  # 'usage_field' | 'estimate' | 'missing'
    is_byok: bool | None
    role: str | None = None
    audio_seconds: float | None = None
    cache_write_tokens: int = 0

    def to_payload(self) -> dict[str, Any]:
        return {
            "model": self.model,
            "requestedModel": self.requested_model,
            "generationId": self.generation_id,
            "promptTokens": self.prompt_tokens,
            "completionTokens": self.completion_tokens,
            "totalTokens": self.total_tokens,
            "cachedTokens": self.cached_tokens,
            "cacheWriteTokens": self.cache_write_tokens,
            "reasoningTokens": self.reasoning_tokens,
            "costUsd": self.cost_usd,
            "costSource": self.cost_source,
            "isByok": self.is_byok,
            "role": self.role,
            "audioSeconds": self.audio_seconds,
        }


def extract_usage_event(response: Any) -> UsageEvent | None:
    llm_output = getattr(response, "llm_output", None) or {}
    usage = llm_output.get("token_usage") or llm_output.get("usage") or {}

    generation_id = None
    message = None
    response_metadata: dict[str, Any] = {}
    try:
        generation = response.generations[0][0]
        message = getattr(generation, "message", None)
    except AttributeError, IndexError:
        generation = None
    if message is not None:
        generation_id = getattr(message, "id", None)
        response_metadata = getattr(message, "response_metadata", None) or {}
        if not usage:
            usage = response_metadata.get("token_usage") or {}
        if not usage:
            usage = _usage_from_langchain_metadata(
                getattr(message, "usage_metadata", None), response_metadata.get(RESPONSES_ACCOUNTING_KEY)
            )

    if not usage:
        return None

    prompt_details = usage.get("prompt_tokens_details") or {}
    completion_details = usage.get("completion_tokens_details") or {}
    cost_usd = _reported_cost(usage.get("cost"), generation_id)

    return UsageEvent(
        model=llm_output.get("model_name") or response_metadata.get("model_name"),
        requested_model=None,  # filled by the tracker from invocation params
        generation_id=generation_id,
        prompt_tokens=_as_int(usage.get("prompt_tokens")),
        completion_tokens=_as_int(usage.get("completion_tokens")),
        total_tokens=_as_int(usage.get("total_tokens")),
        cached_tokens=_as_int(prompt_details.get("cached_tokens")),
        cache_write_tokens=_as_int(prompt_details.get("cache_write_tokens")),
        reasoning_tokens=_as_int(completion_details.get("reasoning_tokens")),
        cost_usd=cost_usd if cost_usd is not None else 0.0,
        cost_source="usage_field" if cost_usd is not None else "missing",
        is_byok=usage.get("is_byok") if isinstance(usage.get("is_byok"), bool) else None,
    )


class CostTracker(BaseCallbackHandler):
    raise_error = True
    run_inline = True

    def __init__(
        self,
        *,
        organization_id: str | None,
        user_id: str | None = None,
        project_id: str | None = None,
        conversation_id: str | None = None,
        job_id: str | None = None,
        message_id: str | None = None,
        budget: BudgetSnapshot | None = None,
        activity: str | None = None,
    ) -> None:
        self.organization_id = organization_id
        self.user_id = user_id
        self.project_id = project_id
        self.conversation_id = conversation_id
        self.job_id = job_id
        self.message_id = message_id
        self.activity = activity
        self.budget = budget
        self._lock = Lock()
        self._pending: list[UsageEvent] = []
        self._events_recorded = 0
        self._turn_cost_usd = 0.0
        self._cost_sources: dict[str, int] = {}
        self._prompt_tokens = 0
        self._completion_tokens = 0
        self._cached_tokens = 0
        self._cache_write_tokens = 0
        self._requested_models: dict[Any, str] = {}
        self._requested_model: str | None = None

    def _check_budget(self) -> None:
        if self.budget is None:
            return
        turn_tokens = self._prompt_tokens + self._completion_tokens
        scope = self.budget.exhausted_scope(self._turn_cost_usd, turn_tokens)
        if scope is not None:
            logger.warning(
                "Budget exhausted (scope=%s, org=%s, user=%s, project=%s, turn_cost=%.6f USD, turn_tokens=%d)"
                " — refusing LLM call",
                scope,
                self.organization_id,
                self.user_id,
                self.project_id,
                self._turn_cost_usd,
                turn_tokens,
            )
            raise BudgetExceededError(scope)

    def on_llm_start(self, serialized: dict[str, Any], prompts: list[str], **kwargs: Any) -> None:
        self._capture_requested_model(kwargs)
        self._check_budget()

    def on_chat_model_start(self, serialized: dict[str, Any], messages: Any, **kwargs: Any) -> None:
        self._capture_requested_model(kwargs)
        self._check_budget()

    def _capture_requested_model(self, kwargs: dict[str, Any]) -> None:
        params = kwargs.get("invocation_params") or {}
        model = params.get("model") or params.get("model_name")
        if isinstance(model, str):
            run_id = kwargs.get("run_id")
            with self._lock:
                if run_id is not None:
                    self._requested_models[run_id] = model
                self._requested_model = model

    def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        run_id = kwargs.get("run_id")
        with self._lock:
            requested = self._requested_models.pop(run_id, None) if run_id is not None else None
        try:
            event = extract_usage_event(response)
        except Exception:
            logger.warning("Failed to extract LLM usage from response", exc_info=True)
            return
        if event is None:
            return
        event.requested_model = requested or self._requested_model
        self.record(event)

    def record(self, event: UsageEvent) -> None:
        with self._lock:
            self._pending.append(event)
            self._events_recorded += 1
            self._turn_cost_usd += event.cost_usd
            self._prompt_tokens += event.prompt_tokens
            self._completion_tokens += event.completion_tokens
            self._cached_tokens += event.cached_tokens
            self._cache_write_tokens += event.cache_write_tokens
            source = event.cost_source
            self._cost_sources[source] = self._cost_sources.get(source, 0) + 1
            should_flush = len(self._pending) >= _FLUSH_BATCH_SIZE
        if should_flush:
            self.flush(wait=False)

    def on_llm_error(self, error: BaseException, **kwargs: Any) -> None:
        run_id = kwargs.get("run_id")
        if run_id is not None:
            with self._lock:
                self._requested_models.pop(run_id, None)

    @property
    def turn_cost_usd(self) -> float:
        return self._turn_cost_usd

    @property
    def events_recorded(self) -> int:
        return self._events_recorded

    @property
    def prompt_tokens(self) -> int:
        return self._prompt_tokens

    @property
    def completion_tokens(self) -> int:
        return self._completion_tokens

    @property
    def cached_tokens(self) -> int:
        return self._cached_tokens

    def log_prompt_cache_summary(self) -> None:
        with self._lock:
            prompt_tokens = self._prompt_tokens
            cached = self._cached_tokens
            written = self._cache_write_tokens
            calls = self._events_recorded
        if prompt_tokens <= 0:
            return
        share = 100.0 * cached / prompt_tokens
        logger.info(
            "[PromptCache] %d call(s): %d/%d input tokens served from cache (%.1f%%), %d uncached, %d written",
            calls,
            cached,
            prompt_tokens,
            share,
            prompt_tokens - cached,
            written,
        )

    @property
    def cost_source(self) -> str | None:
        with self._lock:
            sources = {source for source, count in self._cost_sources.items() if count}
        if not sources:
            return None
        if len(sources) == 1:
            return next(iter(sources))
        return "mixed"

    def flush(self, *, wait: bool) -> Future[None] | None:
        with self._lock:
            batch, self._pending = self._pending, []
        if not batch:
            return None
        payload = {
            "organizationId": self.organization_id,
            "userId": self.user_id,
            "projectId": self.project_id,
            "conversationId": self.conversation_id,
            "jobId": self.job_id,
            "messageId": self.message_id,
            "activity": self.activity,
            "events": [event.to_payload() for event in batch],
        }
        if wait:
            _post_usage_events(payload)
            return None
        return _flush_executor.submit(_post_usage_events, payload)


def _post_usage_events(payload: dict[str, Any]) -> None:
    try:
        bff_http.send("POST", "/api/internal/usage", timeout=_REQUEST_TIMEOUT_SECONDS, body=payload)
    except bff_http.BffNotConfiguredError:
        logger.warning("INTERNAL_API_TOKEN not configured — dropping %d usage events", len(payload["events"]))
    except bff_http.BffRefusedError as error:
        logger.warning("Internal usage endpoint rejected batch: HTTP %s", error.status)
    except Exception:
        logger.warning("Failed to post usage events to internal endpoint", exc_info=True)


cost_tracker_var: ContextVar[CostTracker | None] = ContextVar("cost_tracker", default=None)

try:
    from langchain_core.tracers.context import register_configure_hook

    register_configure_hook(cost_tracker_var, inheritable=True)
    _CONFIGURE_HOOK_INSTALLED = True
except Exception:  # pragma: no cover - defensive against langchain-core API drift
    logger.exception("Could not install LangChain configure hook; LLM cost tracking is DISABLED")
    _CONFIGURE_HOOK_INSTALLED = False


def _provider_accounting(usage: Any) -> dict[str, Any] | None:
    if usage is None:
        return None
    raw = usage if isinstance(usage, dict) else getattr(usage, "model_extra", None) or {}
    if not isinstance(raw, dict):
        return None
    accounting = {key: raw[key] for key in ACCOUNTING_FIELDS if raw.get(key) is not None}
    return accounting or None


def install_responses_cost_carrier() -> bool:
    try:
        from langchain_openai.chat_models import base as lc_openai
    except ImportError:
        return False
    original = getattr(lc_openai, "_construct_lc_result_from_responses_api", None)
    if original is None:
        logger.error("langchain-openai has no _construct_lc_result_from_responses_api; Responses calls record no cost")
        return False
    if getattr(original, "__cost_carrier__", False):
        return True

    @functools.wraps(original)
    def construct(response: Any, *args: Any, **kwargs: Any) -> Any:
        result = original(response, *args, **kwargs)
        try:
            accounting = _provider_accounting(getattr(response, "usage", None))
            if accounting:
                for generation in result.generations:
                    generation.message.response_metadata[RESPONSES_ACCOUNTING_KEY] = dict(accounting)
        except Exception:  # noqa: BLE001 - accounting must never break an answer
            logger.warning("Could not carry the Responses usage cost", exc_info=True)
        return result

    construct.__cost_carrier__ = True  # type: ignore[attr-defined]
    lc_openai._construct_lc_result_from_responses_api = construct
    return True


_RESPONSES_COST_CARRIER_INSTALLED = install_responses_cost_carrier()
_CHAT_STREAM_COST_CARRIER_INSTALLED = install_chat_stream_cost_carrier()


def record_usage_event(
    *,
    model: str | None,
    role: str,
    prompt_tokens: int,
    completion_tokens: int = 0,
    total_tokens: int | None = None,
    cost_usd: float = 0.0,
    cost_source: str = "estimate",
    is_byok: bool | None = None,
) -> bool:
    tracker = cost_tracker_var.get()
    if tracker is None:
        return False
    try:
        tracker.record(
            UsageEvent(
                model=model,
                requested_model=model,
                generation_id=None,
                prompt_tokens=max(0, prompt_tokens),
                completion_tokens=max(0, completion_tokens),
                total_tokens=max(0, total_tokens if total_tokens is not None else prompt_tokens + completion_tokens),
                cached_tokens=0,
                reasoning_tokens=0,
                cost_usd=max(0.0, cost_usd),
                cost_source=cost_source,
                is_byok=is_byok,
                role=role,
            )
        )
    except Exception:  # noqa: BLE001 - accounting must never take a search down
        logger.warning("Could not record a %s usage event", role, exc_info=True)
        return False
    return True


def _usage_event_from_openai(response: Any, *, role: str, requested_model: str | None) -> UsageEvent | None:
    usage = getattr(response, "usage", None)
    if usage is None:
        return None
    raw = usage.model_dump() if hasattr(usage, "model_dump") else dict(usage) if isinstance(usage, dict) else {}
    generation_id = getattr(response, "id", None)
    prompt_details = raw.get("prompt_tokens_details") or {}
    completion_details = raw.get("completion_tokens_details") or {}
    prompt_tokens = _as_int(raw.get("prompt_tokens"))
    completion_tokens = _as_int(raw.get("completion_tokens"))
    cost_usd = _reported_cost(raw.get("cost"), generation_id)
    is_byok = raw.get("is_byok")
    return UsageEvent(
        model=getattr(response, "model", None) or requested_model,
        requested_model=requested_model,
        generation_id=generation_id if isinstance(generation_id, str) else None,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=_as_int(raw.get("total_tokens")) or prompt_tokens + completion_tokens,
        cached_tokens=_as_int(prompt_details.get("cached_tokens") if isinstance(prompt_details, dict) else 0),
        cache_write_tokens=_as_int(prompt_details.get("cache_write_tokens") if isinstance(prompt_details, dict) else 0),
        reasoning_tokens=_as_int(
            completion_details.get("reasoning_tokens") if isinstance(completion_details, dict) else 0
        ),
        cost_usd=cost_usd if cost_usd is not None else 0.0,
        cost_source="usage_field" if cost_usd is not None else "missing",
        is_byok=is_byok if isinstance(is_byok, bool) else None,
        role=role,
    )


def record_completion_usage(
    body: Mapping[str, Any], *, role: str, requested_model: str | None, is_byok: bool | None = None
) -> bool:
    tracker = cost_tracker_var.get()
    if tracker is None:
        return False
    try:
        response = SimpleNamespace(
            usage=body.get("usage") if isinstance(body.get("usage"), dict) else {},
            id=body.get("id"),
            model=body.get("model") if isinstance(body.get("model"), str) else None,
        )
        event = _usage_event_from_openai(response, role=role, requested_model=requested_model)
        if event is None:
            return False
        if event.is_byok is None:
            event.is_byok = is_byok
        tracker.record(event)
    except Exception:  # noqa: BLE001 - accounting must never fail the call it measures
        logger.warning("Could not record a %s usage event", role, exc_info=True)
        return False
    return True


def _metered(create: Any, role: str) -> Any:
    @functools.wraps(create)
    def call(*args: Any, **kwargs: Any) -> Any:
        response = create(*args, **kwargs)
        tracker = cost_tracker_var.get()
        if tracker is not None:
            try:
                event = _usage_event_from_openai(response, role=role, requested_model=kwargs.get("model"))
                if event is not None:
                    tracker.record(event)
            except Exception:  # noqa: BLE001 - accounting must never fail the call it measures
                logger.warning("Could not record a %s usage event", role, exc_info=True)
        return response

    call.__metered__ = True  # type: ignore[attr-defined]
    return call


def meter_openai_client(client: Any, *, role: str) -> Any:
    for resource_name in ("chat.completions", "embeddings"):
        try:
            resource = client
            for part in resource_name.split("."):
                resource = getattr(resource, part)
        except AttributeError:
            continue
        create = getattr(resource, "create", None)
        if create is None or getattr(create, "__metered__", False):
            continue
        resource.create = _metered(create, role)
    return client


def submit_in_context(executor: Any, fn: Any, /, *args: Any, **kwargs: Any) -> Future[Any]:
    return executor.submit(copy_context().run, fn, *args, **kwargs)


def _read_identity_from_context() -> dict[str, str | None]:
    from agent.project_context import _read_header
    from agent.project_context import get_conversation_id_from_context
    from agent.project_context import get_organization_id_from_context
    from agent.project_context import get_project_id_from_context
    from agent.project_context import get_signed_request_context

    envelope = get_signed_request_context()
    user_id = envelope.user_id if envelope is not None else _read_header(USER_ID_HEADER)
    return {
        "organization_id": get_organization_id_from_context(),
        "user_id": user_id.strip() if user_id else None,
        "project_id": get_project_id_from_context(),
        "conversation_id": get_conversation_id_from_context(),
    }


def _read_budget_header_from_context() -> str | None:
    from agent.project_context import _read_header
    from agent.project_context import get_signed_request_context

    envelope = get_signed_request_context()
    if envelope is None:
        return _read_header(BUDGET_HEADER)
    if not envelope.budget:
        return None
    raw = json.dumps(envelope.budget, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def capture_usage_context() -> dict[str, Any] | None:
    try:
        identity = _read_identity_from_context()
        raw_budget = _read_budget_header_from_context()
        if not any(identity.values()) and not raw_budget:
            return None
        return {"identity": identity, "budget_header": raw_budget}
    except Exception:
        logger.debug("Could not capture usage context for async job", exc_info=True)
        return None


@contextmanager
def track_llm_costs(
    *,
    job_id: str | None = None,
    identity: dict[str, str | None] | None = None,
    budget: BudgetSnapshot | None = None,
    inline_flush: bool = True,
    activity: str | None = None,
):
    tracker: CostTracker | None = None
    token = None
    try:
        resolved_identity = identity if identity is not None else _read_identity_from_context()
        resolved_budget = budget
        if resolved_budget is None:
            resolved_budget = BudgetSnapshot.from_header(_read_budget_header_from_context())
        tracker = CostTracker(
            organization_id=resolved_identity.get("organization_id"),
            user_id=resolved_identity.get("user_id"),
            project_id=resolved_identity.get("project_id"),
            conversation_id=resolved_identity.get("conversation_id"),
            job_id=job_id,
            message_id=resolved_identity.get("message_id"),
            budget=resolved_budget,
            activity=activity,
        )
        token = cost_tracker_var.set(tracker)
    except Exception:
        logger.warning("Could not activate LLM cost tracking", exc_info=True)
    try:
        yield tracker
    finally:
        if token is not None:
            cost_tracker_var.reset(token)
        if tracker is not None:
            tracker.log_prompt_cache_summary()
        if tracker is not None and inline_flush:
            try:
                tracker.flush(wait=True)
            except Exception:
                logger.warning("Failed to flush usage events at end of turn", exc_info=True)
