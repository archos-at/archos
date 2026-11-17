from __future__ import annotations

import json
import os
from collections.abc import Callable
from typing import Any

ENV = "EVAL_USER_MESSAGE"
ABILITIES = frozenset({"given_box", "canvas", "trigger"})
MESSAGE_ID = "eval-turn"
CONVERSATION_ID = "eval-conversation"


def message_fields(row: dict[str, Any]) -> dict[str, Any] | None:
    if row.get("trigger"):
        return trigger_fields(row)
    if row.get("open"):
        return open_fields(row)
    if row.get("box") != "given":
        return None
    gold = row.get("gold") or []
    if isinstance(gold, dict):
        gold = [gold]
    if not gold:
        raise ValueError(f"{row.get('id')}: box: given needs a gold, which names the open document and page")
    x, y, w, h = (float(part) for part in row["region"])
    return {
        "focus_file_name": str(gold[0]["document"]),
        "focus_shelf": "project",
        "focus_region": {"page": int(gold[0]["page"]), "x": x, "y": y, "w": w, "h": h},
    }


def trigger_fields(row: dict[str, Any]) -> dict[str, Any]:
    import fixture_files

    if row["trigger"] != "new_document" or not row.get("focus_document"):
        raise ValueError(f"{row.get('id')}: trigger: new_document needs `focus_document`, the uploaded file")
    name = str(row["focus_document"])
    project = fixture_files.load_project()
    if name not in project.names:
        raise ValueError(f"{row.get('id')}: {name} is not in the fixture project")
    return {
        "focus_file_name": name,
        "focus_shelf": "project",
        "focus_document_id": fixture_files.document_id(project, name),
        "trigger": {"kind": "new_document", "event_id": str(row["id"]), "annotation_id": None},
    }


def open_fields(row: dict[str, Any]) -> dict[str, Any]:
    import fixture_files

    name = str(row["open"])
    project = fixture_files.load_project()
    if name not in project.names:
        raise ValueError(f"{row.get('id')}: open: {name} is not in the fixture project")
    return {
        "focus_file_name": name,
        "focus_shelf": "project",
        "focus_document_id": fixture_files.document_id(project, name),
    }


def env_for(row: dict[str, Any]) -> dict[str, str]:
    fields = message_fields(row)
    return {ENV: json.dumps(fields)} if fields else {}


def user_message(question: str, fields: dict[str, Any]) -> Any:
    from agent.common.wire_v2 import UserMessage

    return UserMessage(message_id=MESSAGE_ID, conversation_id=CONVERSATION_ID, text=question, **fields)


def wrapped(original: Callable[[Any], Any], fields: dict[str, Any]) -> Callable[[Any], Any]:

    def extract_turn_inputs(request: Any) -> Any:
        if isinstance(request, str):
            request = user_message(request, fields)
        return original(request)

    return extract_turn_inputs


def install(environ: dict[str, str] | None = None) -> bool:
    raw = (os.environ if environ is None else environ).get(ENV)
    if not raw:
        return False
    from agent.turn import payload

    payload.extract_turn_inputs = wrapped(payload.extract_turn_inputs, json.loads(raw))
    return True
