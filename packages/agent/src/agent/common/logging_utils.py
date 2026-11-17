"""Targeted quieting of known-noisy dependency loggers."""

import logging

_NOISY_DEPENDENCY_LOGGERS = ("nat.builder.intermediate_step_manager", "nat.builder.function_info", "pdfminer")


def suppress_noisy_dependency_logs() -> None:
    """Raise known-noisy dependency loggers to ERROR.

    Idempotent; call once at process startup (API server, research worker
    and ingest worker).
    """
    for name in _NOISY_DEPENDENCY_LOGGERS:
        logging.getLogger(name).setLevel(logging.ERROR)
