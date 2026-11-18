from __future__ import annotations

import importlib
import sys
from collections.abc import Callable
from collections.abc import Mapping
from typing import Any


def lazy_exports(package: str, exports: Mapping[str, str], *, cache: bool = True) -> Callable[[str], Any]:

    def __getattr__(name: str) -> Any:
        source = exports.get(name)
        if source is None:
            raise AttributeError(f"module {package!r} has no attribute {name!r}")
        # nosemgrep: python.lang.security.audit.non-literal-import.non-literal-import
        module = importlib.import_module(source, package)
        value = module if source == name else getattr(module, name)
        if cache:
            setattr(sys.modules[package], name, value)
        return value

    return __getattr__
