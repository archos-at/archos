from __future__ import annotations

import json
import runpy
from pathlib import Path

import pytest
from knowledge_layer.vector_store import DOCUMENT_ID_FIELD
from knowledge_layer.vector_store import get_store
from knowledge_layer.vector_store import schema
from knowledge_layer_testing.vector_store import DIM
from knowledge_layer_testing.vector_store import IDENTITY
from knowledge_layer_testing.vector_store import record
from knowledge_layer_testing.vector_store import write

ROOT = Path(__file__).resolve().parents[3]
REGISTRY = ROOT / "apps" / "workspace" / "backfills"
SCOPE = "proj_registered_backfill"


def _registered() -> list[tuple[str, list[str]]]:
    found = []
    for manifest in sorted(REGISTRY.glob("*/backfill.json")):
        entry = json.loads(manifest.read_text(encoding="utf-8"))
        if entry["kind"] == "qdrant":
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


def _count_lines(out: str, mode: str) -> list[dict]:
    raw = [line for line in out.splitlines() if line.startswith("{")]
    assert all(line.startswith('{"event":"backfill.count",') for line in raw), raw
    lines = [json.loads(line) for line in raw]
    return [line for line in lines if line.get("event") == "backfill.count" and line.get("mode") == mode]


def test_a_qdrant_backfill_is_registered():
    assert [name for name, _ in _registered()] == ["qdrant-document-id"]


@pytest.mark.parametrize(("name", "command"), _registered())
def test_each_registered_qdrant_backfill_runs_twice_as_the_deploy_job_does(name, command, fresh_qdrant_store, capsys):
    write(SCOPE, [record(f"alt {index}", "alt.pdf") for index in range(3)], {"document_id": "doc_old"})
    store = get_store()
    ids = [point.id for point in store.scroll(SCOPE, {"file_name": "alt.pdf"})]
    store.client.delete_payload(store.alias(SCOPE), keys=[DOCUMENT_ID_FIELD], points=ids, wait=True)
    schema.ensure_collection(store.client, schema.Physical.CORPUS, DIM, IDENTITY)

    assert _deploy_sequence(command) == [0, 0, 0], f"{name}: dry run, apply, check"
    first = capsys.readouterr().out
    assert _deploy_sequence(command) == [0, 0, 0], f"{name}: a second deploy"
    second = capsys.readouterr().out

    assert sum(line["written"] for line in _count_lines(first, "apply")) == 3
    assert all(line["after"] == 0 and line["disagree"] == 0 for line in _count_lines(first, "check"))
    assert all(line["before"] == 0 and line["written"] == 0 for line in _count_lines(second, "apply"))


@pytest.mark.parametrize(("name", "command"), _registered())
def test_the_check_fails_while_a_point_is_left(name, command, fresh_qdrant_store, capsys):
    write(SCOPE, [record("alt", "alt.pdf")], {"document_id": "doc_old"})
    store = get_store()
    ids = [point.id for point in store.scroll(SCOPE, {"file_name": "alt.pdf"})]
    store.client.delete_payload(store.alias(SCOPE), keys=[DOCUMENT_ID_FIELD], points=ids, wait=True)
    schema.ensure_collection(store.client, schema.Physical.CORPUS, DIM, IDENTITY)

    assert _main(command)([*command[2:], "--check"]) == 1, name
