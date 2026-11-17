from __future__ import annotations

import logging
import os
import threading
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler

logger = logging.getLogger(__name__)

MAX_RUN_COMPLETION_TOKENS_ENV = "MAX_RUN_COMPLETION_TOKENS"

DISABLED_CEILING = 0


class RunBudgetExceededError(RuntimeError):
    expected_outcome = True

    def __init__(self, ceiling: int, used: int) -> None:
        self.ceiling = ceiling
        self.used = used
        super().__init__(f"run exceeded the configured completion-token budget of {ceiling}")


def _parse_completion_token_ceiling(raw: str | None) -> int:
    if raw is None or not raw.strip():
        return DISABLED_CEILING
    try:
        value = int(raw.strip())
    except ValueError:
        logger.warning(
            "Invalid %s=%r (not an integer); disabling the completion-token budget cap",
            MAX_RUN_COMPLETION_TOKENS_ENV,
            raw,
        )
        return DISABLED_CEILING
    if value <= 0:
        return DISABLED_CEILING
    return value


def _extract_completion_tokens(response: Any) -> int:
    try:
        generations = getattr(response, "generations", None)
        if not generations or not generations[0]:
            return 0
        gen = generations[0][0]
        msg = getattr(gen, "message", None)
        if msg is None:
            return 0

        usage_metadata = getattr(msg, "usage_metadata", None)
        if usage_metadata:
            tokens = usage_metadata.get("output_tokens")
            if isinstance(tokens, int):
                return tokens

        response_metadata = getattr(msg, "response_metadata", None) or {}
        token_usage = response_metadata.get("token_usage") or {}
        tokens = token_usage.get("completion_tokens")
        if isinstance(tokens, int):
            return tokens
    except Exception:
        logger.debug("Failed to extract completion tokens from LLM response", exc_info=True)
    return 0


class _BudgetTracker:
    def __init__(self, ceiling: int) -> None:
        self.ceiling = ceiling
        self._lock = threading.Lock()
        self._completion_tokens = 0
        self._exceeded = False

    @property
    def enabled(self) -> bool:
        return self.ceiling > 0

    def add_completion_tokens(self, tokens: int) -> None:
        if not self.enabled or tokens <= 0:
            return
        with self._lock:
            self._completion_tokens += tokens
            if self._completion_tokens > self.ceiling:
                self._exceeded = True

    def check(self) -> None:
        if not self.enabled:
            return
        with self._lock:
            exceeded = self._exceeded
            used = self._completion_tokens
        if exceeded:
            raise RunBudgetExceededError(self.ceiling, used)

    @property
    def completion_tokens(self) -> int:
        with self._lock:
            return self._completion_tokens


class BudgetGuardCallback(BaseCallbackHandler):
    raise_error = True

    def __init__(self, tracker: _BudgetTracker) -> None:
        super().__init__()
        self._tracker = tracker

    @property
    def completion_tokens(self) -> int:
        return self._tracker.completion_tokens

    def on_llm_start(self, serialized: dict | None, prompts: list, **kwargs: Any) -> None:
        self._tracker.check()

    def on_chat_model_start(self, serialized: dict | None, messages: list, **kwargs: Any) -> None:
        self._tracker.check()

    def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        tokens = _extract_completion_tokens(response)
        if tokens:
            self._tracker.add_completion_tokens(tokens)


def create_budget_guard_callback(ceiling: int | None = None) -> BudgetGuardCallback | None:
    resolved_ceiling = (
        ceiling
        if ceiling is not None
        else _parse_completion_token_ceiling(os.environ.get(MAX_RUN_COMPLETION_TOKENS_ENV))
    )
    if resolved_ceiling <= 0:
        return None
    return BudgetGuardCallback(_BudgetTracker(resolved_ceiling))
