from __future__ import annotations

import json
import runpy
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs
from urllib.parse import urlparse

import pytest
from knowledge_layer.vector_store import DOCUMENT_ID_FIELD
from knowledge_layer.vector_store import get_store
from knowledge_layer_testing.vector_store import record
from knowledge_layer_testing.vector_store import write

from agent.knowledge.document_metadata_store import DocumentMetadataStore

ROOT = Path(__file__).resolve().parents[3]
REGISTRY = ROOT / "apps" / "workspace" / "backfills"
SCOPE = "proj_registered_backend_backfill"
DOCUMENT_ID = "5d0c1c2e-0000-4000-8000-000000000001"
TOKEN = "backfill-test-token"  # pragma: allowlist secret


def _registered() -> list[tuple[str, list[str]]]:
    found = []
    for manifest in sorted(REGISTRY.glob("*/backfill.json")):
        entry = json.loads(manifest.read_text(encoding="utf-8"))
        if entry["kind"] == "backend":
            found.append((manifest.parent.name, entry["command"]))
    return found


def _main(command: list[str]):
    interpreter, script, *_ = command
    assert interpreter == "python", "the Job runs the command in the backend image's interpreter"
    assert script.startswith("/app/"), "the backend image holds the repository under /app"
    path = ROOT / script.removeprefix("/app/")
    assert path.is_file(), f"{path} is not in the repository"
    return runpy.run_path(str(path), run_name="registered_backfill")["main"]


def _deploy_sequence(command: list[str]) -> list[int]:
    main, args = _main(command), command[2:]
    codes = []
    for extra in ([], ["--apply"], ["--check"]):
        codes.append(main([*args, *extra]))
        if codes[-1]:
            break
    return codes


def _lines(out: str, event: str, mode: str) -> list[dict]:
    raw = [line for line in out.splitlines() if line.startswith("{")]
    assert all(line.startswith(('{"event":"backfill.count",', '{"event":"backfill.unmatched",')) for line in raw), raw
    return [line for line in map(json.loads, raw) if line["event"] == event and line.get("mode") == mode]


def _count_lines(out: str, mode: str) -> list[dict]:
    return _lines(out, "backfill.count", mode)


class _Bff(BaseHTTPRequestHandler):
    documents: dict[str, list[dict]] = {}
    asked: list[str] = []

    def do_GET(self) -> None:  # noqa: N802 - the http.server hook
        url = urlparse(self.path)
        if url.path != "/api/internal/document-ids" or self.headers.get("X-Internal-Token") != TOKEN:
            self.send_error(404 if url.path != "/api/internal/document-ids" else 401)
            return
        collection = parse_qs(url.query)["collection"][0]
        self.asked.append(collection)
        body = json.dumps({"documents": self.documents.get(collection, [])}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args) -> None:
        return


@pytest.fixture
def bff(monkeypatch) -> Iterator[type[_Bff]]:
    _Bff.documents = {SCOPE: [{"id": DOCUMENT_ID, "filename": "alt.pdf", "folderId": None}]}
    _Bff.asked = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Bff)
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
    thread.start()
    monkeypatch.setenv("FRONTEND_INTERNAL_URL", f"http://127.0.0.1:{server.server_port}")
    monkeypatch.setenv("INTERNAL_API_TOKEN", TOKEN)
    yield _Bff
    server.shutdown()
    server.server_close()


@pytest.fixture
def legacy_user_document(fresh_qdrant_store, bff, tmp_path, monkeypatch) -> Iterator[str]:
    url = f"sqlite:///{tmp_path / 'metadata.db'}"
    monkeypatch.setenv("SUMMARY_DB", url)
    DocumentMetadataStore(url).register(SCOPE, "alt.pdf", "Ältere Fassung.")
    write(SCOPE, [record(f"alt {index}", "alt.pdf") for index in range(3)])
    yield url
    DocumentMetadataStore.dispose_engine(url)
    DocumentMetadataStore._tables_initialized.discard(url)


def test_both_document_id_backfills_are_registered():
    assert [name for name, _ in _registered()] == ["document-metadata-document-id", "qdrant-document-id-stamp"]


@pytest.mark.parametrize(("name", "command"), _registered())
def test_each_registered_backend_backfill_runs_twice_as_the_deploy_job_does(
    name, command, legacy_user_document, capsys
):
    assert _deploy_sequence(command) == [0, 0, 0], f"{name}: dry run, apply, check"
    first = capsys.readouterr().out
    assert _deploy_sequence(command) == [0, 0, 0], f"{name}: a second deploy"
    second = capsys.readouterr().out

    assert sum(line["written"] for line in _count_lines(first, "apply")) >= 1
    assert all(line["after"] == 0 for line in _count_lines(first, "check"))
    assert all(line["before"] == 0 and line["written"] == 0 for line in _count_lines(second, "apply"))
    [document] = DocumentMetadataStore(legacy_user_document).get_all(SCOPE)
    points = get_store().scroll(SCOPE, {"file_name": "alt.pdf"})
    if name == "document-metadata-document-id":
        assert document.document_id == DOCUMENT_ID
    else:
        assert {(point.payload or {}).get(DOCUMENT_ID_FIELD) for point in points} == {DOCUMENT_ID}


@pytest.mark.parametrize(("name", "command"), _registered())
def test_the_check_fails_while_a_user_document_lacks_its_id(name, command, legacy_user_document):
    assert _main(command)([*command[2:], "--check"]) == 1, name


def test_the_stamp_check_fails_while_two_live_documents_hold_the_name_of_a_point_without_an_id(
    legacy_user_document, bff, capsys
):
    bff.documents[SCOPE].append({"id": "5d0c1c2e-0000-4000-8000-000000000002", "filename": "alt.pdf", "folderId": "f"})
    command = dict(_registered())["qdrant-document-id-stamp"]

    assert _deploy_sequence(command) == [0, 1], "dry run, apply"
    [applied] = _count_lines(capsys.readouterr().out, "apply")
    assert (applied["after"], applied["unmatched_held"]) == (0, 3)
    assert _main(command)([*command[2:], "--check"]) == 1


@pytest.mark.parametrize(("name", "command"), _registered())
def test_a_bff_without_the_route_stops_the_backfill(name, command, legacy_user_document, monkeypatch, capsys):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "not-the-token")

    assert _main(command)(command[2:]) == 2, name
    assert '"event":"backfill.failed"' in capsys.readouterr().out


@pytest.mark.parametrize(("name", "command"), _registered())
def test_each_scope_with_unmatched_items_says_why_without_naming_a_file(
    name, command, legacy_user_document, bff, capsys
):
    erased = "proj_registered_backend_backfill_erased"
    DocumentMetadataStore(legacy_user_document).register(SCOPE, "Geheimprojekt Villa.pdf", "Gelöscht.")
    DocumentMetadataStore(legacy_user_document).register(erased, "Notiz.pdf", "Gespräch.")
    write(SCOPE, [record("weg", "Geheimprojekt Villa.pdf")])
    write(erased, [record(f"Gespräch {index}", "Notiz.pdf") for index in range(2)])

    assert _main(command)(command[2:]) == 0
    out = capsys.readouterr().out

    unit = "rows" if name == "document-metadata-document-id" else "points"
    found = {(line["scope"], line["reason"], line[unit]) for line in _lines(out, "backfill.unmatched", "dry-run")}
    assert found == {(SCOPE, "no_holder", 1), (erased, "no_documents_in_collection", 1 if unit == "rows" else 2)}
    assert all(line["backfill"] == name for line in _lines(out, "backfill.unmatched", "dry-run"))
    assert "Geheimprojekt" not in out and "Notiz" not in out
