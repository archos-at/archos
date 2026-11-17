from __future__ import annotations

import atexit
import os
import socket
import subprocess
import time
from pathlib import Path

import httpx

ENV_FETCHER_URL = "PUBLIC_SOURCE_FETCHER_URL"
START_TIMEOUT_SECONDS = 30.0

_started: dict[str, str] = {}


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def _wait_until_up(url: str, process: subprocess.Popen) -> None:
    deadline = time.monotonic() + START_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"the local public-source fetcher exited with status {process.returncode}")
        try:
            if httpx.get(f"{url}/healthz", timeout=1, trust_env=False).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.2)
    process.terminate()
    raise RuntimeError(f"the local public-source fetcher did not answer within {START_TIMEOUT_SECONDS:g} seconds")


def fetcher_env(python: str, root: Path) -> dict[str, str]:
    if os.environ.get(ENV_FETCHER_URL, "").strip() or _started:
        return dict(_started)
    port = _free_port()
    env = {key: os.environ[key] for key in ("PATH", "LANG", "LC_ALL", "HOME") if key in os.environ}
    env |= {"PORT": str(port), "PUBLIC_SOURCES_DIR": str(root / "configs" / "sources")}
    process = subprocess.Popen(  # noqa: S603 - this checkout's interpreter and module
        [python, "-m", "public_sources.fetcher"],
        cwd=root,
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    atexit.register(process.terminate)
    url = f"http://127.0.0.1:{port}"
    _wait_until_up(url, process)
    _started[ENV_FETCHER_URL] = url
    return dict(_started)
