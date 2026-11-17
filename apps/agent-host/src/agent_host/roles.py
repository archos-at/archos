from __future__ import annotations

import os
from collections.abc import Mapping
from enum import StrEnum


class WebRole(StrEnum):
    CHAT = "chat"
    API = "api"


ROLE_ENV = "PROCESS_ROLE"


def web_role(env: Mapping[str, str] | None = None) -> WebRole:
    raw = (os.environ if env is None else env).get(ROLE_ENV, "").strip().lower()
    try:
        return WebRole(raw)
    except ValueError:
        allowed = ", ".join(role.value for role in WebRole)
        raise ValueError(f"{ROLE_ENV}={raw!r} is not a web role: set it to one of {allowed}") from None
