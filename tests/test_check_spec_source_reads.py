from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def checker():
    spec = importlib.util.spec_from_file_location(
        "check_spec_source_reads", ROOT / "scripts" / "check_spec_source_reads.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def repo(tmp_path, monkeypatch):
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    (tmp_path / "ci").mkdir()
    monkeypatch.chdir(tmp_path)
    return tmp_path


def add(repo: Path, path: str, text: str) -> None:
    target = repo / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")
    subprocess.run(["git", "add", path], cwd=repo, check=True)


def allow(repo: Path, *paths: str) -> None:
    (repo / "ci" / "ast_guard_specs.txt").write_text("# guards\n" + "".join(f"{p}  # why\n" for p in paths))


READS_SOURCE = """import { readFileSync } from 'node:fs'
import { it, expect } from 'vitest'
it('names the client', () => {
  expect(readFileSync('bff/client.ts', 'utf8')).toContain('createClient')
})
"""


def test_a_spec_that_reads_a_source_file_fails_and_names_the_fix(checker, repo, capsys):
    add(repo, "app/client.spec.ts", READS_SOURCE)

    assert checker.main() == 1
    err = capsys.readouterr().err
    assert "app/client.spec.ts: reads source text (bff/client.ts)" in err
    assert "Test behaviour: import the code, call it" in err
    assert "TypeScript compiler API" in err


def test_a_local_read_helper_and_a_walk_filtered_by_extension_are_reads(checker, repo):
    add(
        repo,
        "app/helper.spec.ts",
        "import { readFileSync } from 'node:fs'\nconst read = (p: string) => readFileSync(p, 'utf8')\n"
        "it('x', () => expect(read(`ui/${name}.tsx`)).toMatch(/x/))\n",
    )
    add(
        repo,
        "app/walk.spec.ts",
        "import { readdirSync } from 'node:fs'\nconst files = readdirSync('bff').filter((f) => /\\.tsx?$/.test(f))\n",
    )

    assert {f.path for f in checker.find(repo, checker.tracked(repo))} == {"app/helper.spec.ts", "app/walk.spec.ts"}


def test_a_reader_imported_from_test_support_counts(checker, repo):
    add(
        repo,
        "tests/test-utils/disk.ts",
        "import { readFileSync } from 'node:fs'\nexport const text = (p: string) => readFileSync(p, 'utf8')\n",
    )
    add(repo, "app/uses.spec.ts", "import { text } from '../tests/test-utils/disk'\nit('x', () => text('bff/a.ts'))\n")

    assert [f.path for f in checker.find(repo, checker.tracked(repo))] == ["app/uses.spec.ts"]


def test_data_titles_specifiers_comments_and_spawned_scripts_pass(checker, repo):
    add(
        repo,
        "app/data.spec.ts",
        "import { readFileSync, mkdtempSync } from 'node:fs'\n"
        "import { spawnSync } from 'node:child_process'\n"
        "import { thing } from './thing.ts'\n"
        "vi.mock('./other.ts')\n"
        "// readFileSync('bff/x.ts') is how it used to work\n"
        "const SCRIPT = join(__dirname, 'promote.sh')\n"
        "it('reads report.ts names from the contract', () => {\n"
        "  const contract = JSON.parse(readFileSync('contracts/wire.json', 'utf8'))\n"
        "  spawnSync('bash', [SCRIPT])\n"
        "  expect(/x/.exec(contract)).toBeTruthy()\n"
        "})\n",
    )

    assert checker.find(repo, checker.tracked(repo)) == []


def test_a_raw_import_of_a_source_file_fails(checker, repo):
    add(repo, "app/raw.spec.ts", "import text from './client.ts?raw'\nit('x', () => expect(text).toContain('a'))\n")

    assert [f.names for f in checker.find(repo, checker.tracked(repo))] == [("./client.ts?raw",)]


def test_a_listed_guard_must_parse_and_still_read(checker, repo, capsys):
    add(repo, "app/guard.spec.ts", "import ts from 'typescript-api'\n" + READS_SOURCE)
    add(repo, "app/regex.spec.ts", READS_SOURCE)
    add(repo, "app/plain.spec.ts", "it('adds', () => expect(1 + 1).toBe(2))\n")
    allow(repo, "app/guard.spec.ts", "app/regex.spec.ts", "app/plain.spec.ts", "app/gone.spec.ts")

    assert checker.main() == 1
    err = capsys.readouterr().err
    assert "app/guard.spec.ts" not in err
    assert "app/regex.spec.ts: listed in ci/ast_guard_specs.txt but imports no parser" in err
    assert "app/plain.spec.ts no longer reads source files. Remove the line." in err
    assert "app/gone.spec.ts does not exist. Remove the line." in err


def test_the_real_tree_passes(checker, monkeypatch, capsys):
    monkeypatch.chdir(ROOT)

    assert checker.main() == 0, capsys.readouterr().err


def test_a_pending_spec_passes_until_it_stops_reading(checker, repo, capsys):
    add(repo, "app/client.spec.ts", READS_SOURCE)
    (repo / "ci" / "spec_source_reads_pending.txt").write_text("# drop after release 2026-W49\napp/client.spec.ts\n")
    assert checker.main() == 0

    add(repo, "app/client.spec.ts", "it('adds', () => expect(1 + 1).toBe(2))\n")
    assert checker.main() == 1
    assert "app/client.spec.ts no longer reads source files. Remove the line." in capsys.readouterr().err
