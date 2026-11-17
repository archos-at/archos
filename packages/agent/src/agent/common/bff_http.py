from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

INTERNAL_URL_ENV = "FRONTEND_INTERNAL_URL"
FALLBACK_URL_ENV = "FRONTEND_URL"
DEFAULT_BASE_URL = "http://frontend:3000"

INTERNAL_TOKEN_ENV = "INTERNAL_API_TOKEN"
INTERNAL_TOKEN_HEADER = "X-Internal-Token"
REQUEST_CONTEXT_HEADER = "X-Request-Context"
REQUEST_CONTEXT_SIGNATURE_HEADER = "X-Request-Context-Sig"


def internal_base_url() -> str:
    url = os.environ.get(INTERNAL_URL_ENV) or os.environ.get(FALLBACK_URL_ENV) or DEFAULT_BASE_URL
    return url.rstrip("/")


def internal_token() -> str | None:
    return os.environ.get(INTERNAL_TOKEN_ENV) or None


class BffError(RuntimeError):

    def __init__(self, message: str, *, status: int | None = None, code: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


class BffNotConfiguredError(BffError):
    ...


class BffUnreachableError(BffError):
    ...


class BffMalformedResponseError(BffError):
    ...


class BffRefusedError(BffError):

    def __init__(self, message: str, *, status: int, body: dict[str, Any]) -> None:
        code = body.get("code")
        super().__init__(message, status=status, code=code if isinstance(code, str) else None)
        self.status: int = status
        self.body = body

    @property
    def error_text(self) -> str | None:
        error = self.body.get("error")
        return error if isinstance(error, str) and error.strip() else None


@dataclass(frozen=True)
class SignedEnvelope:

    header: str
    signature: str

    def headers(self) -> dict[str, str]:
        return {REQUEST_CONTEXT_HEADER: self.header, REQUEST_CONTEXT_SIGNATURE_HEADER: self.signature}


@dataclass(frozen=True)
class BffResponse:

    status: int
    content_type: str
    body: bytes
    server_timing: str = ""

    def json(self) -> Any:
        try:
            return json.loads(self.body.decode("utf-8"))
        except (ValueError, UnicodeDecodeError) as exc:
            raise BffMalformedResponseError(
                "the BFF answered with a body that is not JSON", status=self.status
            ) from exc


class _RefuseRedirects(urllib.request.HTTPRedirectHandler):

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001, ARG002
        raise urllib.error.HTTPError(req.full_url, code, "unexpected redirect from an internal route", headers, fp)


def _build_opener() -> urllib.request.OpenerDirector:
    opener = urllib.request.OpenerDirector()
    for handler in (
        urllib.request.HTTPHandler,
        urllib.request.HTTPSHandler,
        _RefuseRedirects,
        urllib.request.HTTPDefaultErrorHandler,
        urllib.request.HTTPErrorProcessor,
        urllib.request.UnknownHandler,
    ):
        opener.add_handler(handler())
    return opener


_opener = _build_opener()


def _error_envelope(exc: urllib.error.HTTPError) -> dict[str, Any]:
    try:
        raw = exc.read()
        payload = json.loads(raw.decode("utf-8", errors="replace")) if raw else None
    except Exception:  # noqa: BLE001 - the body may be empty, consumed, unreadable or not JSON
        return {}
    return payload if isinstance(payload, dict) else {}


def send(
    method: str,
    path: str,
    *,
    timeout: float,
    body: Any = None,
    query: Mapping[str, str] | None = None,
    headers: Mapping[str, str] | None = None,
) -> BffResponse:
    token = internal_token()
    if not token:
        raise BffNotConfiguredError(f"{INTERNAL_TOKEN_ENV} is not configured")
    url = f"{internal_base_url()}{path}"
    if query:
        url = f"{url}?{urllib.parse.urlencode(query)}"
    sent: dict[str, str] = {"Content-Type": "application/json"} if body is not None else {}
    sent.update(headers or {})
    sent[INTERNAL_TOKEN_HEADER] = token
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    request = urllib.request.Request(url, data=data, headers=sent, method=method)
    try:
        with _opener.open(request, timeout=timeout) as response:
            raw = response.read()
            status = getattr(response, "status", None)
            response_headers = getattr(response, "headers", None)
            content_type = response_headers.get("Content-Type", "") if response_headers is not None else ""
            server_timing = response_headers.get("Server-Timing", "") if response_headers is not None else ""
    except urllib.error.HTTPError as exc:
        raise BffRefusedError(
            f"{path} refused the call ({exc.code})", status=exc.code, body=_error_envelope(exc)
        ) from exc
    except Exception as exc:  # noqa: BLE001 - urllib raises a wide family; every one means "no answer"
        raise BffUnreachableError(f"{path} could not be reached ({type(exc).__name__})") from exc
    status = status if isinstance(status, int) else 200
    if not 200 <= status < 300:
        raise BffRefusedError(f"{path} refused the call ({status})", status=status, body={})
    return BffResponse(
        status=status,
        content_type=content_type if isinstance(content_type, str) else "",
        body=raw if isinstance(raw, bytes) else b"",
        server_timing=server_timing if isinstance(server_timing, str) else "",
    )


def request_json(
    method: str,
    path: str,
    *,
    timeout: float,
    body: Any = None,
    query: Mapping[str, str] | None = None,
    headers: Mapping[str, str] | None = None,
) -> Any:
    return send(method, path, timeout=timeout, body=body, query=query, headers=headers).json()


def get_json(
    path: str, *, timeout: float, query: Mapping[str, str] | None = None, headers: Mapping[str, str] | None = None
) -> Any:
    return request_json("GET", path, timeout=timeout, query=query, headers=headers)


def post_json(path: str, body: Any, *, timeout: float, headers: Mapping[str, str] | None = None) -> Any:
    return request_json("POST", path, timeout=timeout, body=body, headers=headers)
