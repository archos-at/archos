from __future__ import annotations

from typing import Any

from agent.common.wire_v2 import CLIENT_MESSAGE
from agent.common.wire_v2 import HELLO
from agent.common.wire_v2 import WIRE_EVENT


def _consts_required(node: Any) -> None:
    if isinstance(node, list):
        for entry in node:
            _consts_required(entry)
        return
    if not isinstance(node, dict):
        return
    properties = node.get("properties")
    if isinstance(properties, dict):
        consts = [name for name, prop in properties.items() if isinstance(prop, dict) and "const" in prop]
        required = list(node.get("required", []))
        node["required"] = required + [name for name in consts if name not in required]
    for value in node.values():
        _consts_required(value)


def wire_json_schema() -> dict[str, Any]:
    events = WIRE_EVENT.json_schema(ref_template="#/$defs/{model}")
    clients = CLIENT_MESSAGE.json_schema(ref_template="#/$defs/{model}")
    hello = HELLO.json_schema(ref_template="#/$defs/{model}")
    defs = {**events.pop("$defs", {}), **clients.pop("$defs", {}), **hello.pop("$defs", {})}
    defs["WireEvent"] = events
    defs["ClientMessage"] = clients
    defs["Hello"] = hello
    _consts_required(defs)
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "Chat wire v2",
        "description": (
            "Generated from packages/agent/src/agent/common/wire_v2.py by scripts/generate_wire_schema.py. "
            "Do not edit by hand; packages/agent/tests/common/test_wire_v2.py fails when it is stale."
        ),
        "$defs": dict(sorted(defs.items())),
    }
