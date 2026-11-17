from __future__ import annotations

import hashlib
import logging
import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from typing import Protocol

logger = logging.getLogger(__name__)

ENABLED_ENV = "LANGFUSE_PROMPTS_ENABLED"
LABEL_ENV = "LANGFUSE_PROMPT_LABEL"
CACHE_TTL_ENV = "LANGFUSE_PROMPT_CACHE_TTL_SECONDS"
PUBLIC_KEY_ENV = "LANGFUSE_PUBLIC_KEY"
SECRET_KEY_ENV = "LANGFUSE_SECRET_KEY"  # pragma: allowlist secret
HOST_ENV = "LANGFUSE_HOST"

DEFAULT_LABEL = "production"
DEFAULT_CACHE_TTL_SECONDS = 60
FETCH_TIMEOUT_SECONDS = 2
FETCH_MAX_RETRIES = 0

_TRUTHY = frozenset({"1", "true", "yes", "on"})


@dataclass(frozen=True)
class ResolvedPrompt:

    text: str
    name: str
    version: str
    is_fallback: bool = False


class PromptFetcher(Protocol):

    def get_prompt(
        self,
        name: str,
        *,
        label: str,
        cache_ttl_seconds: int,
        fallback: str,
        max_retries: int,
        fetch_timeout_seconds: int,
    ) -> Any: ...


def git_blob_version(path: Path) -> str:
    data = path.read_bytes()
    # nosemgrep: python.lang.security.insecure-hash-algorithms.insecure-hash-algorithm-sha1
    digest = hashlib.sha1(b"blob %d\0" % len(data) + data, usedforsecurity=False)
    return digest.hexdigest()[:7]


def prompt_management_enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "").strip().lower() in _TRUTHY


def configured_label() -> str:
    return os.environ.get(LABEL_ENV, "").strip() or DEFAULT_LABEL


def configured_cache_ttl_seconds() -> int:
    raw = os.environ.get(CACHE_TTL_ENV, "").strip()
    if not raw:
        return DEFAULT_CACHE_TTL_SECONDS
    try:
        return max(0, int(raw))
    except ValueError:
        logger.warning("%s is not an integer (%r); using %ss", CACHE_TTL_ENV, raw, DEFAULT_CACHE_TTL_SECONDS)
        return DEFAULT_CACHE_TTL_SECONDS


def build_langfuse_client() -> PromptFetcher | None:
    public_key = os.environ.get(PUBLIC_KEY_ENV, "").strip()
    secret_key = os.environ.get(SECRET_KEY_ENV, "").strip()
    if not public_key or not secret_key:
        return None
    from langfuse import Langfuse

    return Langfuse(
        public_key=public_key,
        secret_key=secret_key,
        host=os.environ.get(HOST_ENV, "").strip() or None,
        tracing_enabled=False,
        timeout=FETCH_TIMEOUT_SECONDS,
    )


class PromptStore:

    def __init__(
        self,
        *,
        client_factory: Callable[[], PromptFetcher | None] = build_langfuse_client,
        clock: Callable[[], float] = time.monotonic,
        enabled: bool | None = None,
        label: str | None = None,
        cache_ttl_seconds: int | None = None,
    ) -> None:
        self._client_factory = client_factory
        self._clock = clock
        self._enabled = prompt_management_enabled() if enabled is None else enabled
        self._label = label or configured_label()
        self._cache_ttl_seconds = configured_cache_ttl_seconds() if cache_ttl_seconds is None else cache_ttl_seconds
        self._client: PromptFetcher | None = None
        self._client_resolved = False
        self._muted_until: dict[str, float] = {}
        self._logged: set[str] = set()

    def get(self, name: str, *, fallback: ResolvedPrompt) -> ResolvedPrompt:
        if not self._enabled:
            return fallback
        if self._clock() < self._muted_until.get(name, 0.0):
            return fallback
        fetcher = self._fetcher()
        if fetcher is None:
            return fallback
        return self._fetch(fetcher, name, fallback) or fallback

    def _fetcher(self) -> PromptFetcher | None:
        if self._client_resolved:
            return self._client
        self._client_resolved = True
        try:
            self._client = self._client_factory()
        except Exception:
            self._client = None
            logger.warning("Langfuse prompt client could not be built; serving committed prompts", exc_info=True)
            return None
        if self._client is None:
            logger.info("Langfuse prompt management is on but its public/secret key variables are unset")
        return self._client

    def _fetch(self, fetcher: PromptFetcher, name: str, fallback: ResolvedPrompt) -> ResolvedPrompt | None:
        try:
            fetched = fetcher.get_prompt(
                name,
                label=self._label,
                cache_ttl_seconds=self._cache_ttl_seconds,
                fallback=fallback.text,
                max_retries=FETCH_MAX_RETRIES,
                fetch_timeout_seconds=FETCH_TIMEOUT_SECONDS,
            )
        except Exception:
            self._mute(name, "fetch-failed", exc_info=True)
            return None
        if getattr(fetched, "is_fallback", False):
            self._mute(name, "fetch-failed")
            return None
        text = getattr(fetched, "prompt", None)
        if not isinstance(text, str) or not text.strip():
            self._mute(name, "unusable-prompt")
            return None
        version = str(getattr(fetched, "version", "") or "unknown")
        return ResolvedPrompt(text=text, name=name, version=version, is_fallback=False)

    def _mute(self, name: str, reason: str, *, exc_info: bool = False) -> None:
        self._muted_until[name] = self._clock() + max(self._cache_ttl_seconds, DEFAULT_CACHE_TTL_SECONDS)
        key = f"{name}:{reason}"
        if key in self._logged:
            return
        self._logged.add(key)
        logger.warning(
            "Langfuse prompt %r unavailable (%s); serving the committed prompt for the next %ss",
            name,
            reason,
            max(self._cache_ttl_seconds, DEFAULT_CACHE_TTL_SECONDS),
            exc_info=exc_info,
        )


_STORE: PromptStore | None = None


def prompt_store() -> PromptStore:
    global _STORE
    if _STORE is None:
        _STORE = PromptStore()
    return _STORE


def reset_prompt_store() -> None:
    global _STORE
    _STORE = None
