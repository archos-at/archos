"""A stdlib HTTP server a test starts in a thread is told to stop quickly.

``socketserver.BaseServer.serve_forever`` looks for a shutdown request once per
``poll_interval``, 0.5 s by default, and ``shutdown()`` blocks until it does. A
fixture that starts a server per test therefore sleeps half a second in every
teardown: 58 teardowns and 13 calls in the core suite on 2026-11-11, about 35
worker-seconds of waiting that no test needed.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

THREADED_SERVER = re.compile(r"target=[\w.]*\bserve_forever\b")

#: ``websockets.sync.server.serve`` has its own ``serve_forever``, which takes
#: no ``poll_interval`` and stops at once; this file quotes the slow form.
NOT_A_SERVER_START = frozenset({"tests/test_loop_eval.py", "tests/test_test_servers_stop_fast.py"})


def _python_files_starting_a_server() -> list[str]:
    found = subprocess.run(
        ["git", "grep", "-l", "--fixed-strings", "serve_forever", "--", "*.py"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    return [path for path in found.stdout.splitlines() if path not in NOT_A_SERVER_START]


def test_a_server_thread_polls_for_shutdown_faster_than_the_default() -> None:
    slow = [
        f"{path}:{number}"
        for path in _python_files_starting_a_server()
        for number, line in enumerate((ROOT / path).read_text(encoding="utf-8").splitlines(), start=1)
        if THREADED_SERVER.search(line) and "poll_interval" not in line
    ]

    assert not slow, (
        "serve_forever in a thread without a poll_interval makes every shutdown() wait up to 0.5 s: "
        'pass kwargs={"poll_interval": 0.01} to the Thread. ' + ", ".join(slow)
    )


def test_the_check_sees_a_default_poll() -> None:
    assert THREADED_SERVER.search("threading.Thread(target=self.httpd.serve_forever, daemon=True)")
    assert not THREADED_SERVER.search("server.serve_forever()")
