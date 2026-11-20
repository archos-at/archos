from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def checker():
    sys.path.insert(0, str(ROOT / "scripts"))
    spec = importlib.util.spec_from_file_location(
        "check_spec_env_writes", ROOT / "scripts" / "check_spec_env_writes.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def repo(tmp_path, monkeypatch):
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    monkeypatch.chdir(tmp_path)
    return tmp_path


def add(repo: Path, path: str, text: str) -> None:
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    subprocess.run(["git", "add", path], cwd=repo, check=True)


def test_every_kind_of_direct_write_fails_and_names_vi_stub_env(checker, repo, capsys):
    add(
        repo,
        "app/env.spec.ts",
        "process.env.A = 'a'\n"
        "process.env['B'] = 'b'\n"
        "delete process.env.C\n"
        "process.env = { ...saved }\n"
        "Object.assign(process.env, { D: 'd' })\n"
        "process.env.E ??= 'e'\n",
    )

    assert checker.main() == 1
    err = capsys.readouterr().err
    assert "app/env.spec.ts:1,2,3,4,5,6: writes process.env directly" in err
    assert "vi.stubEnv(name, value)" in err


def test_reads_comparisons_strings_comments_and_non_specs_pass(checker, repo):
    add(
        repo,
        "app/reads.spec.ts",
        "const url = process.env.BACKEND_URL\n"
        "if (process.env.CI === 'true') skip()\n"
        "// process.env.A = 'a' used to be here\n"
        "const doc = 'process.env.A = 1'\n"
        "vi.stubEnv('A', 'a')\n",
    )
    add(repo, "app/server.ts", "process.env.NODE_ENV = 'production'\n")

    assert checker.check(repo) == []


def test_the_real_tree_passes(checker, monkeypatch, capsys):
    monkeypatch.chdir(ROOT)

    assert checker.main() == 0, capsys.readouterr().err
