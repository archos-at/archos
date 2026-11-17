from __future__ import annotations

import ast
import difflib
import json
import os

import pytest
from agent_testing.model_facing_text import REGENERATE
from agent_testing.model_facing_text import REGENERATE_ENV
from agent_testing.model_facing_text import SCHEMA_ARGUMENT
from agent_testing.model_facing_text import SNAPSHOT
from agent_testing.model_facing_text import SOURCE_ROOTS
from agent_testing.model_facing_text import live
from agent_testing.model_facing_text import render

FORWARDED_SCHEMA_PARAMETERS = frozenset({"schema", "reply_model"})


@pytest.fixture(scope="module")
def entries() -> dict:
    return live()


def _lines(value: object) -> list[str]:
    text = value if isinstance(value, str) else json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False)
    return text.splitlines()


def _diff(stored: dict, current: dict) -> str:
    parts: list[str] = []
    for key in sorted(set(stored) | set(current)):
        before, after = stored.get(key), current.get(key)
        if before == after:
            continue
        if before is None or after is None:
            parts.append(f"{'added' if before is None else 'removed'}: {key}")
            continue
        for field in sorted(set(before) | set(after)):
            if before.get(field) != after.get(field):
                diff = difflib.unified_diff(
                    _lines(before.get(field)),
                    _lines(after.get(field)),
                    f"snapshot {key} {field}",
                    f"live {key} {field}",
                    lineterm="",
                )
                parts.append("\n".join(diff))
    return "\n\n".join(parts)


def test_what_the_model_reads_matches_the_snapshot(entries: dict) -> None:
    if os.environ.get(REGENERATE_ENV):
        SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
        SNAPSHOT.write_text(render(entries), encoding="utf-8")
    stored = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    assert stored == entries, (
        f"The text the model is sent changed.\n\n{_diff(stored, entries)}\n\n"
        f"If that is intended, regenerate the snapshot: {REGENERATE}"
    )
    assert SNAPSHOT.read_text(encoding="utf-8") == render(entries), f"Snapshot not in canonical form: {REGENERATE}"


def test_every_mechanism_is_enumerated(entries: dict) -> None:
    prefixes = {key.rsplit(":", 1)[0] if key.startswith("tool:") else key.split(":")[0] for key in entries}
    assert {
        "tool:chat",
        "tool:chat.files.estate+drafts+skills",
        "tool:deep_research.researcher",
        "tool:deep_research.orchestrator",
        "tool:deep_research.source_router",
        "tool:intake",
        "tool:clarifier",
        "tool:web_search_without_key",
        "backend_tool",
        "response_format",
        "prompt",
        "card",
        "card_catalog",
    } <= prefixes
    assert len([key for key in entries if key.startswith("tool:chat:")]) >= 20
    assert len([key for key in entries if key.startswith("card:")]) >= 20


def _schema_names() -> set[tuple[str, str]]:
    found: set[tuple[str, str]] = set()
    for root in SOURCE_ROOTS:
        for path in sorted(root.rglob("*.py")):
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if not isinstance(node, ast.Call):
                    continue
                func = node.func
                name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
                index = SCHEMA_ARGUMENT.get(name or "")
                if index is None or len(node.args) <= index:
                    continue
                argument = node.args[index]
                if isinstance(argument, ast.Name):
                    found.add((name or "", argument.id))
    return found


def test_every_structured_output_schema_is_in_the_snapshot(entries: dict) -> None:
    snapshotted = {key.split(":", 1)[1].split("[")[0] for key in entries if key.startswith("response_format:")}
    missing = sorted(
        (call, schema)
        for call, schema in _schema_names()
        if schema not in snapshotted and schema not in FORWARDED_SCHEMA_PARAMETERS
    )
    assert missing == [], (
        f"A structured-output schema the snapshot does not hold; add it to model_facing_text: {missing}"
    )
