"""A tab opened before the answer check still reads the turn it finishes (docs/design/chat-wire-v2.md, „Compatibility").

A tab outlives a deploy. Its bundle reads what the server sends leniently: an
unknown key is stripped, but a known field with a value its schema does not
allow drops the whole frame, and a dropped ``RUN_FINISHED`` asks the tab to
reload. ``v2.schema.before-answer-check.json`` is the generated schema's
``RunFinished`` and what it references, as they stood before ADR-0139; refresh
it only when a release has staged a break on purpose.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jsonschema

from agent.agents.piloti.markers import CONFIDENCE_RULE_VERSION

FIXTURES = Path(__file__).parents[4] / "tests" / "fixtures" / "wire_v2"


def _lenient(node: Any) -> Any:
    """The schema as the client reads it: unknown keys stripped rather than refused."""
    if isinstance(node, dict):
        return {key: _lenient(value) for key, value in node.items() if key != "additionalProperties"}
    if isinstance(node, list):
        return [_lenient(value) for value in node]
    return node


def _old_tab_reads(frame: dict[str, Any]) -> bool:
    schema = _lenient(json.loads((FIXTURES / "v2.schema.before-answer-check.json").read_text()))
    return jsonschema.Draft202012Validator(schema).is_valid(frame)


def _checked_finish(version: int, check: dict[str, Any]) -> dict[str, Any]:
    """The golden turn's RUN_FINISHED as a checked answer writes it."""
    lines = (FIXTURES / "golden_turn.jsonl").read_text().splitlines()
    frame = next(json.loads(line) for line in lines if '"RUN_FINISHED"' in line)
    result = frame["result"]
    result["confidence_check"] = check
    result["answer_confidence_version"] = version
    # The golden file leaves the clock out so it stays byte-stable; a live frame carries it.
    return {**frame, "ts": 1_793_100_000_000}


FINDING = {"statement": "Die Treppe ist 1,50 m breit", "problem": "contradicted", "reason": "1,10 m", "source": "[1]"}


def test_a_tab_from_before_the_check_reads_its_finished_turn():
    check = {"status": "judged", "level": "low", "findings": [FINDING]}
    assert _old_tab_reads(_checked_finish(CONFIDENCE_RULE_VERSION, check))


def test_an_unavailable_check_reads_too():
    frame = _checked_finish(CONFIDENCE_RULE_VERSION, {"status": "unavailable"})
    frame["result"].pop("answer_confidence", None)
    frame["result"].pop("answer_confidence_version", None)
    assert _old_tab_reads(frame)


def test_the_check_sees_the_break_a_new_version_number_would_be():
    """What review caught: ``answer_confidence_version: 3`` fails the old ``1 | 2``."""
    assert not _old_tab_reads(_checked_finish(3, {"status": "judged", "level": "high"}))


# A new value of a known field is the break stripping does not cover. A field marked ``x-unknown-as-null``
# (``wire_v2.py``) is generated with ``.catch(null)`` (``generate-wire-schemas.mjs``): a bundle built from
# today's schema reads a value added later as absent, and the turn settles.
SCHEMA = Path(__file__).parents[4] / "contracts" / "wire" / "v2.schema.json"


def _as_bundle_reads(node: Any) -> Any:
    """The schema as the generated client reads it: unknown keys stripped, a marked field taking any value."""
    if isinstance(node, dict):
        if node.get("x-unknown-as-null") is True:
            return {}
        return {key: _as_bundle_reads(value) for key, value in node.items() if key != "additionalProperties"}
    if isinstance(node, list):
        return [_as_bundle_reads(value) for value in node]
    return node


def _todays_bundle_reads(frame: dict[str, Any]) -> bool:
    defs = json.loads(SCHEMA.read_text())["$defs"]
    schema = _as_bundle_reads({"$ref": "#/$defs/RunFinished", "$defs": defs})
    return jsonschema.Draft202012Validator(schema).is_valid(frame)


def _capped(reason: str) -> dict[str, Any]:
    frame = _checked_finish(CONFIDENCE_RULE_VERSION, {"status": "judged", "level": "high"})
    frame["result"].update(answer_confidence="medium", answer_confidence_capped_reason=reason)
    return frame


def test_a_capped_reason_from_a_later_release_still_settles_the_turn():
    assert _todays_bundle_reads(_capped("open_point"))
    assert _todays_bundle_reads(_capped("a_reason_a_later_release_adds"))


def test_the_capped_reason_is_marked_lenient_on_the_wire():
    reason = json.loads(SCHEMA.read_text())["$defs"]["TurnResult"]["properties"]["answer_confidence_capped_reason"]
    assert reason.get("x-unknown-as-null") is True


def test_a_tab_built_before_the_marker_still_refuses_a_new_reason():
    """The one-time cost, staged knowingly: a bundle from before ``x-unknown-as-null`` cannot read ``open_point``
    (nor ``law_unsettled``, #1582) and asks the tab to reload. From this release on, a new reason reads as null."""
    assert not _old_tab_reads(_capped("open_point"))
