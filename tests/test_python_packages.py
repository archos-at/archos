from __future__ import annotations

import tomllib
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = "packages/"
CORE_SUITE = ["packages/agent"]


def _pyproject() -> dict:
    return tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))


def _members() -> list[str]:
    return [m for m in _pyproject()["tool"]["uv"]["workspace"]["members"] if m.startswith(PACKAGES)]


def test_every_workspace_package_is_in_testpaths_and_in_the_taskfile():
    members = _members()
    testpaths = [p.removesuffix("/tests") for p in _pyproject()["tool"]["pytest"]["ini_options"]["testpaths"]]
    taskfile = yaml.safe_load((ROOT / "taskfiles" / "backend.yml").read_text(encoding="utf-8"))

    assert members, "no workspace member under packages/"
    assert [p for p in testpaths if p.startswith(PACKAGES)] == members
    assert taskfile["vars"]["PY_PACKAGES"].split() == [m for m in members if m not in CORE_SUITE]


def test_every_python_package_under_packages_is_a_member_or_keeps_its_own_lock():
    members = set(_members())
    stray = [
        f"{PACKAGES}{path.parent.name}"
        for path in sorted((ROOT / PACKAGES).glob("*/pyproject.toml"))
        if f"{PACKAGES}{path.parent.name}" not in members and not (path.parent / "uv.lock").is_file()
    ]

    assert stray == [], f"{stray}: add each to [tool.uv.workspace] members, testpaths and PY_PACKAGES"
