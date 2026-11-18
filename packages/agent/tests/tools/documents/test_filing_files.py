from __future__ import annotations

import base64

from agent.tools.documents import register as filing_tools
from agent.tools.documents.draft_store import DRAFT_ROOT
from agent.tools.documents.draft_store import DraftBackend

from .conftest import CONVERSATION
from .conftest import PROJECT
from .conftest import _responder
from .conftest import _version

XLSX = f"{DRAFT_ROOT}flaechen.xlsx"
CSV = f"{DRAFT_ROOT}flaechen.csv"
BYTES = b"PK\x03\x04 a workbook \xff\x00"


async def _run_file(store, path: str = XLSX, data: bytes = BYTES) -> None:  # noqa: ANN001
    backend = DraftBackend(store=store, conversation_id=CONVERSATION)
    assert await backend.awrite_run_file(path, data, previous_size=0) is None


async def _file(monkeypatch, responses: list[dict], calls: list, path: str = XLSX) -> str:  # noqa: ANN001
    monkeypatch.setattr(filing_tools, "post_document_version", _responder(responses, calls))
    return await filing_tools.run_file_draft(path)


class TestFilingAFileAScriptWrote:
    async def test_it_posts_create_file_with_the_bytes_and_their_type(self, _one_store, monkeypatch, calls) -> None:
        await _run_file(_one_store)
        await _file(monkeypatch, [{"documentId": "doc-1", "version": _version("ver-1", "draft", "h1")}], calls)

        payload, _ = calls[0]
        assert payload["op"] == "create_file"
        assert payload["projectId"] == PROJECT
        assert payload["filename"] == "flaechen.xlsx"
        assert payload["contentType"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        assert base64.b64decode(payload["contentBase64"]) == BYTES
        assert "content" not in payload

    async def test_a_second_filing_replaces_the_bytes_with_update_file(self, _one_store, monkeypatch, calls) -> None:
        await _run_file(_one_store)
        await _file(monkeypatch, [{"documentId": "doc-1", "version": _version("ver-1", "draft", "h1")}], calls)
        await _run_file(_one_store, data=BYTES + b"more")
        await _file(
            monkeypatch,
            [
                {"documentId": "doc-1", "version": _version("ver-1", "draft", "h1")},
                {"documentId": "doc-1", "version": _version("ver-1", "draft", "h2")},
            ],
            calls,
        )

        payload, _ = calls[1]
        assert payload["op"] == "update_file"
        assert payload["ifMatch"] == "h1"
        assert base64.b64decode(payload["contentBase64"]) == BYTES + b"more"

    async def test_a_type_the_project_does_not_take_is_refused_before_any_call(
        self, _one_store, monkeypatch, calls
    ) -> None:
        await _run_file(_one_store, path=CSV, data="Raum;Fläche\n".encode())
        message = await _file(monkeypatch, [], calls, path=CSV)

        assert calls == []
        assert "cannot be filed" in message


class TestFilingIsMeasured:
    async def test_the_first_filing_of_a_run_file_is_scored_once(self, _one_store, monkeypatch, calls) -> None:
        emitted: list = []
        monkeypatch.setattr(filing_tools, "emit_scores", lambda scores, **kwargs: emitted.append((scores, kwargs)))
        await _run_file(_one_store)
        await _file(monkeypatch, [{"documentId": "doc-1", "version": _version("ver-1", "draft", "h1")}], calls)
        await _run_file(_one_store, data=BYTES + b"more")
        await _file(
            monkeypatch,
            [
                {"documentId": "doc-1", "version": _version("ver-1", "draft", "h1")},
                {"documentId": "doc-1", "version": _version("ver-1", "draft", "h2")},
            ],
            calls,
        )

        assert [(score.name, score.value) for scores, _ in emitted for score in scores] == [
            ("execute-files-filed", 1.0)
        ]
        assert emitted[0][1]["writer"] == "file-draft"

    async def test_a_written_draft_is_not_scored(self, _one_store, monkeypatch, calls) -> None:
        emitted: list = []
        monkeypatch.setattr(filing_tools, "emit_scores", lambda scores, **kwargs: emitted.append(scores))
        backend = DraftBackend(store=_one_store, conversation_id=CONVERSATION)
        assert (await backend.awrite(f"{DRAFT_ROOT}notiz.md", "# Notiz\n")).error is None
        await _file(
            monkeypatch,
            [{"documentId": "doc-2", "version": _version("ver-1", "draft", "h1")}],
            calls,
            path=f"{DRAFT_ROOT}notiz.md",
        )

        assert emitted == []
