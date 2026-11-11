"""A stdlib HTTP server a test starts in a thread is told to stop quickly.

``socketserver.BaseServer.serve_forever`` looks for a shutdown request once per
``poll_interval``, 0.5 s by default, and ``shutdown()`` blocks until it does. A
fixture that starts a server per test therefore sleeps half a second in every
teardown: 58 teardowns and 13 calls in the core suite on 2026-11-11, about 35
worker-seconds of waiting that no test needed.
"""

from __future__ import annotations

import ast
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

#: ``websockets.sync.server.serve`` has its own ``serve_forever``, which takes
#: no ``poll_interval`` and stops at once.
NOT_SOCKETSERVER = frozenset({"tests/test_loop_eval.py"})


def slow_server_threads(source: str) -> list[int]:
    """The lines of calls that hand ``serve_forever`` to a thread without a ``poll_interval``."""
    lines = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        keywords = {keyword.arg: keyword.value for keyword in node.keywords}
        target = keywords.get("target")
        if not (isinstance(target, ast.Attribute) and target.attr == "serve_forever"):
            continue
        if "poll_interval" not in ast.dump(keywords.get("kwargs", ast.Constant(None))):
            lines.append(node.lineno)
    return lines


def _python_files_naming_serve_forever() -> list[str]:
    found = subprocess.run(
        ["git", "grep", "-l", "--fixed-strings", "serve_forever", "--", "*.py"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    return [path for path in found.stdout.splitlines() if path not in NOT_SOCKETSERVER]


def test_a_server_thread_polls_for_shutdown_faster_than_the_default() -> None:
    slow = [
        f"{path}:{line}"
        for path in _python_files_naming_serve_forever()
        for line in slow_server_threads((ROOT / path).read_text(encoding="utf-8"))
    ]

    assert not slow, (
        "serve_forever in a thread without a poll_interval makes every shutdown() wait up to 0.5 s: "
        'pass kwargs={"poll_interval": 0.01} to the Thread. ' + ", ".join(slow)
    )


def test_the_check_reads_the_whole_call() -> None:
    assert slow_server_threads("Thread(target=self.httpd.serve_forever, daemon=True)") == [1]
    assert slow_server_threads('Thread(\n    target=s.serve_forever,\n    kwargs={"poll_interval": 0.01},\n)') == []
    assert slow_server_threads("server.serve_forever()") == []
