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
import signal
import subprocess
import sys

logger = logging.getLogger(__name__)

PARSER_CRASH_REASON = (
    "Diese Datei ist beschädigt: Sie bringt den IFC-Parser zum Absturz und wird deshalb nicht "
    "geöffnet. Das Modell bitte neu exportieren."
)

_CRASH_SIGNALS = frozenset({signal.SIGSEGV, signal.SIGBUS, signal.SIGABRT, signal.SIGILL, signal.SIGFPE})

# The thread is for its stack size. The host opens on a thread too, 16 MiB on macOS and
# usually 8 on Linux, with frames of its own above the parser, so on an equal stack a
# file can fit here and overflow there: nesting of 55184 to 55205 levels passed a probe
# on a default thread and killed the host with exit -10.
_OPEN_ON_A_SMALLER_STACK = """
import sys, threading, ifcopenshell
threading.stack_size(4 * 1024 * 1024)
opener = threading.Thread(target=ifcopenshell.open, args=(sys.argv[1],))
opener.start()
opener.join()
"""


def crashes_the_parser(path: str) -> bool:
    try:
        child = subprocess.run(
            [sys.executable, "-I", "-c", _OPEN_ON_A_SMALLER_STACK, path],
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
