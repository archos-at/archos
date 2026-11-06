"""Whether this turn's RIS requests go through the public-source fetcher: the ``sourceRouting`` flag.

Off, ``RisClient`` makes its requests as it always has, from the process it
runs in. On, they go through ``public_sources.routing.source_transport`` for
the ``at-ris`` source record: the sandboxed ``public-source-fetcher`` when
``PUBLIC_SOURCE_FETCHER_URL`` is set, the same guard in this process when not.
The requests themselves are identical either way; only where they are made
changes, which is why the Austrian answers do not.

The flag is the ``source-routing`` WorkOS flag, decided per organization by the
BFF (``GET /api/internal/stages``, ``features.sourceRouting``), and asked the
way ``knowledge/folder_cards/gate.py`` asks: through ``fetch_turn_flags``, with
the answer kept for :data:`TTL_SECONDS`. Anything short of a yes is off.

``SOURCE_ROUTING=on|off`` overrides the flag for a whole process. It exists for
the answer suite, which runs the agent without a BFF (``task
be:eval:answer-suite`` with ``SOURCE_ROUTING=on`` is the "flag on" run); a
deployment does not set it.
"""

from __future__ import annotations

import asyncio
import os
import threading
import time

ENV_OVERRIDE = "SOURCE_ROUTING"
#: How long one organization's answer is reused. The BFF keeps its own 30 s cache underneath.
TTL_SECONDS = 60
_MAX_ORGANIZATIONS = 1000

_lock = threading.Lock()
_answers: dict[str, tuple[bool, float]] = {}


def _organization_id() -> str | None:
    try:
        from agent.project_context import get_organization_id_from_context
    except ImportError:  # adapter used standalone, without the agent package
        return None
    return get_organization_id_from_context()


def _fetch(organization_id: str) -> bool:
    from agent.stages.flags import fetch_turn_flags

    return fetch_turn_flags(organization_id=organization_id).source_routing_allowed


def enabled_for(organization_id: str | None) -> bool:
    """Whether ``organization_id`` routes through the fetcher. Never raises; blocking."""
    override = os.environ.get(ENV_OVERRIDE, "").strip().lower()
    if override in {"on", "off"}:
        return override == "on"
    if not organization_id:
        return False
    now = time.monotonic()
    with _lock:
        held = _answers.get(organization_id)
    if held is not None and now - held[1] < TTL_SECONDS:
        return held[0]
    try:
        answer = _fetch(organization_id)
    except Exception:  # noqa: BLE001 - off is the safe answer: it is today's behaviour
        return False
    with _lock:
        _answers.pop(organization_id, None)
        _answers[organization_id] = (answer, now)
        if len(_answers) > _MAX_ORGANIZATIONS:
            del _answers[next(iter(_answers))]
    return answer


async def routing_enabled() -> bool:
    """:func:`enabled_for` for this turn's organization, off the event loop."""
    override = os.environ.get(ENV_OVERRIDE, "").strip().lower()
    if override in {"on", "off"}:
        return override == "on"
    organization_id = _organization_id()
    if not organization_id:
        return False
    return await asyncio.to_thread(enabled_for, organization_id)


def forget() -> None:
    """Drop every kept answer (tests)."""
    with _lock:
        _answers.clear()
