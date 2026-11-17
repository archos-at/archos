from __future__ import annotations

import logging
import time
from collections.abc import Callable

logger = logging.getLogger(__name__)

GUARDED_WRITE_TIMEOUT_SECONDS = 3.0
FENCE_SLACK_SECONDS = 1.0


def fence_margin() -> float:
    return GUARDED_WRITE_TIMEOUT_SECONDS + FENCE_SLACK_SECONDS


def validate_running_ttl(ttl: float) -> float:
    margin = fence_margin()
    if margin >= ttl:
        raise ValueError(
            f"CHAT_RUNNING_TTL_SECONDS={ttl:g} is not above the fence margin of {margin:g}s "
            f"(a guarded write may take {GUARDED_WRITE_TIMEOUT_SECONDS:g}s): a turn would be fenced as it starts"
        )
    return ttl


class TurnFence:
    def __init__(
        self, *, acquired_at: float, ttl: float, clock: Callable[[], float] = time.monotonic, label: str = ""
    ) -> None:
        self._ttl = validate_running_ttl(ttl)
        self._margin = fence_margin()
        self._clock = clock
        self._label = label
        self._deadline = acquired_at + self._ttl - self._margin
        self._tripped = False
        self._released = False
        self.write_timeout = GUARDED_WRITE_TIMEOUT_SECONDS

    @property
    def deadline(self) -> float:
        return self._deadline

    def remaining(self) -> float:
        return max(0.0, self._deadline - self._clock())

    def fenced(self) -> bool:
        if self._tripped:
            return True
        if self._released or self._clock() < self._deadline:
            return False
        self.trip("the renewal deadline passed")
        return True

    def renewed(self, sent_at: float) -> bool:
        if self.fenced():
            return False
        self._deadline = max(self._deadline, sent_at + self._ttl - self._margin)
        return True

    def trip(self, reason: str) -> None:
        if not self._tripped:
            self._tripped = True
            logger.warning("Turn %s is fenced: %s", self._label or "?", reason)

    def release(self) -> None:
        self._released = True
