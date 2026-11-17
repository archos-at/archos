from __future__ import annotations

import random

MAX_RETRIES = 3
BASE_DELAY_SECONDS = 1.0
IN_FLIGHT_MARKER = "in-flight"


def is_transient_credit_402(status_code: int, body: bytes) -> bool:
    return status_code == 402 and IN_FLIGHT_MARKER in body.decode("utf-8", "replace").lower()


def delay_seconds(attempt: int) -> float:
    return BASE_DELAY_SECONDS * 2**attempt * (0.9 + 0.2 * random.random())
