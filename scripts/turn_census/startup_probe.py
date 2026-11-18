from __future__ import annotations

import argparse
import asyncio
import functools
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

import httpx

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from census import ensure_key  # noqa: E402
from census import run_python  # noqa: E402
from census import tree_pythonpath  # noqa: E402

CONFIG = HERE.parent.parent / "configs" / "config_oib_openrouter.yml"
_IN_TREE = "STARTUP_PROBE_IN_TREE"

_T0: list[float | None] = [None]


def _ms(start: float) -> tuple[float, float]:
    origin = _T0[0] or start
    return 1000 * (start - origin), 1000 * (time.perf_counter() - start)


def _patch_http() -> None:
    send = httpx.AsyncClient.send

    async def timed_send(self: httpx.AsyncClient, request: httpx.Request, *args: Any, **kwargs: Any) -> Any:
        start = time.perf_counter()
        try:
            return await send(self, request, *args, **kwargs)
        finally:
            if _T0[0] is not None:
                at, took = _ms(start)
                print(f"HTTP {at:7.0f}ms +{took:5.0f}ms {request.url.host}{request.url.path}", file=sys.stderr)

    httpx.AsyncClient.send = timed_send  # type: ignore[method-assign]


def _patch_retriever() -> None:
    from knowledge_layer.search import LlamaIndexRetriever

    retriever = LlamaIndexRetriever

    def timed(phase: str, method: Any) -> Any:
        @functools.wraps(method)
        def wrapper(self: Any, *args: Any, **kwargs: Any) -> Any:
            start = time.perf_counter()
            try:
                return method(self, *args, **kwargs)
            finally:
                if _T0[0] is not None:
                    at, took = _ms(start)
                    query = str(args[0] if args else kwargs.get("query", ""))[:40]
                    print(f"SYNC {phase:8s} {at:7.0f}ms +{took:5.0f}ms {query!r}", file=sys.stderr)

        return wrapper

    retriever._retrieve_sync = timed("retrieve", retriever._retrieve_sync)
    retriever._embed_query_cached = timed("embed", retriever._embed_query_cached)
    retriever._qdrant_chunks = timed("store", retriever._qdrant_chunks)


async def _run(config: Path, questions: list[str]) -> None:
    from nat.runtime.loader import load_workflow

    async with load_workflow(str(config)) as session_manager:
        for question in questions:
            async with session_manager.session() as session:
                _T0[0] = time.perf_counter()
                print(f"TURN START {question}", file=sys.stderr)
                async with session.run(question) as runner:
                    async for _ in runner.result_stream():
                        pass
                print(f"TURN END {1000 * (time.perf_counter() - _T0[0]):.0f}ms", file=sys.stderr)
                _T0[0] = None


def _in_tree(argv: list[str]) -> None:
    if os.environ.get(_IN_TREE):
        return
    env = {key: value for key, value in os.environ.items() if key != "REC_OUT"}
    env["PYTHONPATH"] = tree_pythonpath(Path(tempfile.gettempdir()) / "startup_probe")
    env[_IN_TREE] = "1"
    python = run_python()
    os.execve(python, [python, str(Path(__file__).resolve()), *argv], env)


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    _in_tree(argv)
    parser = argparse.ArgumentParser(
        description="Startup probe: what a chat turn does before its first model call, in milliseconds."
    )
    parser.add_argument("questions", nargs="+", help="asked in order, in one process")
    parser.add_argument("--config", type=Path, default=CONFIG)
    args = parser.parse_args(argv)
    if not ensure_key():
        print("OPENROUTER_API_KEY is not set; the probe needs the real models.", file=sys.stderr)
        return 2
    _patch_http()
    _patch_retriever()
    asyncio.run(_run(args.config, args.questions))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
