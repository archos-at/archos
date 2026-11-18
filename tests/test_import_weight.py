from __future__ import annotations

import importlib
import json
import os
import pkgutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

LAZY_PACKAGES = [
    "agent",
    "agent.agents",
    "agent.core",
    "agent.agents.deep_researcher",
    "agent.common",
    "knowledge_layer",
    "knowledge_layer.browse",
    "knowledge_layer.estate",
    "knowledge_layer.ingest",
    "knowledge_layer.read_passage",
    "knowledge_layer.search",
    "knowledge_layer.vector_store",
]

HEAVY = ["langchain_core", "langgraph", "nat", "qdrant_client", "llama_index", "openai", "agent.common"]


def _loaded_by(statement: str) -> list[str]:
    script = (
        "import json, sys\n"
        "before = set(sys.modules)\n"
        f"{statement}\n"
        "print(json.dumps(sorted(set(sys.modules) - before)))\n"
    )
    env = {**os.environ, "PYTHONPATH": os.pathsep.join(entry for entry in sys.path if entry)}
    done = subprocess.run(
        [sys.executable, "-c", script], cwd=ROOT, env=env, capture_output=True, text=True, check=True, timeout=120
    )
    return json.loads(done.stdout.strip().splitlines()[-1])


def _heavy(loaded: list[str]) -> list[str]:
    return sorted({top for top in HEAVY for name in loaded if name == top or name.startswith(f"{top}.")})


@pytest.mark.parametrize("package", LAZY_PACKAGES)
def test_a_lazy_package_loads_none_of_its_submodules(package):
    loaded = _loaded_by(f"import {package}")
    own = [name for name in loaded if name.startswith(f"{package}.")]

    assert own in ([], ["agent.lazy_exports"]), f"{package}/__init__.py imports {own}"
    assert _heavy([name for name in loaded if not name.startswith(package)]) == []


@pytest.mark.parametrize("package", LAZY_PACKAGES)
def test_a_lazy_package_exports_no_name_a_submodule_has(package):
    module = importlib.import_module(package)
    submodules = {info.name for info in pkgutil.iter_modules(module.__path__)}

    assert set(getattr(module, "__all__", ())) & submodules == set()


@pytest.mark.parametrize("conftest", ["tests/conftest.py", "apps/agent-host/tests/conftest.py"], ids=["core", "api"])
def test_a_conftest_every_test_loads_loads_nothing_heavy(conftest):
    loaded = _loaded_by(
        "import importlib.util\n"
        f"spec = importlib.util.spec_from_file_location('conftest_under_test', {conftest!r})\n"
        "spec.loader.exec_module(importlib.util.module_from_spec(spec))"
    )

    assert _heavy(loaded) == [], f"{conftest} loads {_heavy(loaded)}: import it inside the fixture that needs it"


def test_every_knowledge_layer_tool_module_is_an_entry_point():
    from importlib.metadata import entry_points

    from knowledge_layer.browse import list_files
    from knowledge_layer.read_passage import read_passage

    plugins = {entry.value for entry in entry_points(group="nat.plugins")}

    assert {"knowledge_layer.register", list_files.__module__, read_passage.__module__} <= plugins
