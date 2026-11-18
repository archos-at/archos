from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
MARKER = "drop after release 2026-W50"


@pytest.fixture(scope="module")
def mod():
    spec = importlib.util.spec_from_file_location("expand_switch", ROOT / "ci" / "expand_switch.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True).stdout.strip()


def commit(repo: Path, files: dict[str, str], message: str) -> str:
    for path, text in files.items():
        target = repo / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
        git(repo, "add", path)
    git(repo, "commit", "-q", "-m", message)
    return git(repo, "rev-parse", "HEAD")


def manifest(**fields: str) -> str:
    return f'{{"expires": "{MARKER}",\n' + ",\n".join(f'  "{k}": {json.dumps(v)}' for k, v in fields.items()) + "\n}\n"


def pin_prod(repo: Path, sha: str) -> None:
    develop = git(repo, "rev-parse", "--abbrev-ref", "HEAD")
    git(repo, "switch", "-q", "-C", "prod", develop)
    commit(repo, {"deploy/pulumi/Pulumi.prod.yaml": f"config:\n  grid-oib:imageTag: sha-{sha}\n"}, "pin prod")
    git(repo, "switch", "-q", develop)


@pytest.fixture
def repo(tmp_path, monkeypatch):
    git(tmp_path, "init", "-q", "-b", "develop")
    git(tmp_path, "config", "user.email", "ci@example.invalid")
    git(tmp_path, "config", "user.name", "ci")
    monkeypatch.chdir(tmp_path)
    return tmp_path


@pytest.fixture
def history(repo):
    base = commit(repo, {"README.md": "x\n"}, "base")
    expand = commit(repo, {"deploy/rollout/expands/names.json": manifest(what="readers take both")}, "expand")
    switch = commit(repo, {"deploy/rollout/switches/names-writers.json": manifest(switches="names")}, "switch")
    return {"base": base, "expand": expand, "switch": switch}


def test_a_switch_pr_fails_while_prod_does_not_run_its_expand(mod, repo, history, capsys):
    pin_prod(repo, history["base"])

    assert mod.main(["pr", history["expand"], history["switch"], "prod"]) == 1

    out = capsys.readouterr().out
    assert "names-writers switches names" in out
    assert "does not run yet" in out


def test_a_switch_pr_passes_once_prod_runs_its_expand(mod, repo, history, capsys):
    pin_prod(repo, history["expand"])

    assert mod.main(["pr", history["expand"], history["switch"], "prod"]) == 0
    assert "has its expand on prod" in capsys.readouterr().out


def test_a_pr_that_declares_no_switch_is_not_checked(mod, repo, history, capsys):
    after = commit(repo, {"README.md": "y\n"}, "unrelated")

    assert mod.main(["pr", history["switch"], after, "no-such-ref"]) == 0
    assert "declares no switch" in capsys.readouterr().out


def test_a_promotion_carrying_an_expand_and_its_switch_is_refused(mod, repo, history, capsys):
    pin_prod(repo, history["base"])

    assert mod.main(["promotion", history["switch"], "prod"]) == 1
    assert "does not run yet" in capsys.readouterr().out


def test_a_promotion_carrying_the_switch_after_prod_ran_the_expand_passes(mod, repo, history):
    pin_prod(repo, history["expand"])

    assert mod.main(["promotion", history["switch"], "prod"]) == 0


def test_a_switch_naming_no_registered_expand_fails(mod, repo, capsys):
    base = commit(repo, {"README.md": "x\n"}, "base")
    head = commit(repo, {"deploy/rollout/switches/orphan.json": manifest(switches="nothing")}, "switch")
    pin_prod(repo, head)

    assert mod.main(["pr", base, head, "prod"]) == 1
    assert "no deploy/rollout/expands/nothing.json was ever added" in capsys.readouterr().out


def test_an_expand_registered_later_counts_from_the_commit_it_names(mod, repo, capsys):
    shipped = commit(repo, {"README.md": "the expand itself\n"}, "expand, before the registry")
    pin_prod(repo, shipped)
    register = commit(
        repo, {"deploy/rollout/expands/old.json": manifest(what="shipped earlier", commit=shipped)}, "register"
    )
    head = commit(repo, {"deploy/rollout/switches/old-writers.json": manifest(switches="old")}, "switch")

    assert mod.main(["pr", register, head, "prod"]) == 0
    assert mod.main(["promotion", head, "prod"]) == 0


def test_an_expand_naming_a_commit_off_develop_is_refused(mod, repo):
    base = commit(repo, {"README.md": "x\n"}, "base")
    commit(repo, {"deploy/rollout/expands/bad.json": manifest(what="typo", commit="0" * 40)}, "register")
    head = commit(repo, {"deploy/rollout/switches/bad-writers.json": manifest(switches="bad")}, "switch")
    pin_prod(repo, base)

    with pytest.raises(SystemExit, match="40-hex sha of the expand"):
        mod.main(["pr", base, head, "prod"])


def test_a_switch_without_its_expand_name_is_refused(mod, repo):
    base = commit(repo, {"README.md": "x\n"}, "base")
    head = commit(repo, {"deploy/rollout/switches/x.json": manifest(what="no switches key")}, "switch")
    pin_prod(repo, base)

    with pytest.raises(SystemExit, match="must name its expand"):
        mod.main(["pr", base, head, "prod"])


def test_prod_without_a_sha_pin_stops_the_check(mod, repo, history):
    git(repo, "switch", "-q", "-C", "prod", "develop")
    commit(repo, {"deploy/pulumi/Pulumi.prod.yaml": "config:\n  grid-oib:imageTag: latest\n"}, "unpinned")
    git(repo, "switch", "-q", "develop")

    with pytest.raises(SystemExit, match="pins no sha- imageTag"):
        mod.main(["promotion", history["switch"], "prod"])


def test_the_registered_expands_name_commits_on_develop(mod):
    for path in sorted((ROOT / "deploy" / "rollout" / "expands").glob("*.json")):
        text = path.read_text(encoding="utf-8")
        assert text.startswith(f'{{"expires": "{MARKER[:18]}'), f"{path.name}: the expiry marker opens line 1"
        assert mod.NAME.match(path.stem)


PROMOTE = ROOT / ".github" / "workflows" / "promote.yml"
PICK = "Pick the commit"
GUARD = "Refuse a switch whose expand prod does not run yet"


def promote_steps() -> list[dict]:
    return yaml.safe_load(PROMOTE.read_text(encoding="utf-8"))["jobs"]["promote"]["steps"]


def run_promote(origin: Path, workdir: Path, sha: str) -> subprocess.CompletedProcess[str]:
    """Runs promote.yml's own steps, PICK then GUARD, in a fresh clone of origin."""
    clone = workdir / "clone"
    subprocess.run(["git", "clone", "-q", "-b", "develop", str(origin), str(clone)], check=True)
    (clone / "ci").mkdir()
    shutil.copy(ROOT / "ci" / "expand_switch.py", clone / "ci" / "expand_switch.py")
    github_env = workdir / "github_env"
    github_env.write_text("", encoding="utf-8")
    env = {**os.environ, "GITHUB_ENV": str(github_env), "INPUT_SHA": sha}
    steps = {step.get("name"): step for step in promote_steps()}

    def step(name: str) -> subprocess.CompletedProcess[str]:
        command = ["bash", "-e", "-c", steps[name]["run"]]
        return subprocess.run(command, check=False, cwd=clone, env=env, capture_output=True, text=True)

    picked = step(PICK)
    assert picked.returncode == 0, picked.stdout + picked.stderr
    env.update(line.split("=", 1) for line in github_env.read_text(encoding="utf-8").splitlines())
    return step(GUARD)


def test_promote_guards_the_switch_before_it_writes_a_branch():
    names = [step.get("name") for step in promote_steps()]
    assert names.index(PICK) < names.index(GUARD) < names.index("Build the promotion branch")


def test_the_promote_step_refuses_a_promotion_carrying_an_expand_and_its_switch(repo, history, tmp_path_factory):
    pin_prod(repo, history["base"])

    result = run_promote(repo, tmp_path_factory.mktemp("promote"), history["switch"])

    assert result.returncode == 1, result.stdout + result.stderr
    assert "does not run yet" in result.stdout


def test_the_promote_step_passes_once_prod_runs_the_expand(repo, history, tmp_path_factory):
    pin_prod(repo, history["expand"])

    result = run_promote(repo, tmp_path_factory.mktemp("promote"), history["switch"])

    assert result.returncode == 0, result.stdout + result.stderr
