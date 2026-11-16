from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_the_builder_imports_and_reads_the_catalog():
    spec = importlib.util.spec_from_file_location("build_ris_catalog", REPO_ROOT / "scripts" / "build_ris_catalog.py")
    module = importlib.util.module_from_spec(spec)
    saved = dict(sys.modules)
    for name in [name for name in sys.modules if name == "agent" or name.startswith("agent.")]:
        del sys.modules[name]
    try:
        spec.loader.exec_module(module)
        module._nr.reset_registry_cache()
        registry = module._nr.load_registry(str(module.NORMS_ROOT))
    finally:
        for name in set(sys.modules) - set(saved):
            del sys.modules[name]
        sys.modules.update(saved)
    ids = {entry.id for entry in registry.entries}
    assert {"bo-wien", "bo-sbg", "baupolg-sbg"} <= ids
