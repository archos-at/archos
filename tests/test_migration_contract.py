"""A migration that takes something away fails, so a rollback stays possible.

`ci/migration_contract.py` guards the one thing a rollback by image tag cannot
undo: the schema (docs/deployment/rollback.md). Each case below is a statement
an older build would trip over, or one it would not.
"""

from __future__ import annotations

import importlib.util
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def mod():
    spec = importlib.util.spec_from_file_location("migration_contract", ROOT / "ci" / "migration_contract.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    "sql",
    [
        "ALTER TABLE documents DROP COLUMN legacy_title;",
        "drop table if exists legacy_wakes;",
        "DROP VIEW legacy_wakes;",
        "ALTER TABLE legacy_asks RENAME TO agent_asks;",
        "ALTER TABLE projects RENAME COLUMN name TO title;",
        "ALTER TABLE projects ALTER COLUMN budget TYPE numeric(12,2);",
        "ALTER TABLE projects ALTER COLUMN budget SET DATA TYPE bigint;",
        "ALTER TABLE projects ALTER COLUMN owner_id SET NOT NULL;",
        "ALTER TABLE projects ADD COLUMN region text NOT NULL;",
    ],
)
def test_a_statement_an_older_build_trips_over_is_flagged(mod, sql):
    assert mod.findings(sql)


@pytest.mark.parametrize(
    "sql",
    [
        "CREATE TABLE agent_wakes (id uuid PRIMARY KEY);",
        "ALTER TABLE projects ADD COLUMN region text;",
        "ALTER TABLE projects ADD COLUMN archived boolean NOT NULL DEFAULT false;",
        "CREATE INDEX CONCURRENTLY idx_projects_region ON projects(region);",
        "CREATE VIEW legacy_wakes WITH (security_invoker) AS SELECT * FROM agent_wakes;",
        "-- DROP TABLE documents; we do not, this is a comment\nSELECT 1;",
        "/* RENAME TO is discussed here */ CREATE TABLE x (id int);",
        "ALTER TABLE projects DROP CONSTRAINT projects_old_check;",
    ],
)
def test_an_additive_statement_passes(mod, sql):
    assert mod.findings(sql) == []


def test_only_added_forward_migrations_are_read(mod, tmp_path, monkeypatch):
    def git(*args: str) -> str:
        return subprocess.run(["git", *args], cwd=tmp_path, check=True, capture_output=True, text=True).stdout.strip()

    git("init", "-q", "-b", "main")
    git("config", "user.email", "ci@example.invalid")
    git("config", "user.name", "ci")
    migrations = tmp_path / mod.MIGRATIONS
    migrations.mkdir(parents=True)
    (migrations / "0001_old.sql").write_text("CREATE TABLE a (id int);")
    git("add", ".")
    git("commit", "-qm", "base")
    base = git("rev-parse", "HEAD")
    (migrations / "0001_old.sql").write_text("DROP TABLE a;")  # edited, not added
    (migrations / "0002_new.sql").write_text("CREATE TABLE b (id int);")
    (migrations / "0002_new.down.sql").write_text("DROP TABLE b;")
    git("add", ".")
    git("commit", "-qm", "head")
    monkeypatch.chdir(tmp_path)

    assert mod.added_migrations(base, "HEAD") == [mod.MIGRATIONS + "0002_new.sql"]
    assert mod.main([base, "HEAD"]) == 0
