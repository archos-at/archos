"""The knowledge context's vocabulary, held between the BFF's schema and the agent's constants (ADR-0175).

``test_knowledge_context_contract.py`` checks that the fixture is what the schema
allows and that the agent keeps every use. That passes when the BFF adds a
field or an enum value the agent has never heard of, because a dict keeps
whatever it is sent. Here every enum in ``knowledge-context.schema.json`` must
equal the agent's own constant, or be named below as one the agent does not
read, with the reason; and every property the BFF sends must be one the agent
reads, or be named as ignored. A field or a value added on one side alone fails
here, and whoever adds it decides what the agent makes of it.
"""

from __future__ import annotations

import dataclasses
import json
import re
from pathlib import Path
from typing import Any

from agent.citations.roles import SOURCE_REF_SCHEMES
from agent.common.knowledge_context import EDITION_ROLES
from agent.common.knowledge_context import GATE_STATES
from agent.common.knowledge_context import MAX_TEXT_CHARS
from agent.common.knowledge_context import QUALIFIERS
from agent.common.knowledge_context import ROUTE_VIAS
from agent.common.knowledge_context import EditionUse
from agent.common.knowledge_context import KnowledgeContext

ROOT = Path(__file__).parents[4]
SCHEMA = json.loads(
    (ROOT / "apps" / "workspace" / "tests" / "fixtures" / "knowledge-context.schema.json").read_text(encoding="utf-8")
)
CONTEXT = SCHEMA["$defs"]["KnowledgeContext"]

#: Each enum the agent reads, by its JSON Pointer in the schema, and the constant it reads it with.
READ_ENUMS: dict[str, tuple[str, ...]] = {
    "/properties/gate/properties/state": GATE_STATES,
    "/properties/uses/items/properties/role": EDITION_ROLES,
    "/properties/uses/items/properties/via": ROUTE_VIAS,
    "/properties/uses/items/properties/qualifier/anyOf/0": QUALIFIERS,
    "/properties/uses/items/properties/sourceRefs/items/properties/scheme": SOURCE_REF_SCHEMES,
}

#: Each enum the agent does not read yet, and why. Moving one to ``READ_ENUMS`` is the decision this file asks for.
UNREAD_ENUMS: dict[str, str] = {
    "/properties/gate/properties/reason/anyOf/0": "the agent answers a site_unknown gate the same for either reason",
    "/properties/gate/properties/leaves/items/properties/certainty": (
        "the gate already says what an unverified site may claim"
    ),
    "/properties/gate/properties/leaves/items/properties/coverage/anyOf/0": (
        "kept as the first leaf's coverage token, never branched on"
    ),
    "/properties/procedures/items/properties/referenceDates/additionalProperties/properties/basis": (
        "a reference day is read as its date or its basis, as a token for trace metadata"
    ),
    "/properties/undetermined/items/properties/reason": (
        "kept as a token in the trace metadata; the chain text words each reason"
    ),
    "/properties/uses/items/properties/freshness": "the chain text states it, and the role already carries it",
    "/properties/uses/items/properties/connectsBy/items": "the chain text states it, and the role already carries it",
    "/properties/uses/items/properties/labels/items": "the chain text states each",
}

#: The context's properties the agent reads, as ``KnowledgeContext`` holds them.
READ_KEYS: dict[str, str] = {
    "gate": "gate",
    "retrieval": "retrieval_countries",
    "chains": "chains",
    "packs": "packs",
    "uses": "uses",
    "procedures": "reference_dates",
    "date": "date",
    "updatedSinceLastAnswer": "updated_since_last_answer",
    "text": "text",
    "undetermined": "undetermined",
}

#: The context's properties the agent ignores, and why.
IGNORED_KEYS: dict[str, str] = {}

#: The use properties the agent ignores, and why; the rest are ``EditionUse``'s fields, camel-cased.
IGNORED_USE_KEYS: dict[str, str] = {
    "date": "the context's own date holds for every use",
    "freshness": "stated in the chain text; the role already carries its correction",
    "lastCheckedAt": "stated in the chain text",
    "connectsBy": "stated in the chain text; the role already carries its correction",
    "labels": "stated in the chain text",
}

#: EditionUse fields read from a use key on a wire this branch does not carry yet, and where it comes from.
FORWARD_USE_FIELDS: dict[str, str] = {
    "scope_unsettled": "applicability (ADR-0178, #1589); absent, the edition states no scope",
}


def _enums(node: Any, pointer: str = "") -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    if isinstance(node, dict):
        if "enum" in node:
            found[pointer] = node["enum"]
        for key, value in node.items():
            found |= _enums(value, f"{pointer}/{key}")
    elif isinstance(node, list):
        for index, value in enumerate(node):
            found |= _enums(value, f"{pointer}/{index}")
    return found


def _camel(name: str) -> str:
    return re.sub(r"_([a-z])", lambda match: match.group(1).upper(), name)


def test_every_enum_the_bff_sends_is_the_agent_s_constant_or_named_as_unread() -> None:
    enums = _enums(CONTEXT)
    assert sorted(enums) == sorted([*READ_ENUMS, *UNREAD_ENUMS])
    for pointer, constant in READ_ENUMS.items():
        assert enums[pointer] == list(constant), pointer


def test_every_property_of_the_context_is_read_or_named_as_ignored() -> None:
    fields = {field.name for field in dataclasses.fields(KnowledgeContext)}
    assert set(READ_KEYS.values()) <= fields
    assert sorted(CONTEXT["properties"]) == sorted([*READ_KEYS, *IGNORED_KEYS])


def test_every_property_of_a_use_is_read_or_named_as_ignored() -> None:
    read = {_camel(field.name) for field in dataclasses.fields(EditionUse) if field.name not in FORWARD_USE_FIELDS}
    sent = set(CONTEXT["properties"]["uses"]["items"]["properties"]) - {"applicability"}
    assert sorted(sent) == sorted(read | set(IGNORED_USE_KEYS))


def test_the_agent_keeps_the_whole_chain_text_the_bff_may_send() -> None:
    """A shorter bound here would cut the chain text mid-line, past the BFF's own "the rest is cut" line."""
    assert {"type": "string", "maxLength": MAX_TEXT_CHARS} in CONTEXT["properties"]["text"]["anyOf"]
