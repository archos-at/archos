import logging
import math
import os

logger = logging.getLogger(__name__)


_POSITIVE = float("-inf")


def env_float(name: str, fallback: float, *, minimum: float = _POSITIVE) -> float:
    raw = os.environ.get(name, "")
    try:
        value = float(raw)
    except TypeError, ValueError:
        if raw:
            logger.warning("%s=%r is not a number; using %s", name, raw, fallback)
        return fallback
    if not math.isfinite(value):
        logger.warning("%s=%r must be finite; using %s", name, raw, fallback)
        return fallback
    if minimum is _POSITIVE:
        if value <= 0:
            logger.warning("%s=%r must be positive and finite; using %s", name, raw, fallback)
            return fallback
    elif value < minimum:
        logger.warning("%s=%r must be >= %s; using %s", name, raw, minimum, fallback)
        return fallback
    return value


def env_int(name: str, fallback: int, *, minimum: float = _POSITIVE) -> int:
    return int(env_float(name, float(fallback), minimum=minimum))


_OFF_VALUES = frozenset({"false", "0", "no", "off"})


def env_switch(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() not in _OFF_VALUES
