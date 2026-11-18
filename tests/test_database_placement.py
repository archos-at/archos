from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs/database/schema.md"
INIT_DB = ROOT / "deploy/compose/init-db.sql"
BACKFILLS = ROOT / "apps/workspace/backfills"
FIX = "fix the row in docs/database/schema.md#which-database-holds-a-table"
CONSTANTS = "packages/agent/src/agent/knowledge/document_metadata_constants.py"
BACKEND_TABLES = {
    "document_metadata": CONSTANTS,
    "document_revision_retained": CONSTANTS,
    "ingest_jobs": "packages/agent/src/agent/knowledge/ingest_status_store.py",
    "research_orchestrator_runs": "apps/agent-host/src/agent_host/jobs/orchestrator_runs.py",
}


def documented() -> dict[str, set[str]]:
    section = DOC.read_text(encoding="utf-8").split("## Which database holds a table", 1)[1].split("\n## ", 1)[0]
    rows = re.findall(r"^\| `(\w+)` \| ([^|]+) \|", section, flags=re.MULTILINE)
    return {database: set(re.findall(r"`(\w+)`", tables)) for database, tables in rows}


def init_db() -> dict[str, set[str]]:
    tables: dict[str, set[str]] = {}
    database = None
    for line in INIT_DB.read_text(encoding="utf-8").splitlines():
        if connect := re.match(r"\\connect (\w+)", line):
            database = connect.group(1)
        elif (create := re.match(r"CREATE TABLE IF NOT EXISTS (\w+)", line)) and database:
            tables.setdefault(database, set()).add(create.group(1))
    return tables


def test_every_table_init_db_creates_is_listed_under_its_database():
    listed = documented()
    for database, tables in init_db().items():
        missing = tables - listed.get(database, set())
        assert not missing, f"init-db.sql creates {sorted(missing)} in {database!r}; {FIX}"


@pytest.mark.parametrize(("table", "source"), BACKEND_TABLES.items())
def test_a_table_the_backend_creates_is_listed_under_jobs(table, source):
    assert f'"{table}' in (ROOT / source).read_text(encoding="utf-8"), f"{source} no longer names {table}"
    assert table in documented()["jobs"], f"{table} ({source}) lives in the jobs database; {FIX}"


@pytest.mark.parametrize("manifest", sorted(BACKFILLS.glob("*/backfill.json")), ids=lambda p: p.parent.name)
def test_a_sql_backfill_touches_only_tables_of_the_database_it_names(manifest):
    spec = json.loads(manifest.read_text(encoding="utf-8"))
    if spec.get("kind") != "sql":
        pytest.skip("not a SQL backfill")
    database = spec.get("database", "app")
    elsewhere = set().union(*(tables for name, tables in documented().items() if name != database))
    for script in (spec["dryRun"], spec["apply"]):
        sql = (manifest.parent / script).read_text(encoding="utf-8")
        named = set(re.findall(r"\b(?:UPDATE|FROM|INTO|JOIN)\s+(\w+)|to_regclass\('(\w+)'\)", sql, flags=re.IGNORECASE))
        wrong = {name for pair in named for name in pair if name} & elsewhere
        assert not wrong, (
            f"{manifest.parent.name}/{script} names {sorted(wrong)}, which live outside the {database!r} "
            f'database its backfill.json names; set "database" to the one docs/database/schema.md lists them under'
        )
