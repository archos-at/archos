from __future__ import annotations

from typing import TYPE_CHECKING

from agent.knowledge.document_classification import MAX_TOPIC_VOCABULARY

if TYPE_CHECKING:
    pass

from agent.knowledge.document_metadata_constants import TABLE_NAME
from agent.knowledge.document_metadata_constants import TAGS_SET_BY_PERSON
from agent.knowledge.document_metadata_constants import logger
from agent.knowledge.document_metadata_helpers import _batch_bind
from agent.knowledge.document_metadata_helpers import _batch_keys
from agent.knowledge.document_metadata_helpers import _batch_match
from agent.knowledge.document_metadata_helpers import _match
from agent.knowledge.document_metadata_helpers import _stamp


def update_tags(
    store, collection: str, filename: str, tags: list[str] | None, *, document_id: str | None = None
) -> bool:
    import json

    from sqlalchemy import text

    tags_json = json.dumps(tags) if tags else None
    where, keyed = _match(filename, document_id)
    try:
        with store._sync_engine.connect() as conn:
            result = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"UPDATE {TABLE_NAME} SET tags = :tags{_stamp(document_id)} "
                    f"WHERE collection = :collection AND {where} "
                    "AND (tags_set_by IS NULL OR tags_set_by <> :person)"
                ),
                {"tags": tags_json, "collection": collection, **keyed, "person": TAGS_SET_BY_PERSON},
            )
            conn.commit()
            return (result.rowcount or 0) > 0
    except Exception as e:
        logger.warning("Failed to update tags for %s: %s", filename, e)
        return False


def set_tags_by_person(
    store, collection: str, filename: str, tags: list[str] | None, *, document_id: str | None = None
) -> bool:
    return store._set_person_list(collection, filename, "tags", tags, document_id=document_id)


def set_topics_by_person(
    store, collection: str, filename: str, topics: list[str] | None, *, document_id: str | None = None
) -> bool:
    return store._set_person_list(collection, filename, "topics", topics, document_id=document_id)


def get_person_tags_batch(
    store, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> dict[str, list[str]]:
    return store._person_list_batch(collection, filenames, "tags", document_ids=document_ids)


def get_person_topics_batch(
    store, collection: str, filenames: list[str], *, document_ids: list[str] | None = None
) -> dict[str, list[str]]:
    return store._person_list_batch(collection, filenames, "topics", document_ids=document_ids)


def get_topic_vocabulary(store, collection: str, limit: int = MAX_TOPIC_VOCABULARY) -> list[str]:
    from sqlalchemy import text

    try:
        with store._sync_engine.connect() as conn:
            rows = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(f"SELECT topics FROM {TABLE_NAME} WHERE collection = :collection AND topics IS NOT NULL"),
                {"collection": collection},
            )
            documents = [store._decode_tags(row[0]) or [] for row in rows]
    except Exception as e:
        logger.warning("Failed to read topic vocabulary for %s: %s", collection, e)
        return []

    from collections import Counter
    from collections import defaultdict

    documents_per_topic: Counter[str] = Counter()
    spellings: defaultdict[str, Counter[str]] = defaultdict(Counter)
    for topics in documents:
        first_spelling: dict[str, str] = {}
        for topic in topics:
            first_spelling.setdefault(topic.casefold(), topic)
        for key, spelling in first_spelling.items():
            documents_per_topic[key] += 1
            spellings[key][spelling] += 1

    ranked = sorted(documents_per_topic, key=lambda key: (-documents_per_topic[key], key))
    return [spellings[key].most_common(1)[0][0] for key in ranked[:limit]]


def _set_person_list(
    store, collection: str, filename: str, column: str, values: list[str] | None, *, document_id: str | None = None
) -> bool:
    import json

    from sqlalchemy import text

    value_json = json.dumps(values) if values else None
    where, keyed = _match(filename, document_id)
    try:
        with store._sync_engine.connect() as conn:
            result = conn.execute(
                # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                text(
                    f"UPDATE {TABLE_NAME} SET {column} = :value, tags_set_by = :person{_stamp(document_id)} "
                    f"WHERE collection = :collection AND {where}"
                ),
                {"value": value_json, "collection": collection, **keyed, "person": TAGS_SET_BY_PERSON},
            )
            conn.commit()
            return (result.rowcount or 0) > 0
    except Exception as e:
        logger.warning("Failed to set %s for %s: %s", column, filename, e)
        return False


def _person_list_batch(
    store, collection: str, filenames: list[str], column: str, *, document_ids: list[str] | None = None
) -> dict[str, list[str]]:
    asked = _batch_match(filenames, document_ids)
    if asked is None:
        return {}
    from sqlalchemy import text

    where, params = asked
    names, ids = set(filenames), set(document_ids or ())
    result: dict[str, list[str]] = {}
    try:
        with store._sync_engine.connect() as conn:
            rows = conn.execute(
                _batch_bind(
                    # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text
                    text(
                        f"SELECT filename, document_id, {column} FROM {TABLE_NAME} "
                        f"WHERE collection = :collection AND {where} AND tags_set_by = :person"
                    ),
                    params,
                ),
                {"collection": collection, **params, "person": TAGS_SET_BY_PERSON},
            )
            for row in rows:
                for key in _batch_keys(row[0], row[1], names, ids):
                    result[key] = store._decode_tags(row[2]) or []
    except Exception as e:
        logger.warning("Failed to batch-get person %s for %s: %s", column, collection, e)
        return {}
    return result
