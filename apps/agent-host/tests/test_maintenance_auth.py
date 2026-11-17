from __future__ import annotations

import pytest
from fastapi import HTTPException

from agent_host.routes.maintenance import _DEV_DEFAULT_TOKEN
from agent_host.routes.maintenance import _require_internal_token


class _Req:
    def __init__(self, token: str | None) -> None:
        self.headers = {} if token is None else {"x-internal-token": token}


def test_rejects_when_token_env_unset(monkeypatch):
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    with pytest.raises(HTTPException) as exc:
        _require_internal_token(_Req("anything"))
    assert exc.value.status_code == 403


def test_rejects_dev_default_outside_dev(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", _DEV_DEFAULT_TOKEN)
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(HTTPException) as exc:
        _require_internal_token(_Req(_DEV_DEFAULT_TOKEN))
    assert exc.value.status_code == 503


def test_rejects_wrong_header(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "real-secret")
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(HTTPException) as exc:
        _require_internal_token(_Req("wrong"))
    assert exc.value.status_code == 403


def test_rejects_missing_header(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "real-secret")
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(HTTPException) as exc:
        _require_internal_token(_Req(None))
    assert exc.value.status_code == 403


def test_accepts_correct_token(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "real-secret")
    monkeypatch.setenv("APP_ENV", "production")
    _require_internal_token(_Req("real-secret"))


def test_accepts_dev_default_in_dev(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", _DEV_DEFAULT_TOKEN)
    monkeypatch.setenv("APP_ENV", "development")
    _require_internal_token(_Req(_DEV_DEFAULT_TOKEN))


class _HeaderReq:
    def __init__(self, name: str, token: str) -> None:
        self.headers = {name: token}


def test_accepts_the_header_every_caller_actually_sends(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "real-secret")
    monkeypatch.setenv("APP_ENV", "production")
    _require_internal_token(_HeaderReq("x-grid-internal-token", "real-secret"))


def test_still_accepts_the_legacy_spelling(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "real-secret")
    monkeypatch.setenv("APP_ENV", "production")
    _require_internal_token(_HeaderReq("x-internal-token", "real-secret"))


def test_a_wrong_token_in_either_spelling_is_still_refused(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "real-secret")
    monkeypatch.setenv("APP_ENV", "production")
    for name in ("x-grid-internal-token", "x-internal-token"):
        with pytest.raises(HTTPException) as exc:
            _require_internal_token(_HeaderReq(name, "wrong"))
        assert exc.value.status_code == 403
