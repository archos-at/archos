from __future__ import annotations

import os
import signal
import subprocess
import sys
from collections.abc import MutableMapping

ROLES = ("chat", "api", "worker", "ingest-worker")

LEGACY_PREFIXES = ("GRID_", "AIQ_")

RENAMED = {
    "ROLE": "PROCESS_ROLE",
    "VERBOSE": "AGENT_VERBOSE",
    "LANGFUSE_TRACE_RETENTION_DAYS": "TRACE_RETENTION_DAYS",
    "PILOTI_ASK_MAX_SECONDS": "AGENT_ASK_MAX_SECONDS",
}

WARN = True


def current_name(legacy: str) -> str | None:
    for prefix in LEGACY_PREFIXES:
        rest = legacy.removeprefix(prefix)
        if rest != legacy and rest:
            return RENAMED.get(rest, rest)
    return None


def _warn(line: str) -> None:
    if WARN:
        print(line, file=sys.stderr, flush=True)


def adopt_legacy_names(environ: MutableMapping[str, str]) -> list[str]:
    adopted = []
    for prefix in LEGACY_PREFIXES:
        for legacy in sorted(name for name in environ if name.startswith(prefix)):
            name = current_name(legacy)
            if name is None:
                continue
            if name in environ:
                _warn(f"WARNING: {legacy} is deprecated and ignored, {name} is set")
                continue
            environ[name] = environ[legacy]
            adopted.append(name)
            _warn(f"WARNING: {legacy} is deprecated; rename it to {name}")
    return adopted


def _terminate_process(proc: subprocess.Popen[str] | None) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def main() -> int:
    adopt_legacy_names(os.environ)
    if len(sys.argv) > 1:
        os.execvp(sys.argv[1], sys.argv[1:])

    role = os.getenv("PROCESS_ROLE", "").strip().lower()
    if role not in ROLES:
        raise SystemExit(f"PROCESS_ROLE={role!r} is not a role of this image: set it to one of {', '.join(ROLES)}")
    if role == "worker":
        print("Starting DB-claimed research worker (PROCESS_ROLE=worker)...", flush=True)
        os.execvp("python", ["python", "-m", "agent_host.jobs.worker"])
    if role == "ingest-worker":
        print("Starting DB-claimed ingest worker (PROCESS_ROLE=ingest-worker)...", flush=True)
        os.execvp("python", ["python", "-m", "agent_host.jobs.ingest_worker"])

    config_file = os.getenv(
        "CONFIG_FILE",
        "/app/configs/config_oib_openrouter.yml",
    )
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))

    print("============================================", flush=True)
    print("Agent web tier", flush=True)
    print(f"Config: {config_file}", flush=True)
    print(f"API:    http://{host}:{port}", flush=True)
    print("============================================", flush=True)

    web_proc = subprocess.Popen(["python", "/app/apps/agent-host/start_web.py"])

    def _handle_web_signal(_signum: int, _frame: object) -> None:
        print("Shutting down...", flush=True)
        _terminate_process(web_proc)
        sys.exit(0)

    signal.signal(signal.SIGTERM, _handle_web_signal)
    signal.signal(signal.SIGINT, _handle_web_signal)
    return web_proc.wait()


if __name__ == "__main__":
    sys.exit(main())
