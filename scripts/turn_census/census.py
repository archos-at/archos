from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

from local_fetcher import fetcher_env  # a sibling script, not a package

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CONFIG = ROOT / "configs" / "config_oib_openrouter.yml"
_TAIL_SECONDS = 20
_TIMEOUT_SECONDS = 600
TIMED_OUT = "census: timed out"


def timed_out(log_text: str) -> bool:
    return TIMED_OUT in log_text


def kind(entry: dict) -> str:
    path = entry["url"].split("openrouter.ai")[-1]
    req = entry.get("req") or {}
    if path.endswith("/decisions"):
        return "decision" if len(req.get("questions") or {}) > 2 else "verdict"
    if path.endswith("/responses"):
        return "research" if req.get("input") != "ping" else "probe"
    if path.endswith("/chat/completions"):
        return "aux-llm"
    return path.rsplit("/", 1)[-1]


def records(path: Path) -> list[dict]:
    if not path.exists():
        return []
    rows = []
    with path.open() as lines:
        for line in lines:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def ensure_key() -> bool:
    if not os.environ.get("OPENROUTER_API_KEY") and os.environ.get("OPENROUTER_KEY"):
        os.environ["OPENROUTER_API_KEY"] = os.environ["OPENROUTER_KEY"]
    return bool(os.environ.get("OPENROUTER_API_KEY"))


def summarize(path: Path) -> dict:
    rows = sorted(records(path), key=lambda r: r["t_start"])
    kinds: dict[str, dict] = {}
    research: list[dict] = []
    for row in rows:
        call = kind(row)
        usage = row.get("usage") or {}
        details = usage.get("prompt_tokens_details") or usage.get("input_tokens_details") or {}
        tokens_in = usage.get("prompt_tokens") or usage.get("input_tokens") or 0
        bucket = kinds.setdefault(call, {"calls": 0, "input": 0, "seconds": 0.0})
        bucket["calls"] += 1
        bucket["input"] += tokens_in
        bucket["seconds"] += row["t_end"] - row["t_start"]
        if call == "research":
            research.append({"input": tokens_in, "cached": details.get("cached_tokens") or 0})
    wall = max(row["t_end"] for row in rows) - rows[0]["t_start"] if rows else 0.0
    return {"kinds": kinds, "research": research, "wall_seconds": round(wall, 1)}


def _print(name: str, summary: dict) -> None:
    research = summary["research"]
    per_call = ", ".join(f"{r['input']}({r['cached']} cached)" for r in research)
    print(f"{name}: {len(research)} research call(s) [{per_call}]  wall {summary['wall_seconds']}s")
    for label, bucket in sorted(summary["kinds"].items()):
        print(f"    {label:10} {bucket['calls']:3} call(s)  {bucket['input']:7} in  {bucket['seconds']:5.1f}s")


_SHIM_LOCK = threading.Lock()


def run_stamp() -> str:
    return f"{time.strftime('%H%M%S')}-{os.getpid()}"


FRONTEND_PACKAGES = {"agent_host": "apps/agent-host/src/agent_host"}


def source_packages() -> dict[str, Path]:
    import tomllib

    packages: dict[str, Path] = {}
    members = tomllib.loads((ROOT / "pyproject.toml").read_text())["tool"]["uv"]["workspace"]["members"]
    for member in sorted(members):
        for init in sorted((ROOT / member / "src").glob("*/__init__.py")):
            if init.parent.name != "agent":
                packages[init.parent.name] = init.parent.resolve()
    for name, relative in FRONTEND_PACKAGES.items():
        packages[name] = (ROOT / relative).resolve()
    return packages


def tree_pythonpath(out: Path) -> str:
    import hashlib

    shim = out / f".tree-{hashlib.sha256(str(ROOT.resolve()).encode()).hexdigest()[:10]}"
    with _SHIM_LOCK:
        shim.mkdir(parents=True, exist_ok=True)
        for name, target in source_packages().items():
            link = shim / name
            if link.is_symlink() and link.resolve() == target:
                continue
            staged = shim / f".{name}.{os.getpid()}"
            staged.unlink(missing_ok=True)
            staged.symlink_to(target, target_is_directory=True)
            os.replace(staged, link)
    parts = [str(HERE), str(shim), str(ROOT / "packages" / "agent" / "src"), os.environ.get("PYTHONPATH", "")]
    return os.pathsep.join(part for part in parts if part)


def run_python() -> str:
    venv = ROOT / ".venv" / "bin" / "python"
    return str(venv) if venv.exists() else sys.executable


def run_once(
    question: str,
    out: Path,
    conversation_id: str,
    overrides: list[list[str]] | None = None,
    extra_env: dict[str, str] | None = None,
    name: str | None = None,
) -> Path:
    record = out / f"{name or conversation_id}.jsonl"
    log = out / f"{name or conversation_id}.log"
    record.unlink(missing_ok=True)
    env = {**os.environ, **fetcher_env(run_python(), ROOT), **(extra_env or {}), "REC_OUT": str(record)}
    env["PYTHONPATH"] = tree_pythonpath(out)
    nat = [run_python(), "-P", "-m", "nat.cli.main"]
    cmd = [*nat, "run", "--config_file", str(CONFIG), "--input", question, "--conversation_id", conversation_id]
    for key, value in overrides or []:
        cmd += ["--override", key, value]
    with log.open("w") as sink:
        proc = subprocess.Popen(cmd, cwd=ROOT, env=env, stdout=sink, stderr=subprocess.STDOUT, start_new_session=True)
        deadline = time.time() + _TIMEOUT_SECONDS
        answered = False
        while time.time() < deadline and proc.poll() is None:
            time.sleep(2)
            if "Workflow Result" in log.read_text(errors="replace"):
                answered = True
                time.sleep(_TAIL_SECONDS)
                break
        _stop(proc)
    if not answered and time.time() >= deadline:
        with log.open("a") as sink:
            sink.write(f"\n{TIMED_OUT} after {_TIMEOUT_SECONDS}s\n")
    return record


def _stop(proc: subprocess.Popen) -> None:
    import signal

    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Turn census: run one chat question through the real agent and count what it cost."
    )
    parser.add_argument("question", nargs="?")
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--out", type=Path, default=Path("/tmp/turn_census"))
    parser.add_argument("--report", type=Path, nargs="*", help="summarize recorded runs; no model calls")
    parser.add_argument(
        "--override",
        nargs=2,
        action="append",
        metavar=("KEY", "VALUE"),
        help="a config value for this census only, in `nat run` dot notation; repeatable",
    )
    args = parser.parse_args(argv)
    if args.report is not None:
        if not args.report:
            parser.error("--report needs the recordings to summarize")
        for path in args.report:
            _print(path.stem, summarize(path))
        return 0
    if not args.question:
        parser.error("a question, or --report")
    if not ensure_key():
        print("OPENROUTER_API_KEY is not set; a census needs the real models.", file=sys.stderr)
        return 2
    args.out.mkdir(parents=True, exist_ok=True)
    stamp = run_stamp()
    for index in range(args.runs):
        record = run_once(args.question, args.out, f"census-{stamp}-{index + 1}", args.override)
        _print(record.stem, summarize(record))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
