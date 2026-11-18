from __future__ import annotations

import asyncio
import base64
import logging
from dataclasses import dataclass
from dataclasses import field
from typing import Any

import httpx

logger = logging.getLogger(__name__)

RUN_PATH = "/run"

WORKSPACE = "/workspace/"

BUSY_RETRIES = 3

BUSY_BACKOFF_S = 0.5


@dataclass(frozen=True)
class RunResult:
    status: str
    value: Any = None
    stdout: str = ""
    stderr: str = ""
    files: dict[str, bytes] = field(default_factory=dict)
    duration_ms: int = 0


class RunnerUnavailable(Exception):
    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


def _payload(source: str, language: str, files: dict[str, bytes], timeout_ms: int) -> dict[str, Any]:
    return {
        "source": source,
        "language": language,
        "files": [{"path": path, "base64": base64.b64encode(data).decode("ascii")} for path, data in files.items()],
        "timeoutMs": timeout_ms,
    }


def _result(body: dict[str, Any]) -> RunResult:
    files = {
        str(entry["path"]): base64.b64decode(str(entry.get("base64") or ""))
        for entry in body.get("files") or []
        if isinstance(entry, dict) and str(entry.get("path", "")).startswith(WORKSPACE)
    }
    return RunResult(
        status=str(body.get("status") or "error"),
        value=body.get("value"),
        stdout=str(body.get("stdout") or ""),
        stderr=str(body.get("stderr") or ""),
        files=files,
        duration_ms=int(body.get("durationMs") or 0),
    )


def _refusal(response: httpx.Response) -> RunResult:
    is_json = response.headers.get("content-type", "").startswith("application/json")
    detail = response.json().get("error") if is_json else ""
    return RunResult(status="error", stderr=f"The runner refused the run: {detail or 'bad request'}")


async def _post(client: httpx.AsyncClient, url: str, payload: dict[str, Any]) -> httpx.Response:
    try:
        return await client.post(url, json=payload)
    except httpx.HTTPError as exc:
        raise RunnerUnavailable("the code runner could not be reached", "unreachable") from exc


def _answer(response: httpx.Response) -> RunResult:
    if response.status_code == 400:
        return _refusal(response)
    if response.status_code != 200:
        logger.warning("Code runner answered %s", response.status_code)
        raise RunnerUnavailable(f"the code runner answered {response.status_code}", "http_error")
    return _result(response.json())


async def _post_until_free(client: httpx.AsyncClient, url: str, payload: dict[str, Any]) -> httpx.Response:
    response = await _post(client, url, payload)
    for attempt in range(BUSY_RETRIES):
        if response.status_code != 503:
            return response
        await asyncio.sleep(BUSY_BACKOFF_S * (attempt + 1))
        response = await _post(client, url, payload)
    return response


async def run_code(
    runner_url: str, source: str, *, language: str, files: dict[str, bytes], timeout_ms: int
) -> RunResult:
    payload = _payload(source, language, files, timeout_ms)
    async with httpx.AsyncClient(timeout=timeout_ms / 1000 + 30) as client:
        response = await _post_until_free(client, f"{runner_url.rstrip('/')}{RUN_PATH}", payload)
    if response.status_code == 503:
        raise RunnerUnavailable("the code runner is busy", "busy")
    return _answer(response)
