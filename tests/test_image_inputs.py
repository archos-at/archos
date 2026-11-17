from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WEEK = "2026-W41"


@pytest.fixture(scope="module")
def mod():
    spec = importlib.util.spec_from_file_location("image_inputs", ROOT / "ci" / "image_inputs.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules["image_inputs"] = module
    spec.loader.exec_module(module)
    return module


def test_copy_sources_reads_every_context_copy_and_skips_stage_copies(mod):
    dockerfile = """
FROM debian AS builder
# COPY commented/ ./out/
COPY pyproject.toml uv.lock ./
COPY --chown=app:app src/ ./src/
COPY --from=builder /app /app
ADD scripts/*.sh /usr/local/bin/
COPY apps/agent-host/entrypoint.py \\
     apps/agent-host/start_web.py ./deploy/
COPY ["configs/a.yml", "/etc/a.yml"]
copy lower/ ./lower/
"""
    assert mod.copy_sources(dockerfile) == [
        "pyproject.toml",
        "uv.lock",
        "src/",
        "scripts",
        "apps/agent-host/entrypoint.py",
        "apps/agent-host/start_web.py",
        "configs/a.yml",
        "lower/",
    ]


def test_copying_the_whole_context_makes_the_whole_context_an_input(mod):
    assert mod.copy_sources("FROM node\nCOPY . .\n") == ["."]


def test_the_backend_image_watches_what_its_dockerfile_copies(mod):
    backend = next(image for image in mod.IMAGES if image.name == "backend")
    inputs = mod.inputs(backend)

    assert "packages/ifc-spatial-py" in inputs
    assert {"apps/agent-host/Dockerfile", "apps/agent-host", "packages/agent", "uv.lock"} <= set(inputs)
    assert "tests" not in inputs and "docs" not in inputs


def test_a_copy_that_leaves_the_context_is_refused(mod):
    with pytest.raises(ValueError, match="leaves the build context"):
        mod._normalise("apps/workspace", "../../etc/passwd")


def git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=repo,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def write(repo: Path, files: dict[str, str]) -> str:
    for name, text in files.items():
        path = repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "change")
    return git(repo, "rev-parse", "HEAD")


@pytest.fixture
def repo(mod, tmp_path, monkeypatch):
    git(tmp_path, "init", "-q", "-b", "develop")
    write(
        tmp_path,
        {
            "apps/agent-host/Dockerfile": "FROM debian\nCOPY src/ ./src/\nCOPY pyproject.toml ./\n",
            "src/app.py": "print(1)\n",
            "pyproject.toml": "[project]\n",
            "apps/workspace/deploy/Dockerfile": "FROM node\nCOPY . .\n",
            "apps/workspace/page.tsx": "export {}\n",
            "apps/website/Dockerfile": "FROM node\nCOPY . .\n",
            "apps/website/index.astro": "<p/>\n",
            "apps/cms/Dockerfile": "FROM node\nCOPY . .\n",
            "apps/cms/src/payload.config.ts": "export {}\n",
            "docs/readme.md": "hi\n",
            "deploy/pulumi/Pulumi.prod.yaml": "config:\n  proj:baseDomain: live.example.org\n  proj:replicas: 2\n",
        },
    )
    monkeypatch.setattr(mod, "ROOT", tmp_path)
    return tmp_path


def test_only_an_input_change_renames_the_image(mod, repo):
    before = mod.hashes("HEAD", week=WEEK)
    write(repo, {"docs/readme.md": "changed\n"})
    assert mod.hashes("HEAD", week=WEEK) == before

    write(repo, {"src/app.py": "print(2)\n"})
    after = mod.hashes("HEAD", week=WEEK)
    assert after["backend"] != before["backend"]
    assert {k: after[k] for k in ("frontend", "web", "cms")} == {k: before[k] for k in ("frontend", "web", "cms")}


def test_the_website_is_built_for_the_domain_prod_serves(mod, repo):
    web = next(image for image in mod.IMAGES if image.name == "web")
    assert mod.build_args(web) == {"PUBLIC_SITE_URL": "https://live.example.org"}
    assert all(mod.build_args(image) == {} for image in mod.IMAGES if image.name != "web")

    before = mod.hashes("HEAD", week=WEEK)
    write(
        repo, {"deploy/pulumi/Pulumi.prod.yaml": "config:\n  proj:baseDomain: live.example.org\n  proj:replicas: 3\n"}
    )
    assert mod.hashes("HEAD", week=WEEK) == before, "another prod key does not rebuild the website"

    write(repo, {"deploy/pulumi/Pulumi.prod.yaml": "config:\n  proj:baseDomain: moved.example.org\n"})
    after = mod.hashes("HEAD", week=WEEK)
    assert after["web"] != before["web"], "the domain move rebuilds the website with its new address"
    assert {k: after[k] for k in ("frontend", "backend")} == {k: before[k] for k in ("frontend", "backend")}


def test_a_new_week_renames_every_image_so_base_images_are_refreshed(mod, repo):
    this_week, next_week = mod.hashes("HEAD", week=WEEK), mod.hashes("HEAD", week="2026-W42")

    assert all(this_week[name] != next_week[name] for name in this_week)
    assert mod.iso_week(__import__("datetime").date(2026, 10, 9)) == WEEK


def test_a_copied_path_the_commit_does_not_track_fails_loudly(mod, repo):
    write(repo, {"apps/agent-host/Dockerfile": "FROM debian\nCOPY generated/ ./generated/\n"})

    with pytest.raises(ValueError, match="does not track"):
        mod.hashes("HEAD", week=WEEK)


def test_a_pull_request_builds_the_images_it_changes(mod, repo):
    base = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "-b", "feature")
    write(repo, {"apps/workspace/page.tsx": "export const x = 1\n"})
    git(repo, "checkout", "-q", "develop")
    moved = write(repo, {"src/app.py": "print(3)\n"})
    git(repo, "checkout", "-q", "feature")

    build, images = mod.plan_pull_request(moved, week=WEEK)

    assert [entry["name"] for entry in build] == ["frontend"]
    assert [entry["name"] for entry in images] == ["backend", "frontend", "web", "cms"]
    assert build[0]["repository"] == "grid-oib-frontend" and build[0]["context"] == "apps/workspace"
    assert next(entry for entry in images if entry["name"] == "cms")["repository"] == "cms"
    assert mod.plan_pull_request(base, week=WEEK)[0] == build


def test_a_pull_request_that_moves_an_image_builds_it(mod, repo):
    git(repo, "mv", "apps/website", "site-before-the-move")
    git(repo, "commit", "-q", "-m", "the old layout")
    base = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "-b", "move")
    git(repo, "mv", "site-before-the-move", "apps/website")
    git(repo, "commit", "-q", "-m", "the move")

    build, _ = mod.plan_pull_request(base, week=WEEK)

    assert [entry["name"] for entry in build] == ["web"]


@pytest.mark.parametrize(
    ("answers", "expected"),
    [
        ({"backend": True, "frontend": True, "web": True, "cms": True}, []),
        ({"backend": True, "frontend": False, "web": True, "cms": True}, ["frontend"]),
        ({"backend": None, "frontend": True, "web": True, "cms": True}, ["backend"]),
        ({"backend": True, "frontend": True, "web": True, "cms": False}, ["cms"]),
    ],
)
def test_a_push_builds_what_the_registry_does_not_have(mod, repo, answers, expected):
    asked: list[tuple[str, str]] = []

    def published(name: str, tag: str):
        asked.append((name, tag))
        return answers[name]

    build, _ = mod.plan_push(published, week=WEEK)

    assert [entry["name"] for entry in build] == expected
    hashes = mod.hashes("HEAD", week=WEEK)
    assert asked == [(name, f"inputs-{hashes[name]}") for name in ("backend", "frontend", "web", "cms")]
