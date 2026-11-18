import argparse
import json
import os
import subprocess
import sys
from collections.abc import Sequence
from pathlib import Path

OUT_PATH = (
    Path(__file__).resolve().parent.parent / "deploy" / "pulumi" / "src" / "config" / "provider-limits.generated.ts"
)

PROBE_OFFSET = 7

READERS: tuple[tuple[str, str, str], ...] = (
    (
        "VLM_FLEET_CONCURRENCY",
        "from knowledge_layer.ingest import VLM_FLEET_CONCURRENCY as value",
        "`VLM_FLEET_CONCURRENCY` in `packages/knowledge-layer/src/knowledge_layer/ingest/vision_calls.py`",
    ),
    (
        "INGEST_PAGE_READ_PARALLELISM",
        "from knowledge_layer.ingest import INGEST_PAGE_READ_PARALLELISM as value",
        "`INGEST_PAGE_READ_PARALLELISM` in `packages/knowledge-layer/src/knowledge_layer/ingest/page_reads.py`",
    ),
    (
        "PROVIDER_LIMIT_CEILING",
        "from agent.common.provider_limiter import limit_ceiling\nvalue = limit_ceiling()",
        "`limit_ceiling()` in `packages/agent/src/agent/common/provider_limiter.py`",
    ),
    (
        "PROVIDER_MODEL_LIMIT_CEILING",
        "from agent.common.provider_limiter import model_limit_ceiling\nvalue = model_limit_ceiling()",
        "`model_limit_ceiling()` in `packages/agent/src/agent/common/provider_limiter.py`",
    ),
)


def _read_with(variable: str, value: str | None, statement: str) -> int:
    env = {name: setting for name, setting in os.environ.items() if name != variable}
    if value is not None:
        env[variable] = value
    child = subprocess.run(
        [sys.executable, "-c", f"{statement}\nprint(value)"], env=env, capture_output=True, text=True, check=False
    )
    if child.returncode != 0:
        raise SystemExit(f"Reading {variable} failed:\n{child.stderr}")
    return int(child.stdout.strip())


def defaults() -> dict[str, int]:
    found: dict[str, int] = {}
    for variable, statement, where in READERS:
        default = _read_with(variable, None, statement)
        probe = default + PROBE_OFFSET
        if _read_with(variable, str(probe), statement) != probe:
            raise SystemExit(f"{where} no longer takes its value from {variable}: the deploy sets that variable.")
        found[variable] = default
    return found


def render(values: dict[str, int]) -> str:
    sources = "; ".join(where for _, _, where in READERS)
    return (
        "// AUTO-GENERATED from the Python sources named below — do not edit; "
        "run `uv run python scripts/generate_provider_limits.py`\n\n"
        "/** Each provider limit the Python modules read from the environment, by the variable the deploy sets, "
        f"with the value they take when it sets none: {sources}. */\n"
        f"export const PROVIDER_LIMIT_DEFAULTS = {json.dumps(values)} as const\n"
    )


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=f"Regenerate {OUT_PATH.relative_to(OUT_PATH.parents[4])} from the Python modules that read "
        "the provider limits."
    )
    parser.parse_args(argv)
    OUT_PATH.write_text(render(defaults()), encoding="utf-8", newline="\n")
    print(f"Wrote the provider limits to {OUT_PATH}")


if __name__ == "__main__":
    main()
