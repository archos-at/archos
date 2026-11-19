from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator

from agent.cards.workspace_cards import DocumentVersionState
from agent.tools.documents import register as filing_tools

from .conftest import DRAFT
from .conftest import _edit
from .conftest import _responder
from .conftest import _version
from .conftest import _write

SCHEMA_PATH = (
    Path(__file__).resolve().parents[5] / "apps" / "workspace" / "tests" / "fixtures" / "document-lifecycle.schema.json"
)


@pytest.fixture(scope="module")
def schema() -> dict[str, Any]:
    with SCHEMA_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def _validator(schema: dict[str, Any], name: str) -> Draft202012Validator:
    return Draft202012Validator({**schema["$defs"][name], "$defs": schema["$defs"]})


class TestTheRequestBodies:
    async def test_the_fixture_is_where_the_contract_lives(self, schema: dict[str, Any]) -> None:
        assert "internalDocumentVersionRequest" in schema["$defs"]

    async def test_create_validates(self, schema, _one_store, monkeypatch, calls) -> None:
        await _write(_one_store)
        monkeypatch.setattr(
            filing_tools,
            "post_document_version",
            _responder([{"documentId": "doc-1", "version": _version("ver-1", "draft", "h1")}], calls),
        )
        await filing_tools.run_file_draft(DRAFT)

        _validator(schema, "internalDocumentVersionRequest").validate(calls[0][0])

    async def test_update_validates(self, schema, _one_store, monkeypatch, calls) -> None:
        await _write(_one_store)
        monkeypatch.setattr(
            filing_tools,
            "post_document_version",
            _responder(
                [
                    {"documentId": "doc-1", "version": _version("ver-1", "draft", "h1")},
                    {"documentId": "doc-1", "version": _version("ver-1", "draft", "h2")},
                ],
                calls,
            ),
        )
        await filing_tools.run_file_draft(DRAFT)
        await _edit(_one_store, "42 m", "38 m")
        await filing_tools.run_file_draft(DRAFT)

        assert calls[1][0]["op"] == "update"
        _validator(schema, "internalDocumentVersionRequest").validate(calls[1][0])


class TestTheResponseShape:
    def test_every_field_the_tool_reads_is_in_the_version_view(self, schema: dict[str, Any]) -> None:
        properties = schema["$defs"]["documentVersionView"]["properties"]
        for field in ("id", "documentId", "state", "contentHash"):
            assert field in properties, field

    def test_the_card_knows_exactly_the_states_the_schema_does(self, schema: dict[str, Any]) -> None:
        from typing import get_args

        wire = schema["$defs"]["documentVersionView"]["properties"]["state"]["enum"]
        assert set(get_args(DocumentVersionState)) == set(wire)
