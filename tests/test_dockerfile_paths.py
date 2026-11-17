import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
DOCKERFILE = REPO_ROOT / "apps" / "agent-host" / "Dockerfile"

_EDITABLE = re.compile(r"""-e\s+"?(\./[^"\s\[]+)(?:\[[^\]]*\])?"?""")


def _editable_paths() -> list[str]:
    return _EDITABLE.findall(DOCKERFILE.read_text(encoding="utf-8"))


def test_the_dockerfile_is_where_this_test_thinks_it_is() -> None:
    assert DOCKERFILE.is_file(), f"{DOCKERFILE} not found — this test would otherwise assert nothing"


def test_the_dockerfile_installs_something() -> None:
    assert _editable_paths(), "no editable installs parsed out of the Dockerfile — the regex has gone stale"


@pytest.mark.parametrize("path", _editable_paths())
def test_every_installed_path_exists(path: str) -> None:
    target = REPO_ROOT / path
    assert target.is_dir(), (
        f"apps/agent-host/Dockerfile installs {path}, which does not exist. Delete the line or restore the package."
    )
    assert (target / "pyproject.toml").is_file(), (
        f"apps/agent-host/Dockerfile installs {path}, which has no pyproject.toml, so `uv pip install -e` will fail."
    )
