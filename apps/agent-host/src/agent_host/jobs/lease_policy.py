from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

SECONDS_PER_DAY = 86_400

MAX_ATTEMPTS = 3
HEARTBEAT_SECONDS = 30
DRAIN_SECONDS = 600
DEAD_RETENTION_DAYS = 14


def int_env(name: str, default: int, *, floor: int | None = None) -> int:
    try:
        value = int(os.environ.get(name, ""))
    except ValueError:
        return default
    if floor is not None and value < floor:
        return default
    return value


def touch_liveness(path: str) -> None:
    try:
        with open(path, "w") as handle:
            handle.write("ok")
    except OSError:
        logger.warning("Could not write the liveness file %s", path, exc_info=True)
