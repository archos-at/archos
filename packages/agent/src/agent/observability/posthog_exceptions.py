from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable
from types import TracebackType

from agent.common.log_redaction import scrub_presigned_urls
from agent.observability import posthog_client

FINGERPRINT_BURST = 3
FINGERPRINT_REFILL_SECONDS = 300.0
GLOBAL_BURST = 20
GLOBAL_REFILL_SECONDS = 60.0
_GLOBAL_KEY = "process"

MESSAGE_MAX = 500
_SKIPPED_LOGGER_PREFIXES = ("posthog", "agent.observability.posthog")


def _innermost_frame(traceback: TracebackType | None) -> str:
    frame = None
    while traceback is not None:
        frame = traceback
        traceback = traceback.tb_next
    if frame is None:
        return ""
    code = frame.tb_frame.f_code
    return f"{os.path.basename(code.co_filename)}:{code.co_name}:{frame.tb_lineno}"


def fingerprint(record: logging.LogRecord) -> str:
    exc_type, _, traceback = record.exc_info or (None, None, None)
    type_name = f"{exc_type.__module__}.{exc_type.__qualname__}" if exc_type else ""
    return f"{type_name}|{record.name}|{_innermost_frame(traceback)}"


def _message(record: logging.LogRecord) -> str:
    try:
        text = record.getMessage()
    except Exception:  # noqa: BLE001 - a malformed format string must not lose the exception
        text = str(record.msg)
    return scrub_presigned_urls(text)[:MESSAGE_MAX]


def _current_trace_id() -> str | None:
    try:
        from agent.observability.turn_trace import current_trace_id_hex

        return current_trace_id_hex()
    except Exception:  # noqa: BLE001 - no agent-runtime context is not an error
        return None


def event_properties(record: logging.LogRecord) -> dict[str, str]:
    properties = {
        "source": "python-logging",
        "logger": record.name,
        "log_level": record.levelname,
        "log_message": _message(record),
        "log_origin": f"{record.pathname}:{record.lineno}",
    }
    trace_id = _current_trace_id()
    if trace_id:
        properties["$ai_trace_id"] = trace_id
        properties["langfuse_trace_id"] = trace_id
    return properties


class PosthogExceptionHandler(logging.Handler):

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        super().__init__(level=logging.ERROR)
        self._per_fingerprint = posthog_client.rate_limiter(FINGERPRINT_BURST, FINGERPRINT_REFILL_SECONDS, clock)
        self._process = posthog_client.rate_limiter(GLOBAL_BURST, GLOBAL_REFILL_SECONDS, clock)

    def _admit(self, key: str) -> bool:
        if self._per_fingerprint.consume_rate_limit(key):
            return False
        return not self._process.consume_rate_limit(_GLOBAL_KEY)

    def emit(self, record: logging.LogRecord) -> None:
        if not record.exc_info or record.exc_info[1] is None:
            return
        if record.name.startswith(_SKIPPED_LOGGER_PREFIXES):
            return
        if getattr(record.exc_info[1], "expected_outcome", False):
            return
        if not self._admit(fingerprint(record)):
            return
        try:
            posthog_client.capture_exception(record.exc_info[1], properties=event_properties(record))
        except Exception:  # noqa: BLE001 - see "Never raises" in the module header
            return


def install(logger: logging.Logger | None = None) -> PosthogExceptionHandler | None:
    if not posthog_client.posthog_enabled():
        return None
    target = logger if logger is not None else logging.getLogger()
    for handler in target.handlers:
        if isinstance(handler, PosthogExceptionHandler):
            return handler
    handler = PosthogExceptionHandler()
    target.addHandler(handler)
    return handler
