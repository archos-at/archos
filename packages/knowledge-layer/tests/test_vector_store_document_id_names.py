from __future__ import annotations

from unittest.mock import MagicMock

from knowledge_layer.vector_store import DOCUMENT_ID_FIELD
from knowledge_layer.vector_store import ENRICHED_FIELDS
from knowledge_layer.vector_store import INDEXED_FIELDS
from knowledge_layer.vector_store import KEYWORD_FIELDS
from knowledge_layer.vector_store import LEGACY_DOCUMENT_ID_FIELD
from knowledge_layer.vector_store import STORE_ONLY_FIELDS
from knowledge_layer.vector_store import enrichment
from knowledge_layer.vector_store import ensure_payload_indexes
from qdrant_client import models


def test_the_job_document_id_is_written_under_both_names_with_one_value():
    written = enrichment("proj_1", {"organization_id": "org_1", "document_id": "doc-1"})

    assert written[DOCUMENT_ID_FIELD] == "doc-1"
    assert written[LEGACY_DOCUMENT_ID_FIELD] == "doc-1"


def test_a_job_without_a_document_id_writes_neither_name():
    written = enrichment("proj_1", {"organization_id": "org_1"})

    assert written[DOCUMENT_ID_FIELD] is None
    assert written[LEGACY_DOCUMENT_ID_FIELD] is None


def test_the_document_id_is_a_keyword_field():
    assert DOCUMENT_ID_FIELD in KEYWORD_FIELDS


def test_ensure_payload_indexes_creates_the_document_id_index_on_a_collection_made_before_it():
    client = MagicMock()
    client.get_collection.return_value.payload_schema = {
        name: MagicMock() for name in INDEXED_FIELDS - {DOCUMENT_ID_FIELD}
    }

    assert ensure_payload_indexes(client, "office_v1") == [DOCUMENT_ID_FIELD]
    made = {call.args[1]: call.kwargs["field_schema"] for call in client.create_payload_index.call_args_list}
    assert made == {DOCUMENT_ID_FIELD: models.PayloadSchemaType.KEYWORD}


def test_both_names_are_enriched_and_hits_read_the_new_one():
    assert {LEGACY_DOCUMENT_ID_FIELD, DOCUMENT_ID_FIELD} <= ENRICHED_FIELDS
    assert LEGACY_DOCUMENT_ID_FIELD in STORE_ONLY_FIELDS
    assert DOCUMENT_ID_FIELD not in STORE_ONLY_FIELDS
