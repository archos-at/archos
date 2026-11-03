"""A vision call the provider rate-limits, or holds for in-flight credits, waits and retries; the page is read."""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from knowledge_layer.llamaindex import adapter
from knowledge_layer.llamaindex import vision_calls


class RateLimited(Exception):
    status_code = 429

    def __init__(self, retry_after: str | None = None) -> None:
        super().__init__("Error code: 429 - rate_limit_exceeded")
        self.response = SimpleNamespace(headers={"retry-after": retry_after} if retry_after else {})


def _reply(text: str):
    return SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(content=text))])


class Client:
    def __init__(self, failures: list[Exception]) -> None:
        self.failures = list(failures)
        self.calls = 0
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **_request):
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return _reply("Grundriss EG")


@pytest.fixture
def slept(monkeypatch):
    waits: list[float] = []
    monkeypatch.setattr(vision_calls.time, "sleep", waits.append)
    monkeypatch.setattr(vision_calls.random, "random", lambda: 0.5)  # jitter factor 1.0
    return waits


def _caption(client) -> str:
    return adapter._vlm_chat_create(client, model="m", messages=[], max_tokens=100)


def test_a_rate_limited_call_backs_off_and_succeeds(slept):
    client = Client([RateLimited(), RateLimited()])

    assert _caption(client) == "Grundriss EG"
    assert client.calls == 3
    assert slept == [2.0, 4.0]


def test_the_providers_retry_after_is_honoured(slept):
    client = Client([RateLimited(retry_after="7")])

    assert _caption(client) == "Grundriss EG"
    assert slept == [7.0]


def test_the_retries_run_out(slept, monkeypatch):
    monkeypatch.setattr(vision_calls, "VLM_RATE_LIMIT_RETRIES", 2)
    client = Client([RateLimited()] * 5)

    with pytest.raises(RateLimited):
        _caption(client)
    assert client.calls == 3


def test_any_other_error_is_not_retried(slept):
    client = Client([ValueError("bad image")])

    with pytest.raises(ValueError):
        _caption(client)
    assert client.calls == 1
    assert slept == []


def test_every_attempt_holds_a_fleet_slot(slept, monkeypatch):
    held = []

    class Slot:
        def __enter__(self):
            held.append("in")

        def __exit__(self, *_):
            held.append("out")

    monkeypatch.setattr(vision_calls, "_vlm_slot", Slot)
    client = Client([RateLimited()])

    _caption(client)

    # Two attempts, each inside its own slot, the wait between them outside.
    assert held == ["in", "out", "in", "out"]


IN_FLIGHT = "Error code: 402 - would exceed your available credits given your current in-flight requests"


class PaymentRequired(Exception):
    status_code = 402

    def __init__(self, message: str = IN_FLIGHT) -> None:
        super().__init__(message)
        self.response = SimpleNamespace(headers={})


class TestInFlightCredits:
    """The provider's 402 for credits held by running requests clears by itself; an empty balance does not."""

    def test_an_in_flight_402_waits_and_the_page_is_read(self, slept):
        client = Client([PaymentRequired(), PaymentRequired()])

        assert _caption(client) == "Grundriss EG"
        assert client.calls == 3
        # The transport already waited 1, 2, 4 s on the same 402; this picks up from there.
        assert slept == [4.0, 8.0]

    def test_the_waits_stop_at_the_budget(self, slept):
        client = Client([PaymentRequired()] * 20)

        with pytest.raises(PaymentRequired):
            _caption(client)
        # 4 + 8 + 16 + 32 = 60: the last wait is cut to what the budget had left.
        assert slept == [4.0, 8.0, 16.0, 32.0]
        assert sum(slept) <= vision_calls.CREDIT_WAIT_BUDGET_SECONDS
        assert client.calls == 5

    def test_time_the_transport_already_spent_counts_against_the_budget(self, slept, monkeypatch):
        now = [0.0]
        monkeypatch.setattr(vision_calls.time, "monotonic", lambda: now[0])
        monkeypatch.setattr(vision_calls.time, "sleep", lambda s: (slept.append(s), now.__setitem__(0, now[0] + s)))

        class Slow(Client):
            def _create(self, **request):
                now[0] += 25.0  # each attempt: the transport's own 402 retries, and the request
                return super()._create(**request)

        client = Slow([PaymentRequired()] * 5)

        with pytest.raises(PaymentRequired):
            _caption(client)
        # 25 s, wait 4, 25 s more (54 spent): one last wait for the 6 s left, then 79 s spent and final.
        assert slept == [4.0, 6.0]
        assert client.calls == 3

    def test_an_empty_balance_is_final(self, slept):
        client = Client([PaymentRequired("Error code: 402 - Insufficient credits")])

        with pytest.raises(PaymentRequired):
            _caption(client)
        assert client.calls == 1
        assert slept == []
