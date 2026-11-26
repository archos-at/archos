from __future__ import annotations

import json
import urllib.parse
from dataclasses import dataclass
from dataclasses import field
from typing import Any

import pytest

from agent.common import bff_http


@dataclass
class BffCall:
    url: str
    headers: dict[str, str]

    @property
    def path(self) -> str:
        return urllib.parse.urlsplit(self.url).path

    @property
    def query(self) -> dict[str, str]:
        return dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(self.url).query))


@dataclass
class FakeBff:
    payload: Any = None
    error: BaseException | None = None
    calls: list[BffCall] = field(default_factory=list)

    @property
    def n(self) -> int:
        return len(self.calls)


class _Answer:
    status = 200
    headers = {"Content-Type": "application/json"}

    def __init__(self, payload: Any) -> None:
        self._raw = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._raw

    def __enter__(self) -> _Answer:
        return self

    def __exit__(self, *_: object) -> bool:
        return False


def fake_bff(
    monkeypatch: pytest.MonkeyPatch,
    payload: Any = None,
    *,
    error: BaseException | None = None,
    token: str | None = None,
) -> FakeBff:
    if token is not None:
        monkeypatch.setenv(bff_http.INTERNAL_TOKEN_ENV, token)
    fake = FakeBff(payload, error)

    def _open(request, timeout):
        fake.calls.append(BffCall(request.full_url, {key.lower(): value for key, value in request.header_items()}))
        if fake.error is not None:
            raise fake.error
        return _Answer(fake.payload)

    monkeypatch.setattr(bff_http._opener, "open", _open)
    return fake
