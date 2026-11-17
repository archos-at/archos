from __future__ import annotations

import asyncio
import logging
import math
import os
import threading
import time
from dataclasses import dataclass
from typing import Any

from .licensed_rerank import rerank_documents

logger = logging.getLogger(__name__)

PROVIDER = "openrouter"
_REMOVED_PROVIDERS = ("cohere", "voyage", "jina", "nvidia")
_PATH = "/rerank"
_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
_DEFAULT_MODEL = "qwen/qwen3-reranker-8b"
_KEY_ENV = "OPENROUTER_API_KEY"
_RESULTS_KEY = "results"
_SCORE_KEY = "relevance_score"

_BREAKER_THRESHOLD = 5
_BREAKER_COOLDOWN_SECONDS = 300.0

_breaker_lock = threading.Lock()
_consecutive_failures = 0
_breaker_tripped_until = 0.0  # time.monotonic() timestamp; 0.0 means closed
_last_failure_warn_at: float | None = None


def _env_float(name: str, fallback: float) -> float:
    raw = os.environ.get(name, "")
    try:
        value = float(raw)
    except TypeError, ValueError:
        if raw:
            logger.warning("%s=%r is not a number; using %s", name, raw, fallback)
        return fallback
    if value <= 0 or not math.isfinite(value):
        logger.warning("%s=%r must be positive and finite; using %s", name, raw, fallback)
        return fallback
    return value


DEFAULT_PROVIDER = os.environ.get("RERANKER_PROVIDER", "none").strip().lower()

DEFAULT_MODEL = os.environ.get("RERANKER_MODEL", "").strip()

DEFAULT_BASE_URL = os.environ.get("RERANKER_BASE_URL", "").strip()

DEFAULT_TIMEOUT_SECONDS = _env_float("RERANKER_TIMEOUT_SECONDS", 3.0)

DEFAULT_MAX_DOC_CHARS = max(1, int(_env_float("RERANKER_MAX_DOC_CHARS", 4000.0)))


def _breaker_open() -> bool:
    global _consecutive_failures, _breaker_tripped_until
    now = time.monotonic()
    with _breaker_lock:
        if _breaker_tripped_until and now < _breaker_tripped_until:
            return True
        if _breaker_tripped_until:
            _breaker_tripped_until = 0.0
            _consecutive_failures = 0
            logger.info("Cross-encoder breaker cooled down; retrying the provider")
        return False


def _record_success() -> None:
    global _consecutive_failures
    with _breaker_lock:
        _consecutive_failures = 0


def _record_failure() -> None:
    global _consecutive_failures, _breaker_tripped_until
    with _breaker_lock:
        _consecutive_failures += 1
        if _consecutive_failures >= _BREAKER_THRESHOLD and not _breaker_tripped_until:
            _breaker_tripped_until = time.monotonic() + _BREAKER_COOLDOWN_SECONDS
            logger.warning(
                "Cross-encoder failed %d times in a row; disabling it for %ds, falling back to the LLM judge",
                _consecutive_failures,
                int(_BREAKER_COOLDOWN_SECONDS),
            )


def _throttled_warning(message: str, *args: Any) -> None:
    global _last_failure_warn_at
    now = time.monotonic()
    with _breaker_lock:
        emit_warning = _last_failure_warn_at is None or now - _last_failure_warn_at >= _BREAKER_COOLDOWN_SECONDS
        if emit_warning:
            _last_failure_warn_at = now
    if emit_warning:
        logger.warning(message, *args)
    else:
        logger.debug(message, *args)


def _reset_breaker_state() -> None:
    global _consecutive_failures, _breaker_tripped_until, _last_failure_warn_at
    with _breaker_lock:
        _consecutive_failures = 0
        _breaker_tripped_until = 0.0
        _last_failure_warn_at = None


def _normalize_base_url(base_url: str) -> str:
    normalized = (base_url or "").strip().rstrip("/")
    if normalized.lower().endswith(_PATH):
        normalized = normalized[: -len(_PATH)].rstrip("/")
    return normalized


JEV_PROVIDER = "jev"


def available_providers() -> tuple[str, ...]:
    return (PROVIDER, JEV_PROVIDER)


@dataclass(frozen=True)
class _Credential:

    api_key: str
    base_url: str
    byok: bool = False


def _resolve_credential(base_url: str, model: str, organization_id: str | None) -> _Credential:
    try:
        from agent.common.credential_resolution import resolve_llm_credential

        resolved = resolve_llm_credential(
            primary_env="RERANKER_API_KEY",
            fallback_envs=(_KEY_ENV,),
            default_base_url=base_url,
            default_model=model,
            organization_id=organization_id,
        )
        if resolved.api_key:
            return _Credential(
                api_key=resolved.api_key,
                base_url=_normalize_base_url(resolved.base_url) or base_url,
                byok=resolved.source == "byok",
            )
    except ImportError:
        logger.debug("credential_resolution unavailable; falling back to a direct env read")
    except Exception as e:
        # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure
        logger.warning("Reranker credential resolution failed (%s); trying the env directly", type(e).__name__)

    env_key = os.environ.get("RERANKER_API_KEY", "") or os.environ.get(_KEY_ENV, "")
    return _Credential(api_key=env_key, base_url=base_url)


def _resolve_api_key(base_url: str, model: str, organization_id: str | None) -> str:
    return _resolve_credential(base_url, model, organization_id).api_key


def _pinned_body(body: dict[str, Any], base_url: str, *, licensed: bool = False) -> dict[str, Any] | None:
    try:
        from agent.common.openrouter import PLATFORM_FIXED
        from agent.common.openrouter import targets_openrouter
    except ImportError:
        _throttled_warning("Cross-encoder skipped: the zero-data-retention seam (agent) is not installed")
        return None
    return PLATFORM_FIXED.apply(body) if targets_openrouter(base_url) else (None if licensed else body)


def _organization_id_in_scope() -> str | None:
    try:
        from agent.project_context import get_organization_id_from_context

        return get_organization_id_from_context()
    except Exception:  # noqa: BLE001 - no agent, or no request context: platform key
        return None


_CHARS_PER_TOKEN = 4


def _reported_usage(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    usage = payload.get("usage")
    if isinstance(usage, dict):
        return usage
    billed = (payload.get("meta") or {}).get("billed_units") if isinstance(payload.get("meta"), dict) else None
    return billed if isinstance(billed, dict) else {}


def _record_usage(model: str, query: str, documents: list[str], payload: Any, *, byok: bool) -> None:
    try:
        from agent.common.cost_tracking import USAGE_ROLE_RERANK
        from agent.common.cost_tracking import record_usage_event
    except ImportError:  # knowledge_layer without the agent package
        return

    usage = _reported_usage(payload)
    reported = usage.get("prompt_tokens") or usage.get("input_tokens") or usage.get("total_tokens")
    if isinstance(reported, int) and reported > 0:
        prompt_tokens, source = reported, "usage_field"
    else:
        prompt_tokens = (len(query) + sum(len(document) for document in documents)) // _CHARS_PER_TOKEN
        source = "estimate"
    record_usage_event(
        model=model,
        role=USAGE_ROLE_RERANK,
        prompt_tokens=prompt_tokens,
        cost_source=source,
        is_byok=byok,
    )


def _parse_rankings(payload: Any, candidate_count: int) -> list[int] | None:
    if not isinstance(payload, dict):
        return None
    entries = payload.get(_RESULTS_KEY)
    if not isinstance(entries, list) or not entries:
        return None

    ordered: list[tuple[float, int, int]] = []
    for position, entry in enumerate(entries):
        if not isinstance(entry, dict):
            continue
        index = entry.get("index")
        if isinstance(index, bool) or not isinstance(index, int):
            continue
        if not 0 <= index < candidate_count:
            continue
        score = entry.get(_SCORE_KEY)
        usable = isinstance(score, (int, float)) and not isinstance(score, bool) and math.isfinite(float(score))
        ordered.append((float(score) if usable else 0.0, position, index))

    if not ordered:
        return None

    ordered.sort(key=lambda entry: (-entry[0], entry[1]))

    seen: set[int] = set()
    indices: list[int] = []
    for _, _, index in ordered:
        if index in seen:
            continue
        seen.add(index)
        indices.append(index)
    return indices or None


class CrossEncoderReranker:

    def __init__(
        self,
        provider: str = PROVIDER,
        *,
        model: str | None = None,
        base_url: str | None = None,
        api_key: str | None = None,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        max_doc_chars: int = DEFAULT_MAX_DOC_CHARS,
        organization_id: str | None = None,
    ):
        if provider != PROVIDER:
            raise ValueError(f"Unknown reranker provider {provider!r}; expected one of {available_providers()}")
        self.provider = provider
        self.base_url = _normalize_base_url(base_url or DEFAULT_BASE_URL or _DEFAULT_BASE_URL)
        self.model = model or DEFAULT_MODEL or _DEFAULT_MODEL
        self.timeout_seconds = timeout_seconds
        self.max_doc_chars = max_doc_chars
        self._api_key = api_key if api_key is not None else _resolve_api_key(self.base_url, self.model, organization_id)

    @property
    def configured(self) -> bool:
        return bool(self._api_key)

    def _build_body(self, query: str, documents: list[str], top_n: int | None) -> dict[str, Any]:
        body: dict[str, Any] = {"model": self.model, "query": query, "documents": documents}
        if top_n and top_n > 0:
            body["top_n"] = min(top_n, len(documents))
        return body

    async def _credential_for_search(self) -> _Credential:
        organization_id = _organization_id_in_scope()
        if not organization_id:
            return _Credential(api_key=self._api_key, base_url=self.base_url)
        resolved = await asyncio.to_thread(_resolve_credential, self.base_url, self.model, organization_id)
        if resolved.api_key:
            return resolved
        return _Credential(api_key=self._api_key, base_url=self.base_url)

    async def rerank(self, query: str, chunks: list[Any], *, top_n: int | None = None) -> list[Any] | None:
        if not chunks or not query:
            return None
        if not self.configured:
            _throttled_warning("Cross-encoder provider %r has no API key resolved; skipping", self.provider)
            return None
        if _breaker_open():
            logger.debug("Cross-encoder breaker tripped; keeping retrieval order")
            return None

        documents, licensed = rerank_documents(chunks, self.max_doc_chars)
        credential = await self._credential_for_search()
        url = f"{credential.base_url}{_PATH}"
        body = _pinned_body(self._build_body(query, documents, top_n), credential.base_url, licensed=licensed)
        if body is None:
            return None
        try:
            from agent.common.openrouter import limited_async_http_client

            async with limited_async_http_client(timeout=self.timeout_seconds) as client:
                response = await client.post(
                    url,
                    headers={
                        "Authorization": f"Bearer {credential.api_key}",
                        "Content-Type": "application/json",
                        "Accept": "application/json",
                    },
                    json=body,
                )
                response.raise_for_status()
                payload = response.json()
        except Exception as e:
            _record_failure()
            _throttled_warning(
                "Cross-encoder rerank via %s failed (%s: %s); keeping retrieval order",
                self.provider,
                type(e).__name__,
                e,
            )
            return None

        indices = _parse_rankings(payload, len(chunks))
        if indices is None:
            _record_failure()
            _throttled_warning("Cross-encoder %s returned no usable ranking; keeping retrieval order", self.provider)
            return None

        _record_success()
        _record_usage(self.model, query, documents, payload, byok=credential.byok)

        ranked = [chunks[i] for i in indices]
        if len(ranked) < len(chunks):
            ranked.extend(chunk for position, chunk in enumerate(chunks) if position not in set(indices))
        return ranked


def resolve_cross_encoder(
    provider: str | None = None,
    *,
    model: str | None = None,
    base_url: str | None = None,
    timeout_seconds: float | None = None,
    max_doc_chars: int | None = None,
    organization_id: str | None = None,
) -> Any:
    candidate = provider if provider is not None else DEFAULT_PROVIDER
    if not isinstance(candidate, str):
        logger.warning("Reranker provider %r is not a string; falling back to the LLM judge.", candidate)
        return None
    name = (candidate or "none").strip().lower()
    if name in {"", "none", "off", "false", "0", "llm_judge"}:
        return None
    if name == JEV_PROVIDER:
        from .decisions import JevReranker

        jev = JevReranker(
            timeout_seconds=timeout_seconds if timeout_seconds is not None else DEFAULT_TIMEOUT_SECONDS, model=model
        )
        if not jev.configured:
            logger.warning(
                "Reranker provider 'jev' is configured but decisions are off; falling back to the LLM judge."
            )
            return None
        logger.info("Decision-model reranking via jev (%s)", jev.model)
        return jev
    if name != PROVIDER:
        if name in _REMOVED_PROVIDERS:
            logger.error(
                "Reranker provider %r was removed; only 'openrouter' is supported. "
                "Migrate with `reranker_provider: openrouter`. Falling back to the LLM judge.",
                name,
            )
        else:
            logger.warning(
                "Unknown reranker provider %r; expected one of %s. Falling back to the LLM judge.",
                name,
                available_providers(),
            )
        return None

    reranker = CrossEncoderReranker(
        name,
        model=model,
        base_url=base_url,
        timeout_seconds=timeout_seconds if timeout_seconds is not None else DEFAULT_TIMEOUT_SECONDS,
        max_doc_chars=max_doc_chars if max_doc_chars is not None else DEFAULT_MAX_DOC_CHARS,
        organization_id=organization_id,
    )
    if not reranker.configured:
        # nosemgrep: python.lang.security.audit.logging.logger-credential-leak.python-logger-credential-disclosure
        logger.warning(
            "Reranker provider %r is configured but no API key resolved (RERANKER_API_KEY / %s); "
            "falling back to the LLM judge.",
            name,
            _KEY_ENV,
        )
        return None
    logger.info("Cross-encoder reranking via %s (%s)", name, reranker.model)
    return reranker
