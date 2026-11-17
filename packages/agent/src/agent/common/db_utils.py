from __future__ import annotations

import hashlib
import re
from collections.abc import Callable
from typing import Any

_CREDENTIAL_RE = re.compile(r"://[^/@\s]+@")


def redact_db_url(url: str) -> str:
    try:
        from sqlalchemy.engine.url import make_url

        return make_url(url).render_as_string(hide_password=True)
    except Exception:
        return _CREDENTIAL_RE.sub("://***@", url)


def _translate_tls_param(url: str) -> str:
    out = url.replace("?ssl=", "?sslmode=").replace("&ssl=", "&sslmode=")
    return out.replace("sslmode=true", "sslmode=require").replace("sslmode=false", "sslmode=disable")


def normalize_db_url(db_url: str, async_mode: bool = True) -> str:
    if db_url.startswith("postgresql") or db_url.startswith("postgres"):
        base_url = db_url.replace("+asyncpg", "").replace("+psycopg2", "").replace("+psycopg", "")
        if not base_url.startswith("postgresql://"):
            base_url = base_url.replace("postgres://", "postgresql://")
        return _translate_tls_param(base_url.replace("postgresql://", "postgresql+psycopg://"))
    if db_url.startswith("sqlite"):
        base_url = db_url.replace("+aiosqlite", "")
        return base_url.replace("sqlite:///", "sqlite+aiosqlite:///") if async_mode else base_url
    return db_url


def schema_lock_key(name: str) -> int:
    digest = hashlib.sha256(f"grid-schema:{name}".encode()).digest()
    return int.from_bytes(digest[:8], "big", signed=True)


SCHEMA_LOCK_TIMEOUT = "5s"


def lock_schema(conn, name: str) -> None:
    if conn.dialect.name != "postgresql":
        return
    from sqlalchemy import text

    conn.execute(text("SELECT set_config('lock_timeout', :timeout, true)"), {"timeout": SCHEMA_LOCK_TIMEOUT})
    conn.execute(text("SELECT pg_advisory_xact_lock(CAST(:key AS bigint))"), {"key": schema_lock_key(name)})


def present_columns(conn, table: str) -> set[str]:
    from sqlalchemy import inspect

    return {column["name"] for column in inspect(conn).get_columns(table)}


def present_indexes(conn, table: str) -> set[str]:
    from sqlalchemy import inspect

    return {index["name"] for index in inspect(conn).get_indexes(table) if index.get("name")}


def ensure_schema(engine, name: str, ddl: Callable[[Any], None]) -> None:
    with engine.begin() as conn:
        lock_schema(conn, name)
        ddl(conn)
