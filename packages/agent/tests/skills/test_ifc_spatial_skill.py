from __future__ import annotations

import re
from pathlib import Path

import pytest

from agent.tools.bim.measure_register import DISTANCE_MODES
from agent.tools.bim.measure_register import ENVELOPE_ASPECTS
from agent.tools.bim.measure_register import FIRE_ASPECTS
from agent.tools.bim.measure_register import KINDS
from agent.tools.bim.measure_register import MEASURES
from agent.tools.bim.measure_register import PROFILE_KINDS
from agent.tools.bim.measure_register import RELATIONS
from agent.tools.bim.measure_register import ROOM_KINDS
from agent.tools.bim.measure_register import VALID_OPERATIONS
from agent.tools.bim.measure_register import VIEW_MODES
from agent.tools.bim.register import VALID_OPERATIONS as QUERY_OPERATIONS

TOOL_OPERATIONS: dict[str, set[str]] = {
    "ifc_measure": set(VALID_OPERATIONS),
    "ifc_query": set(QUERY_OPERATIONS),
}
EVERY_OPERATION = TOOL_OPERATIONS["ifc_measure"] | TOOL_OPERATIONS["ifc_query"]

EVERY_KIND = set(KINDS) | set(FIRE_ASPECTS) | set(ENVELOPE_ASPECTS) | set(PROFILE_KINDS)

SKILL = (
    Path(__file__).resolve().parents[4]
    / "packages"
    / "agent"
    / "src"
    / "agent"
    / "skills"
    / "builtin"
    / "bim"
    / "ifc-spatial-reasoning"
    / "SKILL.md"
)

PARAMETERS = {
    "operation",
    "global_id",
    "other_global_id",
    "relation",
    "measure",
    "mode",
    "ifc_type",
    "name_contains",
    "storey",
    "kind",
    "room_kind",
    "model_name",
    "limit",
    "angle_deg",
    "swivel_deg",
    "when",
}


def test_the_parameter_list_is_the_tool_s_own_signature() -> None:
    from agent.tools.bim.measure_register import IfcMeasureInput

    assert PARAMETERS == set(IfcMeasureInput.model_fields)


def test_the_kind_union_still_covers_the_schema() -> None:
    from agent.tools.bim.measure_register import _ALL_KINDS

    assert EVERY_KIND == set(_ALL_KINDS)


def _card_field_names() -> set[str]:
    from agent.cards import ifc_cards as card_models

    names: set[str] = set()
    for card in (
        "IfcViewerCard",
        "IfcHighlight",
        "IfcElementCard",
        "IfcScheduleCard",
        "IfcComplianceCard",
        "IfcDiffCard",
        "IfcModelPickerCard",
    ):
        model = getattr(card_models, card, None)
        if model is None:
            continue
        names |= set(getattr(model, "model_fields", {}))
        literal = getattr(model, "model_fields", {}).get("type")
        for value in getattr(getattr(literal, "annotation", None), "__args__", ()):
            if isinstance(value, str):
                names.add(value)
    return names | {"pass", "fail", "warning", "info"}


_CARD_FIELDS = _card_field_names()


@pytest.fixture(scope="module")
def text() -> str:
    return SKILL.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def backticked(text: str) -> set[str]:
    return {token for token in re.findall(r"`([^`\n]+)`", text) if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", token)}


def test_every_operation_the_skill_names_exists(backticked: set[str]) -> None:
    named = backticked & (VALID_OPERATIONS | {"ifc_measure"})
    assert len(named) >= 6, named


def test_no_backticked_identifier_is_an_invention(backticked: set[str], text: str) -> None:
    known = (
        EVERY_OPERATION
        | PARAMETERS
        | set(RELATIONS)
        | set(MEASURES)
        | set(DISTANCE_MODES)
        | EVERY_KIND
        | set(ROOM_KINDS)
        | set(TOOL_OPERATIONS)
        | {
            "provenance",
            "declared",
            "computed",
            "inferred",
            "decidable",
            "caveat",
            "because",
            "tolerance",
            "missing",
            "unit",
            "value",
            "method",
            "from",
            "FEHLT",
            "width",
            "depth",
            "height",
            "centroid",
            "volume",
            "envelopeArea",
            "boxGap",
        }
        | _CARD_FIELDS
    )
    unknown = sorted(token for token in backticked if token not in known)
    assert not unknown, (
        f"{SKILL.name} names {unknown}, which `ifc_measure` does not accept. "
        "Either add it to the tool or stop teaching it."
    )


CALL = re.compile(r'\b([a-z][a-z0-9_]*):\s*"([^"\n]+)"')


def written_calls(text: str) -> list[tuple[str, str]]:
    return CALL.findall(text)


def test_dotted_and_valued_forms_resolve_too(text: str) -> None:
    enums = {
        "operation": EVERY_OPERATION,
        "relation": set(RELATIONS),
        "measure": set(MEASURES),
        "mode": set(DISTANCE_MODES) | set(VIEW_MODES),
        "kind": EVERY_KIND,
        "room_kind": set(ROOM_KINDS),
    }
    calls = written_calls(text)
    assert len(calls) >= 3, "the skill stopped showing concrete calls"
    for parameter, value in calls:
        assert parameter in PARAMETERS, (
            f'{SKILL.name} shows `{parameter}: "{value}"`, and `ifc_measure` has no '
            f"`{parameter}` parameter — the call would be made with it silently dropped."
        )
        allowed = enums.get(parameter)
        if allowed is not None:
            assert value in allowed, f'{parameter}: "{value}" is not one of {sorted(allowed)}'


def test_the_routing_table_puts_each_operation_under_its_own_tool(text: str) -> None:
    checked = 0
    for line in text.splitlines():
        named = [tool for tool in TOOL_OPERATIONS if tool in line]
        if len(named) != 1:
            continue
        tool = named[0]
        bare = {token for token in re.findall(r"`([^`\n]+)`", line) if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", token)}
        written = {value for parameter, value in written_calls(line) if parameter == "operation"}
        for candidate in (bare | written) & EVERY_OPERATION:
            checked += 1
            assert candidate in TOOL_OPERATIONS[tool], (
                f"{SKILL.name} offers `{candidate}` on the same line as `{tool}`, which has no such "
                f"operation. It belongs to {sorted(t for t, ops in TOOL_OPERATIONS.items() if candidate in ops)}."
            )
    assert checked >= 8, f"only {checked} operations were attributed to a tool"


def test_the_description_survives_the_level_one_catalog_intact(text: str) -> None:
    from agent.skills.models import MAX_DESCRIPTION_CHARS
    from agent.skills.models import parse_skill_md
    from agent.skills.runtime import SkillRuntime

    skill = parse_skill_md(text, expected_dir_name="ifc-spatial-reasoning")
    assert "\n" not in skill.description
    assert len(skill.description) <= MAX_DESCRIPTION_CHARS

    block = SkillRuntime.office((skill,)).catalog_block() or ""
    assert f"- **{skill.name}**: {skill.description}" in block.splitlines()

    for tool in TOOL_OPERATIONS:
        assert tool in skill.description, tool


def test_the_check_actually_catches_the_defect_it_was_written_for() -> None:
    removed = '`view: "section"` zeigt Profile und Überstände, `plan` die Anordnung.'

    parameters = [name for name, _ in written_calls(removed)]
    assert parameters == ["view"]
    assert "view" not in PARAMETERS
    assert "view" in VALID_OPERATIONS, "the operation exists — only the parameter never did"

    everything = VALID_OPERATIONS | PARAMETERS | set(RELATIONS) | set(MEASURES) | set(DISTANCE_MODES)
    assert "section" not in everything


def test_the_skill_does_not_promise_a_section_or_an_elevation(text: str) -> None:
    assert "floor plan" in text
    flat = " ".join(text.split())
    assert "section and elevation do **not** exist" in flat
    assert "overhang" in text


def test_the_light_incidence_angles_are_taught_as_law_not_as_geometry(text: str) -> None:
    assert "angle_deg" in text and "swivel_deg" in text
    assert "provision" in text
    assert "45 and 30" in text
    flowed = " ".join(text.replace("**", "").split())
    assert "enlarges the required light entry area" in flowed
    assert "it does not forbid the window" in flowed


def test_the_three_provenances_are_all_present_and_distinct(text: str) -> None:
    for word in ("deklariert", "Gemessen", "Vermutlich"):
        assert word in text, word


def test_the_clear_width_hedge_survives(text: str) -> None:
    flowed = " ".join(text.replace("**", "").split())
    assert "structural clear opening" in flowed
    assert "15 to 25 % smaller" in flowed
    assert "too narrow" in flowed
    assert 'never called "lichte Durchgangsbreite"' in flowed
