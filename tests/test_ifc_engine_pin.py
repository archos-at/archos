"""The agent image runs the IfcOpenShell the engine's suite ran on.

CI tests `packages/ifc-spatial-py` against its own `uv.lock`. The agent image
installs the package with `uv pip install -e` (`apps/agent-host/Dockerfile`),
which reads the requirements in `pyproject.toml` and never that lock. With a
range there, the image took IfcOpenShell 0.9.0.post1 while the suite stayed on
0.8.5, and `clearHeight` raises AttributeError on 0.9.0.post1 with every test
green. These tests read the real files and fail when the two can differ again.
"""

import tomllib
from pathlib import Path

import pytest

ENGINE = Path(__file__).resolve().parents[1] / "packages" / "ifc-spatial-py"


def _declared() -> list[str]:
    project = tomllib.loads((ENGINE / "pyproject.toml").read_text(encoding="utf-8"))["project"]
    # `ids` is the extra the image installs: `ifc-spatial-py[ids]`.
    return [*project["dependencies"], *project["optional-dependencies"]["ids"]]


def _locked(name: str) -> str:
    packages = tomllib.loads((ENGINE / "uv.lock").read_text(encoding="utf-8"))["package"]
    versions = [package["version"] for package in packages if package["name"] == name]
    assert len(versions) == 1, f"{name}: expected one locked version, found {versions}"
    return versions[0]


@pytest.mark.parametrize("name", ["ifcopenshell", "ifctester"])
def test_the_image_requirement_is_the_locked_version(name: str) -> None:
    pinned = f"{name}=={_locked(name)}"
    assert pinned in _declared(), (
        f"packages/ifc-spatial-py/pyproject.toml must require {pinned}, the version in its uv.lock: "
        "the image installs from that requirement and the suite runs on the lock. Move both in the same change."
    )
