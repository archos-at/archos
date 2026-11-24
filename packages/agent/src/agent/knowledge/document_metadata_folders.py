from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

from agent.knowledge.document_metadata_constants import TABLE_NAME
from agent.knowledge.document_metadata_constants import logger
from agent.knowledge.document_metadata_helpers import _escape_like


def rewrite_folder_paths(store, collection: str, from_path: str, to_path: str | None) -> int:
    return store.rewrite_folder_paths_moved(collection, from_path, to_path)[0]


def _rename_exact(conn, collection: str, prefix: str, target: str) -> int:
    from sqlalchemy import text

    exact = conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(f"UPDATE {TABLE_NAME} SET folder_path = :target WHERE collection = :collection AND folder_path = :prefix"),
        {"target": target or None, "collection": collection, "prefix": prefix},
    )
    return exact.rowcount or 0


def _rename_descendants(conn, collection: str, prefix: str, target: str) -> int:
    from sqlalchemy import text

    descendants = conn.execute(
        # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
        text(
            f"UPDATE {TABLE_NAME} SET folder_path = :new_prefix || substr(folder_path, :cut) "
            "WHERE collection = :collection AND folder_path LIKE :pattern ESCAPE '\\'"
        ),
        {
            "new_prefix": f"{target}/" if target else "",
            "cut": len(prefix) + 2,
            "collection": collection,
            "pattern": f"{_escape_like(prefix)}/%",
        },
    )
    return descendants.rowcount or 0


def rewrite_folder_paths_moved(store, collection: str, from_path: str, to_path: str | None) -> tuple[int, list[str]]:
    from sqlalchemy import text

    prefix = (from_path or "").strip().strip("/")
    if not prefix:
        return 0, []
    target = (to_path or "").strip().strip("/")

    updated = 0
    try:
        with store._sync_engine.connect() as conn:
            moved = [
                row[0]
                for row in conn.execute(
                    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                    text(
                        f"SELECT filename FROM {TABLE_NAME} WHERE collection = :collection "
                        "AND (folder_path = :prefix OR folder_path LIKE :pattern ESCAPE '\\')"
                    ),
                    {"collection": collection, "prefix": prefix, "pattern": f"{_escape_like(prefix)}/%"},
                )
            ]
            updated += _rename_exact(conn, collection, prefix, target)

            updated += _rename_descendants(conn, collection, prefix, target)
            conn.commit()
    except Exception as e:
        logger.warning("Failed to rewrite folder paths under %r in %s: %s", from_path, collection, e)
        return 0, []
    logger.info("Re-filed %d document(s) from %r to %r in %s", updated, prefix, target, collection)
    return updated, moved
