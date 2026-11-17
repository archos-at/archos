from __future__ import annotations

import contextlib
import logging
import uuid
from collections.abc import Iterator

logger = logging.getLogger(__name__)

TRACE_ID_METADATA_KEY = "trace_id"


def trace_id_for_message(message_id: str | None) -> int | None:
    if not message_id:
        return None
    try:
        value = uuid.UUID(str(message_id)).int
    except ValueError, TypeError, AttributeError:
        return None
    return value or None


def trace_id_hex(trace_id: int | None) -> str | None:
    if not isinstance(trace_id, int) or trace_id <= 0 or trace_id >= 1 << 128:
        return None
    return f"{trace_id:032x}"


def _context_state():  # noqa: ANN202 — the agent runtime's type, imported lazily like everywhere else here
    from nat.plugin_api import ContextState

    return ContextState.get()


@contextlib.contextmanager
def pinned_trace(trace_id: int | None) -> Iterator[None]:
    token = None
    if trace_id is not None:
        try:
            token = _context_state().workflow_trace_id.set(trace_id)
        except Exception:  # noqa: BLE001 — a failed pin costs the link, never the turn
            logger.debug("Could not pin the workflow trace id", exc_info=True)
    try:
        yield
    finally:
        if token is not None:
            with contextlib.suppress(Exception):
                _context_state().workflow_trace_id.reset(token)


def current_trace_id_hex() -> str | None:
    try:
        return trace_id_hex(_context_state().workflow_trace_id.get())
    except Exception:  # noqa: BLE001 — outside an agent-runtime context there is simply no trace
        return None
