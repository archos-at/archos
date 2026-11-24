from __future__ import annotations

import asyncio
import contextvars
import logging
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from agent import project_context
from agent.common.bff_http import SignedEnvelope
from agent.observability.retrieval_trace import emit_step_span
from agent.turn.annotation_reply import settle_thread_reply

from .client import LEAVE_TIMEOUT_SECONDS
from .client import CanvasRequestError
from .client import post_canvas

logger = logging.getLogger(__name__)

SUBJECT = ""


@dataclass
class CanvasPresence:
    documents: set[str] = field(default_factory=set)


_presence: contextvars.ContextVar[CanvasPresence | None] = contextvars.ContextVar("canvas_presence", default=None)


def begin_canvas_presence() -> CanvasPresence:
    presence = CanvasPresence()
    _presence.set(presence)
    return presence


def current_canvas_presence() -> CanvasPresence | None:
    return _presence.get()


def note_presence(document_id: str | None) -> None:
    presence = _presence.get()
    if presence is not None:
        presence.documents.add(document_id or SUBJECT)


async def show_reading(
    target_body: dict[str, Any],
    document_id: str | None,
    signed: SignedEnvelope,
    page: int,
    region: list[float] | None,
) -> None:
    payload: dict[str, Any] = {"op": "look", "page": page, **target_body}
    if region is not None and len(region) == 4:
        payload.update(zip(("x", "y", "w", "h"), (round(float(value), 4) for value in region), strict=True))
    try:
        await asyncio.to_thread(post_canvas, payload, signed, timeout=LEAVE_TIMEOUT_SECONDS)
        note_presence(document_id)
    except Exception as exc:  # noqa: BLE001 - presence never takes the look down
        logger.info("Showing what Piloti reads failed: %s", exc)


def _envelope() -> SignedEnvelope | None:
    header, signature = project_context.get_request_envelope_from_context()
    return SignedEnvelope(header=header, signature=signature) if header and signature else None


async def leave_canvas(presence: CanvasPresence | None) -> None:
    settle_thread_reply()
    if presence is None or not presence.documents:
        return
    envelope = _envelope()
    if envelope is None:
        return
    for document in sorted(presence.documents):
        payload = {"op": "leave", **({"documentId": document} if document else {})}
        try:
            await asyncio.to_thread(post_canvas, payload, envelope, timeout=LEAVE_TIMEOUT_SECONDS)
            emit_step_span("canvas.leave", {"document": document or "subject"}, {"ok": True})
        except CanvasRequestError as exc:
            logger.info("Leaving the canvas of %s failed: %s", document or "the subject", exc)
            outcome = {"refused": exc.status or "unreachable"}
            emit_step_span("canvas.leave", {"document": document or "subject"}, outcome)
        except Exception:  # noqa: BLE001 - presence never takes the turn down
            logger.warning("Leaving the canvas failed", exc_info=True)
    presence.documents.clear()
