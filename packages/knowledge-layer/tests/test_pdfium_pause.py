from __future__ import annotations

import threading
import time

from knowledge_layer.ingest import pdfium_lock
from knowledge_layer.ingest import pdfium_pause


def test_a_long_read_hands_the_lock_to_a_waiting_caller_between_chunks() -> None:
    order: list[str] = []
    started = threading.Event()

    def long_read() -> None:
        with pdfium_lock():
            started.set()
            for _ in range(200):
                time.sleep(0.005)
                pdfium_pause()
            order.append("read")

    def look() -> None:
        started.wait()
        with pdfium_lock():
            order.append("look")

    threads = [threading.Thread(target=long_read), threading.Thread(target=look)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=10)

    assert order == ["look", "read"]


def test_a_pause_with_nobody_waiting_keeps_the_lock() -> None:
    with pdfium_lock():
        pdfium_pause()
        with pdfium_lock():
            pass
