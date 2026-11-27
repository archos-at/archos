import json
import re
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
SETUP_BUN = REPO_ROOT / ".github" / "actions" / "setup-bun" / "action.yml"

_IMAGE_TAG = re.compile(r"oven/bun:(\d+\.\d+\.\d+)")


def _pinned() -> str:
    match = re.search(r'default:\s*"(\d+\.\d+\.\d+)"', SETUP_BUN.read_text(encoding="utf-8"))
    assert match, f"{SETUP_BUN} declares no exact default Bun version"
    return match.group(1)


def _dockerfiles() -> list[Path]:
    listed = subprocess.run(
        ["git", "ls-files", "-z", "--", "*Dockerfile*"], cwd=REPO_ROOT, capture_output=True, check=True
    ).stdout.decode("utf-8")
    return sorted(REPO_ROOT / name for name in listed.split("\0") if name and (REPO_ROOT / name).is_file())


def test_the_images_copy_bun_from_somewhere() -> None:
    tagged = [path for path in _dockerfiles() if _IMAGE_TAG.search(path.read_text(encoding="utf-8"))]
    assert tagged, "no Dockerfile copies Bun from an oven/bun image; this test would assert nothing"


@pytest.mark.parametrize("dockerfile", _dockerfiles(), ids=lambda p: str(p.relative_to(REPO_ROOT)))
def test_every_image_copies_the_pinned_bun(dockerfile: Path) -> None:
    pinned = _pinned()
    for version in _IMAGE_TAG.findall(dockerfile.read_text(encoding="utf-8")):
        assert version == pinned, (
            f"{dockerfile.relative_to(REPO_ROOT)} copies Bun {version}, but setup-bun pins {pinned}. "
            "Bump both in the same change."
        )


def test_the_session_hook_reads_the_pin_rather_than_naming_one() -> None:
    hook = (REPO_ROOT / ".claude" / "hooks" / "session-start.sh").read_text(encoding="utf-8")
    assert ".github/actions/setup-bun/action.yml" in hook, "the session hook no longer installs the pinned Bun"
    assert not re.search(r"bun@\d", hook), "the session hook names a Bun version instead of reading setup-bun's"


WORKSPACE_PACKAGE = REPO_ROOT / "apps" / "workspace" / "package.json"
_CANARY_RUNNER = re.compile(r"bunx bun@(\d+)\.(\d+)\.(\d+)-canary\.\d+ test")


def test_the_canary_test_runner_goes_once_a_stable_bun_carries_it() -> None:
    """`bun test` runs on a canary until a release ships what the suite uses (ADR-0103)."""
    runner = json.loads(WORKSPACE_PACKAGE.read_text(encoding="utf-8"))["scripts"]["test:specs"]
    canary = _CANARY_RUNNER.search(runner)
    if not canary:
        return
    base = tuple(int(part) for part in canary.groups())
    pinned = tuple(int(part) for part in _pinned().split("."))
    assert pinned <= base, (
        f"setup-bun pins Bun {_pinned()}, a release after the canary `test:specs` runs ({runner}). "
        "Run `bun test` on the pinned Bun: `test:specs` becomes `TZ=UTC bun test`."
    )


def test_the_vitest_types_come_from_the_runners_bun() -> None:
    """`bun-types` types the specs' `vitest` imports, so it moves with the Bun that runs them."""
    package = json.loads(WORKSPACE_PACKAGE.read_text(encoding="utf-8"))
    types = package["devDependencies"]["bun-types"]
    canary = re.search(r"bun@(\d+\.\d+\.\d+-canary\.\d{8})", package["scripts"]["test:specs"])
    expected = canary.group(1) if canary else _pinned()
    assert types.startswith(expected), (
        f"bun-types is {types}, but `test:specs` runs Bun {expected}: pin bun-types to that build's version."
    )
