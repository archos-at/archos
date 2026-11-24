from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "apps" / "workspace" / "migrations"
FIRST_AFTER_RENAME = 192
ROLE_LITERAL = re.compile(r"\b\w*(?:app_rw|app_platform|app_owner|keda_scaler)\b")
COMMENT = re.compile(r"--[^\n]*|/\*.*?\*/", re.DOTALL)


def _number(path: Path) -> int:
    return int(path.name.split("_", 1)[0])


def test_a_migration_after_the_role_rename_grants_through_rls_role() -> None:
    offenders = [
        path.name
        for path in sorted(MIGRATIONS.glob("[0-9][0-9][0-9][0-9]_*.sql"))
        if _number(path) >= FIRST_AFTER_RENAME and ROLE_LITERAL.search(COMMENT.sub(" ", path.read_text()))
    ]
    assert offenders == [], (
        "These migrations name a runtime role literally. Deployed databases renamed the runtime roles "
        "(deploy/postgres/rename-legacy-names.sh) while a fresh CI database still has the old names, so a "
        "literal name fails on one of them. Grant through rls_role('rw') / rls_role('platform') inside "
        "EXECUTE format(... %I ...), as 0261 and 0263 do: " + ", ".join(offenders)
    )
