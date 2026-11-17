import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
FOREIGN_LOCKFILES = ("package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb")


def _tracked(*patterns: str) -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files", "--", *patterns], cwd=REPO_ROOT, capture_output=True, text=True, check=True
    ).stdout
    return [REPO_ROOT / line for line in out.splitlines() if "node_modules" not in line]


def _projects() -> list[Path]:
    return sorted(path.parent for path in _tracked("package.json", "*/package.json"))


def test_the_repo_has_javascript_projects() -> None:
    assert _projects(), "git ls-files found no package.json; this test would assert nothing"


@pytest.mark.parametrize("project", _projects(), ids=lambda p: str(p.relative_to(REPO_ROOT)))
def test_every_project_is_locked_by_bun(project: Path) -> None:
    lockfile = project / "bun.lock"
    assert lockfile.is_file(), (
        f"{project.relative_to(REPO_ROOT)} has a package.json and no bun.lock. "
        "Install it with `bun install` and commit the lockfile (ADR-0103)."
    )


def test_no_other_package_manager_lockfile_is_tracked() -> None:
    foreign = _tracked(*(f"*{name}" for name in FOREIGN_LOCKFILES), *FOREIGN_LOCKFILES)
    assert not foreign, (
        "lockfiles from another package manager are tracked: "
        + ", ".join(str(path.relative_to(REPO_ROOT)) for path in foreign)
        + ". Delete them; `bun install` reads a package-lock.json once and migrates it."
    )
