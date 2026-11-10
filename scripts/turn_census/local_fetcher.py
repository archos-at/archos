"""A public-source fetcher for an eval that runs the agent on a machine with none.

Every backend role reads a public source, and parses a public PDF, only through
the fetcher (``PUBLIC_SOURCE_FETCHER_URL``, ADR-0162 amendment); without it
every law lookup is refused. The census and the answer suite run the agent in
processes of their own, with no deployment around them, so the first run
starts one here: ``python -m public_sources.fetcher`` on a free local port,
with this checkout's records and nothing of the caller's environment. It stops
when the eval exits. A machine that already names a fetcher keeps it.
"""

from __future__ import annotations

import atexit
import os
import socket
import subprocess
import time
import urllib.request
from pathlib import Path

ENV_FETCHER_URL = "PUBLIC_SOURCE_FETCHER_URL"
#: How long the fetcher may take to answer its health check.
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
            with urllib.request.urlopen(f"{url}/healthz", timeout=1):  # noqa: S310 - our own local listener
                return
        except OSError:
            time.sleep(0.2)
    process.terminate()
    raise RuntimeError(f"the local public-source fetcher did not answer within {START_TIMEOUT_SECONDS:g} seconds")


def fetcher_env(python: str, root: Path) -> dict[str, str]:
    """``{PUBLIC_SOURCE_FETCHER_URL: …}`` for a run: the configured fetcher, else one started here once."""
    if os.environ.get(ENV_FETCHER_URL, "").strip() or _started:
        return dict(_started)
    port = _free_port()
    # Its own environment: the fetcher holds no secret, here as in the cluster.
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
