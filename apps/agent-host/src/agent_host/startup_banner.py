from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

UNKNOWN_SHA = "unknown"


def deployed_sha(env: dict[str, str] | None = None) -> str:
    source = os.environ if env is None else env
    return (source.get("GIT_SHA") or "").strip() or UNKNOWN_SHA


def flag_source(env: dict[str, str] | None = None) -> str:
    source = os.environ if env is None else env
    return "workos" if (source.get("REQUIRE_AUTH") or "").lower() == "true" else "defaults"


def format_boot_line(sha: str, flags: str) -> str:
    return f"[boot] sha={sha} flags={flags}"


def boot_line(env: dict[str, str] | None = None) -> str:
    return format_boot_line(deployed_sha(env), flag_source(env))


def log_boot_line() -> str:
    line = boot_line()
    logger.info("%s", line)
    return line
