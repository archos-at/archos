import json
import logging
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from agent.knowledge.schema import IngestionJobStatus

from . import collection_catalog
from .stored_names import _normalized_file_name
from .stored_names import _stored_spellings

logger = logging.getLogger(__name__)


@dataclass
class _PreviousVersion:
    chunk_ids: list[str] = field(default_factory=list)
    stored_names: list[str] = field(default_factory=list)
    preserved: dict[str, str] = field(default_factory=dict)


def _tmp_upload_names(collection_name: str, spellings: list[str]) -> list[str]:
    from agent.knowledge import find_tmp_upload_names

    try:
        return list(find_tmp_upload_names(collection_name, spellings))
    except Exception:  # noqa: BLE001 — it only adds legacy spellings; their version stays beside the re-upload
        logger.warning(
            "Could not read the tmp-prefixed names in %s; a legacy version may stay beside its re-upload",
            collection_name,
            exc_info=True,
        )
        return []


def _human_set_fields(collection_name: str, stored_names: list[str]) -> tuple[tuple[str, dict[str, Any]], ...]:
    from agent.knowledge import get_document_display_titles
    from agent.knowledge import get_document_doc_classes
    from agent.knowledge import get_document_folder_paths
    from agent.knowledge import get_document_person_tags
    from agent.knowledge import get_document_person_topics
    from agent.knowledge import get_document_revision_suggestions
    from agent.knowledge import get_document_superseded_by

    person_tags = {
        stored: json.dumps(tags) for stored, tags in get_document_person_tags(collection_name, stored_names).items()
    }
    person_topics = {
        stored: json.dumps(topics)
        for stored, topics in get_document_person_topics(collection_name, stored_names).items()
    }
    return (
        ("doc_class", get_document_doc_classes(collection_name, stored_names)),
        ("display_title", get_document_display_titles(collection_name, stored_names)),
        ("folder_path", get_document_folder_paths(collection_name, stored_names)),
        ("tags", person_tags),
        ("topics", person_topics),
        ("superseded_by", get_document_superseded_by(collection_name, stored_names)),
        ("revision_suggestion", get_document_revision_suggestions(collection_name, stored_names)),
    )


def _preserve(found: dict[str, _PreviousVersion], name: str, values: dict[str, Any]) -> None:
    for stored, value in values.items():
        version = found.get(_normalized_file_name(stored))
        if version is not None:
            version.preserved.setdefault(name, value)


def _read_human_set_fields(collection_name: str, found: dict[str, _PreviousVersion]) -> None:
    try:
        stored_names = [stored for version in found.values() for stored in version.stored_names]
        for name, values in _human_set_fields(collection_name, stored_names):
            _preserve(found, name, values)
    except Exception:  # noqa: BLE001 — losing them must not keep the old chunks
        logger.warning("Could not read the previous versions' metadata; re-deriving it", exc_info=True)


def _versions_by_name(chunks: list[tuple[str, str]], targets: set[str]) -> dict[str, _PreviousVersion]:
    found: dict[str, _PreviousVersion] = {}
    for chunk_id, stored in chunks:
        if _normalized_file_name(stored) not in targets:
            continue
        version = found.setdefault(_normalized_file_name(stored), _PreviousVersion())
        version.chunk_ids.append(chunk_id)
        if stored not in version.stored_names:
            version.stored_names.append(stored)
    return found


class VersionReplacement:
    def _find_previous_versions(self, collection_name: str, incoming_names: list[str]) -> dict[str, _PreviousVersion]:
        from knowledge_layer.vector_store import with_retry

        targets = {_normalized_file_name(name) for name in incoming_names if name}
        targets.discard("")
        if not targets:
            return {}
        spellings = {spelling for name in incoming_names if name for spelling in _stored_spellings(name)}
        spellings.update(_tmp_upload_names(collection_name, sorted(spellings)))
        chunks = with_retry(
            f"read the previous versions in {collection_name}",
            lambda: self._chunk_ids_of(collection_name, sorted(spellings)),
        )
        found = _versions_by_name(chunks, targets)
        if found:
            _read_human_set_fields(collection_name, found)
        return found

    def _retire_previous_version(
        self, collection_name: str, file_name: str, previous: _PreviousVersion | None, written: list[str] | None = None
    ) -> None:
        if previous is None or not previous.chunk_ids:
            return
        try:
            self._remove_previous_version(collection_name, file_name, previous, written)
        except Exception:  # noqa: BLE001 — the new version is in; retiring the old must not fail it
            logger.warning(
                "Could not remove the previous version of %s after ingest; duplicate chunks may remain",
                file_name,
                exc_info=True,
            )

    def _remove_previous_version(
        self, collection_name: str, file_name: str, previous: _PreviousVersion, written: list[str] | None
    ) -> None:
        from agent.knowledge import unregister_summary

        from .chunk_identity import ids_only_in

        self._store().delete_chunks(collection_name, ids_only_in(previous.chunk_ids, written))
        collection_catalog.bump_collection_version(collection_name)
        for stored in previous.stored_names:
            if stored != file_name:
                unregister_summary(collection_name, stored, permanent=True)
        logger.info(
            "Replaced previous version(s): removed %d chunk(s) of %s from %s after re-ingest",
            len(previous.chunk_ids),
            sorted(previous.stored_names),
            collection_name,
        )

    def _quarantined(self, job: IngestionJobStatus, file_index: int) -> bool:
        with self._lock:
            return file_index < len(job.file_details) and job.file_details[file_index].screening == "quarantined"

    def _retire_held_predecessor(self, collection_name: str, file_name: str, previous: _PreviousVersion) -> None:
        if not previous.chunk_ids:
            return
        try:
            self._store().delete_chunks(collection_name, previous.chunk_ids)
            collection_catalog.bump_collection_version(collection_name)
            logger.info(
                "Took %d chunk(s) of the previous version of a quarantined re-upload out of %s",
                len(previous.chunk_ids),
                collection_name,
            )
        except Exception:  # noqa: BLE001 — the verdict stands; a failed retire must not mask it
            logger.warning(
                "Could not take the previous version of a quarantined re-upload out of %s; it still answers",
                collection_name,
                exc_info=True,
            )

    def _discard_partial_version(
        self, collection_name: str, file_name: str, attempted: list[str] | None, kept: _PreviousVersion | None = None
    ) -> None:
        from .chunk_identity import ids_only_in

        attempted = ids_only_in(attempted or [], kept.chunk_ids if kept is not None else None)
        if not attempted:
            return
        try:
            self._store().delete_chunks(collection_name, attempted)
            collection_catalog.bump_collection_version(collection_name)
            logger.warning(
                "Discarded up to %d chunk(s) a failed ingest of %s left in %s",
                len(attempted),
                file_name,
                collection_name,
            )
        except Exception:  # noqa: BLE001 — the file already reads FAILED; this must not mask why
            logger.warning(
                "Could not discard the partial chunks of %s; they sit beside the kept version", file_name, exc_info=True
            )
