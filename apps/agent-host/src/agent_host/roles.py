"""The role this web process plays: ``chat`` or ``api`` (ADR-0082 step B).

One image, one process type per job. ``PROCESS_ROLE`` is the whole switch and has
no default: a process that cannot say what it is must not guess, because a
guess mounts a route set that no Deployment's Service, probe or scaler was
written for. The same variable names the two worker tiers
(``worker``, ``ingest-worker``), but those never load this front end, so this
module knows only the two roles that serve HTTP.

Read once, when the worker is built (``plugin.AgentHostWorker.__init__``), and held
as a value from then on, so no later code re-reads the environment and answers
differently.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from enum import StrEnum


class WebRole(StrEnum):
    """What a web process serves. The values are what ``PROCESS_ROLE`` holds."""

    CHAT = "chat"
    API = "api"


ROLE_ENV = "PROCESS_ROLE"


def web_role(env: Mapping[str, str] | None = None) -> WebRole:
    """The web role ``PROCESS_ROLE`` names; raises ``ValueError`` when it is unset or not one."""
    raw = (os.environ if env is None else env).get(ROLE_ENV, "").strip().lower()
    try:
        return WebRole(raw)
    except ValueError:
        allowed = ", ".join(role.value for role in WebRole)
        raise ValueError(f"{ROLE_ENV}={raw!r} is not a web role: set it to one of {allowed}") from None
