"""What the agent's engine suites know is broken on an engine release, stated once."""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError
from importlib.metadata import version

import pytest


def _ifcopenshell_at_least(major: int, minor: int) -> bool:
    # The root environment has no engine, and these suites skip there anyway.
    try:
        installed = version("ifcopenshell")
    except PackageNotFoundError:
        return False
    return tuple(int(part) for part in installed.split(".")[:2]) >= (major, minor)


#: Conditional, because the image installs the engine unlocked and CI's
#: `agent-engine` job does the same: a pin below 0.9 brings these tests back by
#: itself. Strict, so porting the call turns them red until the marker goes.
CLEAR_HEIGHT_RAISES_ON_IFCOPENSHELL_0_9 = pytest.mark.xfail(
    _ifcopenshell_at_least(0, 9),
    strict=True,
    raises=(AttributeError, AssertionError),
    reason=(
        "real bug, behaviour left alone: on ifcopenshell 0.9 a tree hit's `instance` is a bare SwigPyObject, "
        "so `hit.instance.id()` in ifc_spatial/operators_vertical.py clear_height raises, "
        "and a survey turns that into 'on 0 of 4 elements'"
    ),
)
