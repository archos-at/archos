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

# Nesting of 55184 to 55205 levels passed a probe on a default thread stack and killed the host (exit -10); the probe thread gets half the host's smaller stack.
_OPEN_ON_A_SMALLER_STACK = """
import sys, threading, ifcopenshell
threading.stack_size(int(sys.argv[2]))
opener = threading.Thread(target=ifcopenshell.open, args=(sys.argv[1],))
opener.start()
opener.join()
"""

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
