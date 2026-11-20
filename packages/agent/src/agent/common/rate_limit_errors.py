from __future__ import annotations

import random
from collections.abc import Iterator
from collections.abc import Mapping
from typing import Any

KEY_SCOPE = "key"
MODEL_SCOPE = "model"

RETRY_AFTER_CAP_SECONDS = 30.0


def _chain(exc: BaseException) -> Iterator[BaseException]:
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current
        current = current.__cause__ or current.__context__


def is_rate_limited(exc: BaseException) -> bool:
    for error in _chain(exc):
        response = getattr(error, "response", None)
        if 429 in (getattr(error, "status_code", None), getattr(response, "status_code", None)):
            return True
        if "rate_limit_exceeded" in str(error).lower():
            return True
    return False


def retry_after_seconds(exc: BaseException) -> float:
    for error in _chain(exc):
        headers = getattr(getattr(error, "response", None), "headers", None)
        if headers is None:
            continue
        stated = _stated_retry_after(headers)
        if stated is not None:
            return stated
    return 0.0


def _stated_retry_after(headers: Any) -> float | None:
    for name, scale in (("retry-after-ms", 0.001), ("retry-after", 1.0)):
        try:
            stated = float(headers.get(name, "")) * scale
        except TypeError, ValueError:
            continue
        return min(max(stated, 0.0), RETRY_AFTER_CAP_SECONDS)
    return None


def scope_of_error(error: object) -> str:
    body = error.get("error", error) if isinstance(error, Mapping) else None
    if not isinstance(body, Mapping):
        return MODEL_SCOPE
    metadata = body.get("metadata")
    if isinstance(metadata, Mapping) and metadata.get("provider_name"):
        return MODEL_SCOPE
    return KEY_SCOPE if str(body.get("code")) == "429" else MODEL_SCOPE


def _body_of(error: BaseException) -> object:
    body = getattr(error, "body", None)  # the OpenAI SDK: the body's `error` object
    if isinstance(body, Mapping):
        return body
    response = getattr(error, "response", None)
    try:
        return response.json() if response is not None else None
    except Exception:  # noqa: BLE001 - an unread stream or a body that is not JSON
        return None


def rate_limit_scope(exc: BaseException) -> str:
    for error in _chain(exc):
        body = _body_of(error)
        if body is not None:
            return scope_of_error(body)
    return MODEL_SCOPE


def _backoff_before_retry(exc: BaseException) -> float:
    wait = retry_after_seconds(exc)
    return wait * (0.9 + 0.2 * random.random()) if wait else 0.0
