"""Every registered tool as the model is shown it, built offline from the deployment config.

The workflow builder runs in a subprocess: plugin discovery registers every
entry point process-wide, and a test process must not keep that state. One
build per test process (``built_tools`` is cached); about 13 s.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]

BUILD_ALL = r"""
import asyncio, json, os
from pathlib import Path
os.environ.setdefault("OPENROUTER_API_KEY", "schema-generation-only")
from nat.builder.workflow_builder import WorkflowBuilder
from nat.data_models.config import Config
from nat.runtime.loader import PluginTypes, discover_and_register_plugins
from nat.utils.io.yaml_tools import yaml_load

discover_and_register_plugins(PluginTypes.ALL)
raw = yaml_load(Path("configs/config_oib_openrouter.yml"))


async def main():
    out = {}
    cfg = Config(
        llms=raw.get("llms", {}),
        embedders=raw.get("embedders", {}),
        functions=raw["functions"],
        function_groups=raw.get("function_groups", {}),
    )
    async with WorkflowBuilder() as builder:
        for name, c in cfg.llms.items():
            await builder.add_llm(name, c)
        for name, c in cfg.embedders.items():
            await builder.add_embedder(name, c)
        for name, c in cfg.function_groups.items():
            group = await builder.add_function_group(name, c)
            for key, fn in (await group.get_all_functions()).items():
                out[key] = [fn.description, fn.input_schema.model_json_schema()]
        for name, c in cfg.functions.items():
            fn = await builder.add_function(name, c)
            out[name] = [fn.description, fn.input_schema.model_json_schema()]
    print("@@" + json.dumps(out))


asyncio.run(main())
"""


@lru_cache(maxsize=1)
def built_tools() -> dict[str, tuple[str, dict]]:
    """``{name: (description, input JSON schema)}`` for every function and group member the config registers."""
    src = ROOT / "packages" / "agent" / "src"
    env = {**os.environ, "PYTHONPATH": f"{src}{os.pathsep}{ROOT}"}
    done = subprocess.run(
        [sys.executable, "-c", BUILD_ALL], cwd=ROOT, env=env, capture_output=True, text=True, check=False
    )
    assert done.returncode == 0, done.stderr[-3000:]
    line = next(row for row in done.stdout.splitlines() if row.startswith("@@"))
    return {name: (description or "", schema) for name, (description, schema) in json.loads(line[2:]).items()}
