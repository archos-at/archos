from __future__ import annotations

import asyncio
import logging
import math
import os
import threading
import time
from collections.abc import AsyncIterator
from collections.abc import Mapping
from collections.abc import Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from dataclasses import field
from typing import Any
from urllib.parse import urlsplit

from agent.common.openrouter import PLATFORM_FIXED
from agent.common.openrouter import limited_async_http_client

logger = logging.getLogger(__name__)

ENABLED_ENV = "DECISIONS_ENABLED"

MODEL_ENV = "DECISIONS_MODEL"

URL_ENV = "DECISIONS_URL"

DEDICATED_ENV = "DECISIONS_API_KEY"  # pragma: allowlist secret

DEFAULT_MODEL = "typesafe/jev-1.13"
DEFAULT_PATH = "/api/alpha/decisions"
_FALLBACK_KEY_ENV = "OPENROUTER_API_KEY"
_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
_OPENROUTER_HOST = "openrouter.ai"

DEFAULT_TIMEOUT_S = 1.5

DEFAULT_CONCURRENCY = 12

USAGE_ROLE_DECISION = "decision"

SKIPPED_DISABLED = "disabled"
SKIPPED_NO_KEY = "no_key"
SKIPPED_BYOK_HOST = "byok_host"
SKIPPED_BREAKER = "breaker"
SKIPPED_TIMEOUT = "timeout"
SKIPPED_ERROR = "error"
SKIPPED_TOO_SHORT = "too_short"

_BREAKER_THRESHOLD = 5
_BREAKER_COOLDOWN_S = 300.0
_breaker_lock = threading.Lock()
_consecutive_failures = 0
_breaker_open_until = 0.0




def noul(instructions: str, *, true: str, false: str) -> dict[str, Any]:
    return {"type": "noul", "instructions": instructions, "criteria": {"true": true, "false": false}}


def choice(instructions: str, options: Mapping[str, str]) -> dict[str, Any]:
    if not options or len(options) > 255:
        raise ValueError("a choice needs between 1 and 255 options")
    return {"type": "choice", "instructions": instructions, "criteria": dict(options)}


def score(instructions: str, levels: Sequence[str]) -> dict[str, Any]:
    if not 2 <= len(levels) <= 10:
        raise ValueError("a score needs between 2 and 10 levels")
    return {"type": "score", "instructions": instructions, "criteria": list(levels)}




@dataclass(frozen=True)
class Decision:

    answers: Mapping[str, Mapping[str, Any]]
    model: str = ""
    latency_ms: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None
    request_id: str | None = None

    def noul(self, key: str) -> float | None:
        answer = self.answers.get(key)
        return _probability(answer.get("noul")) if isinstance(answer, Mapping) else None

    def choice(self, key: str) -> tuple[str | None, dict[str, float]]:
        answer = self.answers.get(key)
        if not isinstance(answer, Mapping):
            return None, {}
        raw = answer.get("probabilities")
        distribution = (
            {str(option): p for option, value in raw.items() if (p := _probability(value)) is not None}
            if isinstance(raw, Mapping)
            else {}
        )
        chosen = answer.get("choice")
        return (str(chosen) if isinstance(chosen, str) and chosen else None), distribution

    def score(self, key: str) -> float | None:
        answer = self.answers.get(key)
        if not isinstance(answer, Mapping):
            return None
        value = answer.get("score")
        return float(value) if isinstance(value, (int, float)) and math.isfinite(float(value)) else None

    def summary(self) -> dict[str, float | str | None]:
        out: dict[str, float | str | None] = {}
        for key, answer in self.answers.items():
            kind = answer.get("type") if isinstance(answer, Mapping) else None
            if kind == "noul":
                out[key] = self.noul(key)
            elif kind == "score":
                out[key] = self.score(key)
            elif kind == "choice":
                chosen, distribution = self.choice(key)
                out[key] = chosen
                out[f"{key}.p"] = round(distribution.get(chosen or "", 0.0), 3)
        return out


def _probability(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number):
        return None
    return min(1.0, max(0.0, number))




@dataclass(frozen=True)
class _Endpoint:
    url: str
    api_key: str
    model: str
    byok: bool = False


@dataclass
class _Outcome:

    decision: Decision | None = None
    skipped: str | None = None
    detail: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "true").strip().lower() not in {"0", "false", "off", "no"}


def _breaker_open() -> bool:
    with _breaker_lock:
        return time.monotonic() < _breaker_open_until


def _record_failure() -> None:
    global _consecutive_failures, _breaker_open_until
    with _breaker_lock:
        _consecutive_failures += 1
        if _consecutive_failures >= _BREAKER_THRESHOLD:
            _breaker_open_until = time.monotonic() + _BREAKER_COOLDOWN_S
            _consecutive_failures = 0
            logger.warning(
                "Decision endpoint failed %d times in a row; off for %.0fs", _BREAKER_THRESHOLD, _BREAKER_COOLDOWN_S
            )


def _record_success() -> None:
    global _consecutive_failures
    with _breaker_lock:
        _consecutive_failures = 0


def reset_breaker() -> None:
    global _consecutive_failures, _breaker_open_until
    with _breaker_lock:
        _consecutive_failures = 0
        _breaker_open_until = 0.0


def _resolve_endpoint_blocking(organization_id: str | None) -> tuple[_Endpoint | None, str | None]:
    model = os.environ.get(MODEL_ENV, "").strip() or DEFAULT_MODEL
    try:
        from agent.common.credential_resolution import resolve_llm_credential

        resolved = resolve_llm_credential(
            primary_env=DEDICATED_ENV,
            fallback_envs=(_FALLBACK_KEY_ENV,),
            default_base_url=_DEFAULT_BASE_URL,
            default_model=model,
            organization_id=organization_id,
        )
        api_key, base_url, byok = resolved.api_key, resolved.base_url, resolved.source == "byok"
    except Exception:  # noqa: BLE001 — type only; the message can carry the key
        logger.warning("Decision credential resolution failed; trying the environment directly")
        api_key = os.environ.get(DEDICATED_ENV, "") or os.environ.get(_FALLBACK_KEY_ENV, "")
        base_url, byok = _DEFAULT_BASE_URL, False
    if not api_key:
        return None, SKIPPED_NO_KEY
    parts = urlsplit(base_url or _DEFAULT_BASE_URL)
    if byok and parts.hostname != _OPENROUTER_HOST:
        return None, SKIPPED_BYOK_HOST
    url = (
        os.environ.get(URL_ENV, "").strip()
        or f"{parts.scheme or 'https'}://{parts.netloc or _OPENROUTER_HOST}{DEFAULT_PATH}"
    )
    return _Endpoint(url=url, api_key=api_key, model=model, byok=byok), None


async def _endpoint(organization_id: str | None) -> tuple[_Endpoint | None, str | None]:
    if not enabled():
        return None, SKIPPED_DISABLED
    if _breaker_open():
        return None, SKIPPED_BREAKER
    organization_id = organization_id or _context_organization_id()
    return await asyncio.to_thread(_resolve_endpoint_blocking, organization_id)


def _context_organization_id() -> str | None:
    try:
        from agent.project_context import get_organization_id_from_context

        return get_organization_id_from_context()
    except Exception:  # noqa: BLE001 — no request context is no organization
        return None


# Measured 2026-09-22: a client per call answered in ~430 ms (~370 ms TLS handshake), a warm connection in ~60 ms.
_shared_client: tuple[Any, Any] | None = None


@asynccontextmanager
async def _client(timeout: float, transport: Any) -> AsyncIterator[Any]:
    import httpx

    if transport is not None:
        async with limited_async_http_client(timeout=timeout, inner=transport) as owned:
            yield owned
        return
    global _shared_client
    loop = asyncio.get_running_loop()
    if _shared_client is None or _shared_client[0] is not loop or _shared_client[1].is_closed:
        _shared_client = (
            loop,
            limited_async_http_client(
                timeout=timeout,
                limits=httpx.Limits(max_keepalive_connections=8, keepalive_expiry=60.0),
            ),
        )
    yield _shared_client[1]


async def _post(
    endpoint: _Endpoint,
    state: Any,
    questions: Mapping[str, Mapping[str, Any]],
    *,
    timeout: float,
    client: Any,
) -> _Outcome:
    import httpx

    body = PLATFORM_FIXED.apply({"model": endpoint.model, "state": state, "questions": dict(questions)})
    started = time.monotonic()
    try:
        response = await client.post(
            endpoint.url,
            json=body,
            timeout=timeout,
            headers={"Authorization": f"Bearer {endpoint.api_key}", "Content-Type": "application/json"},
        )
    except httpx.TimeoutException:
        _record_failure()
        return _Outcome(skipped=SKIPPED_TIMEOUT)
    except Exception as exc:  # noqa: BLE001 — a decision is worth less than the turn
        _record_failure()
        return _Outcome(skipped=SKIPPED_ERROR, detail=type(exc).__name__)
    latency_ms = int((time.monotonic() - started) * 1000)
    if response.status_code != 200:
        if response.status_code >= 500 or response.status_code == 429:
            _record_failure()
        logger.warning("Decision endpoint answered HTTP %s", response.status_code)
        return _Outcome(skipped=SKIPPED_ERROR, detail=f"http_{response.status_code}")
    try:
        payload = response.json()
        answers = payload["answers"]
        if not isinstance(answers, Mapping):
            raise TypeError("answers is not an object")
    except Exception as exc:  # noqa: BLE001
        _record_failure()
        return _Outcome(skipped=SKIPPED_ERROR, detail=f"payload_{type(exc).__name__}")
    _record_success()
    usage = payload.get("usage") if isinstance(payload.get("usage"), Mapping) else {}
    cost = usage.get("cost")
    decision = Decision(
        answers=answers,
        model=str(payload.get("model") or endpoint.model),
        latency_ms=latency_ms,
        input_tokens=int(usage.get("input_tokens") or 0),
        output_tokens=int(usage.get("output_tokens") or 0),
        cost_usd=float(cost) if isinstance(cost, (int, float)) else None,
        request_id=str(payload["id"]) if payload.get("id") else None,
    )
    _record_cost(decision, byok=endpoint.byok)
    return _Outcome(decision=decision)


def _record_cost(decision: Decision, *, byok: bool) -> None:
    try:
        from agent.common.cost_tracking import record_usage_event

        record_usage_event(
            model=decision.model,
            role=USAGE_ROLE_DECISION,
            prompt_tokens=decision.input_tokens,
            completion_tokens=decision.output_tokens,
            cost_usd=decision.cost_usd or 0.0,
            cost_source="usage_field" if decision.cost_usd is not None else "missing",
            is_byok=byok,
        )
    except Exception:  # noqa: BLE001 — accounting never takes a decision down
        logger.debug("Decision usage not recorded", exc_info=True)


def _record(slot: str, detail: dict[str, Any]) -> None:
    from agent.common.turn_status import emit_technical

    emit_technical(f"decision:{slot}", **detail)


_OBSERVED_ANSWERS_MAX = 24


def _observe(
    slot: str,
    questions: Mapping[str, Any] | Sequence[str],
    *,
    states: int,
    decisions: Sequence[Decision | None] = (),
    latency_ms: int | None = None,
    skipped: str | None = None,
) -> None:
    try:
        from agent.observability.decision_trace import decision_observation
        from agent.observability.decision_trace import emit_decision_span

        made = [decision for decision in decisions if decision is not None]
        costs = [decision.cost_usd for decision in made if decision.cost_usd is not None]
        body_in, body_out = decision_observation(
            questions=list(questions),
            states=states,
            answers=[decision.summary() for decision in made[:_OBSERVED_ANSWERS_MAX]],
            model=made[0].model if made else None,
            latency_ms=latency_ms,
            input_tokens=sum(decision.input_tokens for decision in made),
            output_tokens=sum(decision.output_tokens for decision in made),
            cost_usd=sum(costs) if costs else None,
            decided=len(made),
            skipped=skipped,
        )
        emit_decision_span(slot, body_in, body_out)
    except Exception:  # noqa: BLE001 — telemetry never takes a decision down
        logger.debug("Decision %s not observed", slot, exc_info=True)


def record_skipped(
    slot: str, reason: str, detail: str | None = None, *, questions: Mapping[str, Any] | Sequence[str] = ()
) -> None:
    logger.info("Decision %s did not run: %s", slot, reason)
    _record(slot, {"skipped": reason, **({"detail": detail} if detail else {})})
    _observe(slot, questions, states=1, skipped=reason)


async def decide(
    state: Any,
    questions: Mapping[str, Mapping[str, Any]],
    *,
    slot: str,
    timeout: float = DEFAULT_TIMEOUT_S,
    organization_id: str | None = None,
    transport: Any = None,
) -> Decision | None:
    if not questions:
        return None
    endpoint, skipped = await _endpoint(organization_id)
    if endpoint is None:
        record_skipped(slot, skipped or SKIPPED_ERROR, questions=questions)
        return None
    async with _client(timeout, transport) as client:
        outcome = await _post(endpoint, state, questions, timeout=timeout, client=client)
    if outcome.decision is None:
        record_skipped(slot, outcome.skipped or SKIPPED_ERROR, outcome.detail, questions=questions)
        return None
    decision = outcome.decision
    _record(
        slot,
        {**decision.summary(), "latencyMs": decision.latency_ms, "inputTokens": decision.input_tokens},
    )
    _observe(slot, questions, states=1, decisions=[decision], latency_ms=decision.latency_ms)
    return decision


def decide_blocking(
    state: Any,
    questions: Mapping[str, Mapping[str, Any]],
    *,
    slot: str,
    timeout: float = DEFAULT_TIMEOUT_S,
    organization_id: str | None = None,
) -> Decision | None:
    import httpx

    def _run() -> Decision | None:
        return asyncio.run(
            decide(
                state,
                questions,
                slot=slot,
                timeout=timeout,
                organization_id=organization_id,
                transport=httpx.AsyncHTTPTransport(),
            )
        )

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return _run()
    from concurrent.futures import ThreadPoolExecutor
    from contextvars import copy_context

    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(copy_context().run, _run).result()


def decide_many_blocking(
    states: Sequence[Any],
    questions: Mapping[str, Mapping[str, Any]],
    *,
    slot: str,
    timeout: float = DEFAULT_TIMEOUT_S,
    concurrency: int = DEFAULT_CONCURRENCY,
    organization_id: str | None = None,
) -> list[Decision | None]:
    import httpx

    def _run() -> list[Decision | None]:
        return asyncio.run(
            decide_many(
                states,
                questions,
                slot=slot,
                timeout=timeout,
                concurrency=concurrency,
                organization_id=organization_id,
                transport=httpx.AsyncHTTPTransport(),
            )
        )

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return _run()
    from concurrent.futures import ThreadPoolExecutor
    from contextvars import copy_context

    with ThreadPoolExecutor(max_workers=1) as pool:
        return pool.submit(copy_context().run, _run).result()


async def decide_many(
    states: Sequence[Any],
    questions: Mapping[str, Mapping[str, Any]],
    *,
    slot: str,
    timeout: float = DEFAULT_TIMEOUT_S,
    concurrency: int = DEFAULT_CONCURRENCY,
    organization_id: str | None = None,
    transport: Any = None,
) -> list[Decision | None]:
    if not states or not questions:
        return [None] * len(states)
    endpoint, skipped = await _endpoint(organization_id)
    if endpoint is None:
        _record(slot, {"skipped": skipped, "count": len(states)})
        _observe(slot, questions, states=len(states), skipped=skipped)
        return [None] * len(states)
    gate = asyncio.Semaphore(max(1, concurrency))
    started = time.monotonic()
    async with _client(timeout, transport) as client:

        async def _one(state: Any) -> _Outcome:
            async with gate:
                return await _post(endpoint, state, questions, timeout=timeout, client=client)

        outcomes = await asyncio.gather(*(_one(state) for state in states))
    decided = [outcome.decision for outcome in outcomes]
    made = [d for d in decided if d is not None]
    values: dict[str, Any] = {
        "count": len(states),
        "decided": len(made),
        "latencyMs": int((time.monotonic() - started) * 1000),
        "inputTokens": sum(d.input_tokens for d in made),
    }
    failed = [o.skipped for o in outcomes if o.decision is None and o.skipped]
    if failed:
        values["skipped"] = failed[0]
    _record(slot, values)
    _observe(
        slot,
        questions,
        states=len(states),
        decisions=decided,
        latency_ms=values["latencyMs"],
        skipped=failed[0] if failed else None,
    )
    return decided
