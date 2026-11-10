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

from agent.citations.roles import EDITION_ROLES
from agent.citations.roles import ROUTE_VIAS
from agent.citations.roles import EditionUse
from agent.common.knowledge_context import GATE_STATES
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
    "/properties/uses/items/properties/qualifier/anyOf/0": (
        "this tier reads office_maintained only; #1582's typed EditionUse reads uncurated too"
    ),
    "/properties/uses/items/properties/freshness": "the chain text states it; #1582 reads it per use",
    "/properties/uses/items/properties/connectsBy/items": "the chain text states it; #1582 reads it per use",
    "/properties/uses/items/properties/labels/items": "the chain text states each; #1582 reads them per use",
    "/properties/uses/items/properties/sourceRefs/items/properties/scheme": "#1582 matches a passage read live by them",
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
}

#: The context's properties the agent ignores, and why.
IGNORED_KEYS: dict[str, str] = {
    "text": "this tier reads the chain text from buildingLaw; #1582 reads it here",
}

#: The use properties the agent ignores, and why; the rest are ``EditionUse``'s fields, camel-cased.
IGNORED_USE_KEYS: dict[str, str] = {
    "date": "the context's own date holds for every use",
    "freshness": "stated in the chain text",
    "lastCheckedAt": "stated in the chain text",
    "connectsBy": "stated in the chain text",
    "labels": "stated in the chain text",
    "sourceRefs": "#1582 matches a passage read live by them",
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
    read = {_camel(field.name) for field in dataclasses.fields(EditionUse)}
    sent = set(CONTEXT["properties"]["uses"]["items"]["properties"])
    assert sorted(sent) == sorted(read | set(IGNORED_USE_KEYS))
