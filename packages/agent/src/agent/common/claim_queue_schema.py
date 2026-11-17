from __future__ import annotations

from sqlalchemy import text

from agent.common.db_utils import present_columns


def upgrade_columns(conn, table: str, wanted: dict[str, str], *, postgres: bool) -> None:
    present = present_columns(conn, table)
    guard = "IF NOT EXISTS " if postgres else ""
    for column, definition in wanted.items():
        if column not in present:
            _execute_constant(conn, f"ALTER TABLE {table} ADD COLUMN {guard}{column} {definition}")


def ensure_status_guard(conn, table: str, *, born: str, live: tuple[str, ...], retired: tuple[str, ...]) -> None:
    statuses = _sql_list((*live, *retired))
    retired_list = _sql_list(retired)
    if conn.dialect.name != "postgresql":
        _ensure_sqlite_guard(conn, table, born=born, statuses=statuses, retired=retired_list)
        return
    function = f"{table}_status_guard"
    _execute_constant(
        conn,
        f"CREATE OR REPLACE FUNCTION {function}() RETURNS trigger LANGUAGE plpgsql AS $guard$\n"
        "BEGIN\n"
        f"  IF NEW.status NOT IN ({statuses}) THEN\n"
        f"    RAISE EXCEPTION '{table}: unknown status %', NEW.status USING ERRCODE = 'check_violation';\n"
        "  END IF;\n"
        f"  IF TG_OP = 'INSERT' AND NEW.status <> '{born}' THEN\n"
        f"    RAISE EXCEPTION '{table}: a job is born {born}, not %', NEW.status USING ERRCODE = 'check_violation';\n"
        "  END IF;\n"
        f"  IF TG_OP = 'UPDATE' AND OLD.status IN ({retired_list}) AND NEW.status <> OLD.status THEN\n"
        f"    RAISE EXCEPTION '{table}: job % is %, it cannot become %', OLD.job_id, OLD.status, NEW.status\n"
        "      USING ERRCODE = 'check_violation';\n"
        "  END IF;\n"
        "  RETURN NEW;\n"
        "END\n"
        "$guard$",
    )
    present = conn.execute(
        text("SELECT 1 FROM pg_trigger WHERE tgname = :name AND tgrelid = to_regclass(:table)"),
        {"name": function, "table": table},
    ).scalar()
    if not present:
        _execute_constant(
            conn,
            f"CREATE TRIGGER {function} BEFORE INSERT OR UPDATE OF status ON {table} "
            f"FOR EACH ROW EXECUTE FUNCTION {function}()",
        )


def _ensure_sqlite_guard(conn, table: str, *, born: str, statuses: str, retired: str) -> None:
    _execute_constant(
        conn,
        f"CREATE TRIGGER IF NOT EXISTS {table}_status_born BEFORE INSERT ON {table} "
        f"WHEN NEW.status <> '{born}' OR NEW.status NOT IN ({statuses}) "
        f"BEGIN SELECT RAISE(ABORT, '{table}: a job is born {born}'); END",
    )
    _execute_constant(
        conn,
        f"CREATE TRIGGER IF NOT EXISTS {table}_status_moves BEFORE UPDATE OF status ON {table} "
        f"WHEN NEW.status NOT IN ({statuses}) OR (OLD.status IN ({retired}) AND NEW.status <> OLD.status) "
        f"BEGIN SELECT RAISE(ABORT, '{table}: illegal status transition'); END",
    )


def _sql_list(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def _execute_constant(conn, statement: str) -> None:
    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
    conn.execute(text(statement))
