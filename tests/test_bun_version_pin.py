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
