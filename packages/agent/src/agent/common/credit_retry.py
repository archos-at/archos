"""Backoff for the provider's transient 402: credits held by requests still in flight.

OpenRouter answers HTTP 402 with "would exceed your available credits given
your current in-flight requests" when the key's balance minus what running
requests may still spend cannot cover this one. That clears by itself as the
in-flight requests finish, so a short wait and a retry usually succeeds. A
plain "Insufficient credits" is an empty balance: no wait fixes it, so it is
not retried and reaches the caller as the 402 it is.

The OpenAI SDK retries 408, 409, 429 and 5xx only, never 402, so the retry
lives where every worker's call passes: the OpenRouter transport
(``common.openrouter``). Pure here, so the rule is pinned by a spec.
"""

from __future__ import annotations

import random

#: Retries after the first attempt; the waits are 1 s, 2 s, 4 s (about 7 s in all).
MAX_RETRIES = 3
BASE_DELAY_SECONDS = 1.0
IN_FLIGHT_MARKER = "in-flight"


def is_transient_credit_402(status_code: int, body: bytes) -> bool:
    """Whether a response is the in-flight-credit 402 (not an empty balance)."""
    return status_code == 402 and IN_FLIGHT_MARKER in body.decode("utf-8", "replace").lower()


def delay_seconds(attempt: int) -> float:
    """The wait before retry number ``attempt`` (0-based): doubling, with jitter so callers do not return together."""
    return BASE_DELAY_SECONDS * 2**attempt * (0.9 + 0.2 * random.random())
