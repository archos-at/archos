"""A trial parse in a child, because a crash in C cannot be caught in this process.

``ifcopenshell.open`` dies on input no byte check sees coming, and when it runs
in the host it takes every conversation there with it. So the child goes first,
and only a child killed by the parser's own fault counts against the file: a
Python exception leaves the verdict to the real open, and a SIGKILL or SIGTERM
came from outside (the OOM killer, a shutdown) and says nothing about the bytes.

The child gets an empty environment, since it reads an upload and needs no secret.
"""

from __future__ import annotations

import logging
import resource
import signal
import subprocess
import sys
import threading

logger = logging.getLogger(__name__)

PARSER_CRASH_REASON = (
    "Diese Datei ist beschädigt: Sie bringt den IFC-Parser zum Absturz und wird deshalb nicht "
    "geöffnet. Das Modell bitte neu exportieren."
)

_CRASH_SIGNALS = frozenset({signal.SIGSEGV, signal.SIGBUS, signal.SIGABRT, signal.SIGILL, signal.SIGFPE})

# The thread is for its stack size. The host has frames of its own above the parser, so
# on an equal stack a file can fit here and overflow there: nesting of 55184 to 55205
# levels passed a probe on a default thread and killed the host with exit -10. Hence
# half of the smaller stack the host can open on, its main thread or a worker thread.
_OPEN_ON_A_SMALLER_STACK = """
import sys, threading, ifcopenshell
threading.stack_size(int(sys.argv[2]))
opener = threading.Thread(target=ifcopenshell.open, args=(sys.argv[1],))
opener.start()
opener.join()
"""

# glibc gives a thread the soft RLIMIT_STACK, or 2 MiB when that is unlimited;
# CPython on macOS gives its threads 16 MiB whatever the limit. The result is rounded
# down to 64 KiB because macOS refuses a stack that is not whole pages, and kept at
# 64 KiB at least because a stack size of 0 means the default stack.
_GLIBC_THREAD_STACK_WHEN_UNLIMITED = 2 * 1024 * 1024
_CPYTHON_THREAD_STACK_ON_MACOS = 16 * 1024 * 1024


def _probe_stack_size() -> int:
    soft, _ = resource.getrlimit(resource.RLIMIT_STACK)
    main = _GLIBC_THREAD_STACK_WHEN_UNLIMITED if soft == resource.RLIM_INFINITY else soft
    worker = threading.stack_size() or (_CPYTHON_THREAD_STACK_ON_MACOS if sys.platform == "darwin" else main)
    return max(min(main, worker) // 2 & ~0xFFFF, 64 * 1024)


def crashes_the_parser(path: str) -> bool:
    try:
        child = subprocess.run(
            [sys.executable, "-I", "-c", _OPEN_ON_A_SMALLER_STACK, path, str(_probe_stack_size())],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env={},
            check=False,
        )
    except OSError as error:
        logger.warning("IFC crash probe could not start: %s", type(error).__name__)
        return False
    if child.returncode != 0:
        logger.warning("IFC crash probe exited with %d", child.returncode)
    return -child.returncode in _CRASH_SIGNALS
