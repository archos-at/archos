import contextlib
import logging
import os

logger = logging.getLogger(__name__)


def _rss_mib() -> float | None:
    try:
        with open("/proc/self/statm", encoding="ascii") as statm:
            resident_pages = int(statm.read().split()[1])
        page_size = os.sysconf("SC_PAGE_SIZE")
    except OSError, ValueError, IndexError, AttributeError:
        return None
    return resident_pages * page_size / (1024 * 1024)


def _log_memory(stage: str) -> None:
    rss = _rss_mib()
    if rss is None:
        return
    logger.info("[ingest-mem] %s rss=%.0fMiB", stage, rss)


def _release_memory(file_name: str) -> None:
    import ctypes
    import gc

    gc.collect()
    with contextlib.suppress(OSError, AttributeError):
        ctypes.CDLL("libc.so.6").malloc_trim(0)
    _log_memory(f"file:released {file_name}")
