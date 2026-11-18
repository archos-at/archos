from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import os
import shutil
import subprocess
import threading
import time
import zipfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import openpyxl
import pytest

from agent import project_context
from agent.cards.registry import CardRegistry
from agent.cards.registry import reset_card_registry
from agent.cards.registry import set_card_registry
from agent.common import bff_http
from agent.tools.documents import draft_store
from agent.tools.documents import register as filing_tools
from agent.tools.documents.draft_store import DRAFT_ROOT
from agent.tools.documents.draft_store import draft_namespace
from agent.tools.execute.run import execute

pytestmark = pytest.mark.code_runner

REPO = Path(__file__).resolve().parents[5]
RUNNER_DIR = REPO / "apps" / "code-runner"
OFFICE = REPO / "packages" / "agent" / "src" / "agent" / "skills" / "builtin" / "office"

MEMO = OFFICE / "office-word" / "examples" / "1-memo.mjs"
AREA_SCHEDULE = OFFICE / "office-excel" / "examples" / "1-area-schedule.mjs"
CHART = OFFICE / "office-pdf-charts" / "examples" / "4-chart.mjs"

DOCX = f"{DRAFT_ROOT}Aktenvermerk.docx"
XLSX = f"{DRAFT_ROOT}Flaechenaufstellung.xlsx"
SVG = f"{DRAFT_ROOT}Kostenentwicklung.svg"

CONVERSATION = "conv-runner-e2e"
PROJECT = "3f8b0d2e-0000-4000-8000-0000000000e2"
SECRET = "runner-e2e-secret"  # noqa: S105 - test fixture value  # pragma: allowlist secret

RENAME_A_ROOM = """
import { readFile, writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";

export default async function () {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await readFile("/workspace/Flaechenaufstellung.xlsx"));
  workbook.getWorksheet("Flächen").getCell("B4").value = "Zimmer 2";
  await writeFile("/workspace/Flaechenaufstellung.xlsx", new Uint8Array(await workbook.xlsx.writeBuffer()));
  return { renamed: "Zimmer 2" };
}
"""

THROWS = 'export default async function () { throw new Error("Raum fehlt: Zimmer 3"); }'

LOOPS = "export default async function () { for (;;) {} }"


def _missing_toolchain() -> str | None:
    if shutil.which("node") is None:
        return "node is not on the PATH"
    if not (RUNNER_DIR / "node_modules" / "workerd").is_dir():
        return "the code runner's toolchain is not installed (task runner:install)"
    if not (RUNNER_DIR / "dist" / "worker.js").is_file():
        return "the code runner is not built (task runner:build)"
    return None


def _envelope() -> tuple[str, str]:
    raw = json.dumps(
        {
            "organizationId": "org_e2e",
            "userId": "user_e2e",
            "projectId": PROJECT,
            "conversationId": CONVERSATION,
            "issuedAt": 1_757_500_000_000,
        }
    )
    header = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")
    signature = hmac.new(SECRET.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    return header, signature


ENVELOPE_HEADER, ENVELOPE_SIG = _envelope()


class _Context:
    def __init__(self) -> None:
        self.metadata = type(
            "M",
            (),
            {
                "headers": {
                    project_context.PROJECT_ID_HEADER: PROJECT,
                    project_context.REQUEST_CONTEXT_ENVELOPE_HEADER: ENVELOPE_HEADER,
                    project_context.REQUEST_CONTEXT_ENVELOPE_SIG_HEADER: ENVELOPE_SIG,
                }
            },
        )()
        self.conversation_id = CONVERSATION


def _wait_for_port(process: subprocess.Popen[str]) -> int:
    assert process.stdout is not None
    line = process.stdout.readline()
    if not line:
        raise RuntimeError(f"the code runner exited before listening (code {process.wait()})")
    threading.Thread(target=process.stdout.read, daemon=True).start()
    return int(json.loads(line)["port"])


def _wait_healthy(url: str) -> None:
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            if httpx.get(f"{url}/health", timeout=2).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(0.1)
    raise RuntimeError("the code runner did not become healthy in 30 s")


@pytest.fixture(scope="module")
def runner_url(tmp_path_factory: pytest.TempPathFactory) -> Iterator[str]:
    missing = _missing_toolchain()
    if missing:
        pytest.skip(missing)
    env = {
        **os.environ,
        "PORT": "0",
        "HOST": "127.0.0.1",
        "CODE_RUNNER_SLOTS": "2",
        "CODE_RUNNER_STORAGE_DIR": str(tmp_path_factory.mktemp("code-runner-do")),
    }
    process = subprocess.Popen(  # noqa: S603 - fixed argv, the repository's own server
        ["node", "bin/server.mjs"],  # noqa: S607 - node from the PATH, as task runner:serve runs it
        cwd=RUNNER_DIR,
        env=env,
        stdout=subprocess.PIPE,
        text=True,
    )
    try:
        url = f"http://127.0.0.1:{_wait_for_port(process)}"
        _wait_healthy(url)
        yield url
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()


@pytest.fixture
def conversation(monkeypatch: pytest.MonkeyPatch) -> Iterator[CardRegistry]:
    from nat.plugin_api import Context

    monkeypatch.setenv("CHECKPOINT_DB", "")
    monkeypatch.setenv("INTERNAL_API_TOKEN", SECRET)
    monkeypatch.setattr(Context, "get", staticmethod(_Context))
    draft_store.reset_draft_stores()
    registry = CardRegistry()
    token = set_card_registry(registry)
    yield registry
    reset_card_registry(token)
    draft_store.reset_draft_stores()


async def _stored(path: str) -> dict[str, Any]:
    store = await draft_store.get_draft_store()
    item = await store.aget(draft_namespace(CONVERSATION), path)
    assert item is not None, f"{path} is not in the draft store"
    return item.value


def _bytes(value: dict[str, Any]) -> bytes:
    return draft_store.stored_bytes(value)


def _zip_text(data: bytes, member: str) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        assert "[Content_Types].xml" in archive.namelist()
        return archive.read(member).decode("utf-8")


def _sheet(data: bytes) -> list[tuple[Any, ...]]:
    workbook = openpyxl.load_workbook(io.BytesIO(data))
    assert workbook.sheetnames == ["Flächen"]
    return list(workbook["Flächen"].iter_rows(values_only=True))


def _bff(posted: list[tuple[dict[str, Any], dict[str, str]]]) -> Any:
    def post_json(path: str, body: Any, *, timeout: float, headers: dict[str, str] | None = None) -> Any:
        assert path == "/api/internal/document-versions"
        posted.append((body, dict(headers or {})))
        number = len(posted)
        return {
            "documentId": f"doc-{number}",
            "version": {"id": f"ver-{number}", "documentId": f"doc-{number}", "state": "draft", "contentHash": "h"},
        }

    return post_json


async def test_office_files_made_by_the_skills_land_in_the_drafts_and_file_into_the_project(
    runner_url: str, conversation: CardRegistry, monkeypatch: pytest.MonkeyPatch
) -> None:
    timings: dict[str, float] = {}
    reports: dict[str, str] = {}
    for name, script in (("memo", MEMO), ("area schedule", AREA_SCHEDULE), ("chart", CHART)):
        started = time.monotonic()
        reports[name] = await execute(runner_url, script.read_text(encoding="utf-8"))
        timings[name] = time.monotonic() - started

    for name, report in reports.items():
        assert report.startswith("status: ok"), f"{name}: {report}"
    assert DOCX in reports["memo"]
    assert '"total": 58.45' in reports["memo"]
    assert XLSX in reports["area schedule"]
    assert SVG in reports["chart"]

    memo = await _stored(DOCX)
    assert memo["encoding"] == "base64"
    assert memo[draft_store.VERSION_KEY] == 1
    document = _zip_text(_bytes(memo), "word/document.xml")
    for text in ("Aktenvermerk", "Küche", "Zimmer 1", "58,45", "Nächste Schritte"):
        assert text in document
    assert "Musterstraße 12" in _zip_text(_bytes(memo), "word/header1.xml")

    schedule = await _stored(XLSX)
    assert schedule["encoding"] == "base64"
    assert schedule[draft_store.VERSION_KEY] == 1
    worksheet = _zip_text(_bytes(schedule), "xl/worksheets/sheet1.xml")
    assert "<f>SUM(C2:C4)</f>" in worksheet
    assert "<v>58.45</v>" in worksheet
    rows = _sheet(_bytes(schedule))
    assert rows[0] == ("Geschoss", "Raum", "Fläche")
    assert rows[1:4] == [("EG", "Wohnen", 32.4), ("EG", "Küche", 11.2), ("OG", "Zimmer 1", 14.85)]
    assert rows[4][1:] == ("Summe", "=SUM(C2:C4)")

    chart = await _stored(SVG)
    assert chart["encoding"] == "utf-8"
    assert chart["content"].lstrip().startswith("<svg")
    assert "Kostenberechnung" in chart["content"]

    cards = [card for card in conversation.snapshot() if card["type"] == "document_draft"]
    assert {card["path"] for card in cards} == {DOCX, XLSX, SVG}

    started = time.monotonic()
    rewrite = await execute(runner_url, RENAME_A_ROOM)
    timings["rewrite"] = time.monotonic() - started
    assert rewrite.startswith("status: ok"), rewrite
    assert f"files written: {XLSX} (" in rewrite
    assert DOCX not in rewrite
    rewritten = await _stored(XLSX)
    assert rewritten[draft_store.VERSION_KEY] == 2
    assert rewritten["created_at"] == schedule["created_at"]
    assert _sheet(_bytes(rewritten))[3] == ("OG", "Zimmer 2", 14.85)
    assert (await _stored(DOCX))[draft_store.VERSION_KEY] == 1

    posted: list[tuple[dict[str, Any], dict[str, str]]] = []
    monkeypatch.setattr(bff_http, "post_json", _bff(posted))
    kinds = {
        DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        SVG: "image/svg+xml",
    }
    for path in kinds:
        answer = await filing_tools.run_file_draft(path)
        assert answer.startswith("Filed in the project"), answer

    for (payload, headers), (path, kind) in zip(posted, kinds.items(), strict=True):
        assert payload["op"] == "create_file"
        assert payload["projectId"] == PROJECT
        assert payload["filename"] == path.rsplit("/", 1)[-1]
        assert payload["contentType"] == kind
        assert base64.b64decode(payload["contentBase64"]) == _bytes(await _stored(path))
        assert headers == bff_http.SignedEnvelope(header=ENVELOPE_HEADER, signature=ENVELOPE_SIG).headers()
    assert _sheet(base64.b64decode(posted[1][0]["contentBase64"]))[3][1] == "Zimmer 2"

    print("runner e2e timings (s):", {name: round(seconds, 2) for name, seconds in timings.items()})


async def test_a_thrown_error_comes_back_on_stderr_and_keeps_nothing(
    runner_url: str, conversation: CardRegistry
) -> None:
    report = await execute(runner_url, THROWS)

    assert report.startswith("status: error")
    assert "Raum fehlt: Zimmer 3" in report
    assert "files written: none" in report
    store = await draft_store.get_draft_store()
    assert await store.asearch(draft_namespace(CONVERSATION)) == []


async def test_an_endless_loop_is_stopped_and_reported_as_a_timeout(
    runner_url: str, conversation: CardRegistry
) -> None:
    started = time.monotonic()
    report = await execute(runner_url, LOOPS, timeout_seconds=1)
    elapsed = time.monotonic() - started

    assert report.startswith("status: timeout"), report
    assert "did not stop at its time limit" in report
    assert "files written: none" in report
    assert elapsed < 30

    after = await execute(runner_url, "export default async function () { return 6 * 7; }")
    assert after.startswith("status: ok")
    assert "value: 42" in after
