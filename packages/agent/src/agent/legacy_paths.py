"""Old ``agent.agents.piloti`` in queued jobs and checkpoints answers as ``agent.core``: drop after release 2026-W48."""

from __future__ import annotations

import importlib
import importlib.abc
import importlib.util
import sys
from importlib.machinery import ModuleSpec
from types import ModuleType

OLD_PATH = "agent.agents.piloti"
NEW_PATH = "agent.core"


class _LegacyPathFinder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, fullname: str, path: object = None, target: object = None) -> ModuleSpec | None:
        if fullname != OLD_PATH and not fullname.startswith(f"{OLD_PATH}."):
            return None
        return importlib.util.spec_from_loader(fullname, self)

    def create_module(self, spec: ModuleSpec) -> ModuleType:
        # nosemgrep: python.lang.security.audit.non-literal-import.non-literal-import
        return importlib.import_module(NEW_PATH + spec.name.removeprefix(OLD_PATH))

    def exec_module(self, module: ModuleType) -> None:
        return None


def install_legacy_paths() -> None:
    if not any(isinstance(finder, _LegacyPathFinder) for finder in sys.meta_path):
        sys.meta_path.insert(0, _LegacyPathFinder())
