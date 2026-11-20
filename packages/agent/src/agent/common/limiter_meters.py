from __future__ import annotations

import logging
import threading
from typing import Any

logger = logging.getLogger(__name__)

_last_limits: dict[tuple[str, str | None], int] = {}
_instruments: tuple[Any, Any, Any] | None = None
_instruments_lock = threading.Lock()


def _meter() -> Any:
    from opentelemetry import metrics

    return metrics.get_meter("agent.provider_limiter")


def _observe_limit(_options: Any) -> list[Any]:
    from opentelemetry.metrics import Observation

    observations = []
    for (scope, model), value in list(_last_limits.items()):
        attributes = {"scope": scope} if model is None else {"scope": scope, "model": model}
        observations.append(Observation(value, attributes))
    return observations


def _meters() -> tuple[Any, Any, Any] | None:
    global _instruments
    if _instruments is not None:
        return _instruments
    with _instruments_lock:
        if _instruments is not None:
            return _instruments
        try:
            meter = _meter()
            meter.create_observable_gauge(
                "grid.provider.limit",
                callbacks=[_observe_limit],
                description="The fleet's adaptive limit of model calls in flight, per scope",
            )
            _instruments = (
                meter.create_up_down_counter("grid.provider.inflight", description="Model calls holding a slot"),
                meter.create_histogram(
                    "grid.provider.wait_seconds", unit="s", description="Time a call waited for a slot"
                ),
                meter.create_counter("grid.provider.throttled_total", description="Calls the provider answered 429"),
            )
        except Exception:  # noqa: BLE001 - a meter must never fail a model call
            logger.debug("Provider limiter meters unavailable", exc_info=True)
            return None
    return _instruments


def _reset_meters() -> None:
    global _instruments
    with _instruments_lock:
        _instruments = None
        _last_limits.clear()


def _record(index: int, method: str, value: float, attributes: dict[str, str]) -> None:
    instruments = _meters()
    if instruments is None:
        return
    try:
        getattr(instruments[index], method)(value, attributes)
    except Exception:  # noqa: BLE001 - see _meters
        logger.debug("Provider limiter meter failed", exc_info=True)
