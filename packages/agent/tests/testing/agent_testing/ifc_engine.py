"""What the agent's engine suites know is broken on an engine release, stated once."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError
from importlib.metadata import version

import pytest


def _ifcopenshell_at_least(major: int, minor: int) -> bool:
    try:
        installed = version("ifcopenshell")
    except PackageNotFoundError:
        return False
    return tuple(int(part) for part in installed.split(".")[:2]) >= (major, minor)


TREE_HITS_RAISE_ON_IFCOPENSHELL_0_9 = pytest.mark.xfail(
    _ifcopenshell_at_least(0, 9),
    strict=True,
    raises=(AttributeError, AssertionError),
    reason=(
        "real bug, behaviour left alone: on ifcopenshell 0.9 a tree hit's `instance` is a bare SwigPyObject, "
        "so every `hit.instance.id()` in ifc_spatial raises. Here it is clear_height's, "
        "and a survey turns that into 'on 0 of 4 elements'"
    ),
)
