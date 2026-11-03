"""``answer_failed``: the reason a turn ended without an answer, and the event that carries it."""

from __future__ import annotations

import httpx
import pytest

from agent.common.cost_tracking import BudgetExceededError
from agent.observability import answer_failure
from agent.observability import posthog_client


class _Status(Exception):
    def __init__(self, status_code):
        super().__init__(f"status {status_code}")
        self.status_code = status_code


def _wrapped(inner):
    try:
        raise RuntimeError("workflow failed") from inner
    except RuntimeError as outer:
        return outer


@pytest.mark.parametrize(
    ("exc", "reason"),
    [
        (_Status(402), "provider_credits"),
        (_wrapped(_Status(402)), "provider_credits"),
        (BudgetExceededError("organization"), "budget"),
        (TimeoutError(), "timeout"),
        (httpx.ReadTimeout("slow"), "timeout"),
        (_Status(500), "provider_error"),
        (ValueError("boom"), "workflow_error"),
    ],
)
def test_reason_for(exc, reason):
    assert answer_failure.reason_for(exc) == reason


def test_reason_for_text():
    assert answer_failure.reason_for_text("Error code: 402 - Insufficient credits") == "provider_credits"
    assert answer_failure.reason_for_text("turn_deadline_exceeded: 300s") == "timeout"
    assert answer_failure.reason_for_text(None) == "workflow_error"


def test_capture_sends_the_event_with_message_id(monkeypatch):
    sent = []
    monkeypatch.setattr(posthog_client, "capture", lambda event, **kw: sent.append((event, kw)) or True)
    answer_failure.capture_answer_failed(message_id="m1", reason="timeout", distinct_id="u1", error_type=None)
    assert sent == [("answer_failed", {"distinct_id": "u1", "properties": {"message_id": "m1", "reason": "timeout"}})]
