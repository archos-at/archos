"""The frames a turn's Herleitung is folded from (``agent_host.turn_record``).

The BFF folds what this keeps with the browser's fold, and
``apps/workspace/bff/turns/turn-steps.spec.ts`` holds the two together: it
reads :data:`STEP_FRAME_TYPES`, :data:`STEP_CUSTOM_NAMES`, :data:`MAX_STEP_ROWS`
and :data:`MAX_STEP_FRAMES` from this module, and folds the frames kept of the
turn below (the same seqs) to the rows the browser stores. Here: what is kept.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from agent_host.turn_record import MAX_STEP_ROWS
from agent_host.turn_record import TurnFrames
from agent_host.turn_record import touches_steps

WIRE = Path(__file__).resolve().parents[3] / "contracts" / "wire" / "v2"


def _frames(name: str) -> list[dict]:
    return [json.loads(line) for line in (WIRE / name).read_text(encoding="utf-8").splitlines() if line.strip()]


def _frame(seq: int, **body: Any) -> dict[str, Any]:
    return {"v": 2, "conversation_id": "conv_1", "turn_id": "turn-1", "seq": seq, **body}


def _tool(seq: int, kind: str, status: str) -> dict[str, Any]:
    return _frame(seq, type=kind, step={"kind": "tool", "id": "tool:1", "tool": "search", "status": status})


def _skill(seq: int, phase: str, title: str | None = None) -> dict[str, Any]:
    step = {"kind": "skill", "id": "skill:a", "skill": "a", "phase": phase, **({"title": title} if title else {})}
    return _frame(seq, type="STEP_FINISHED", step=step)


def test_keeps_every_step_subagent_and_steering_frame_of_a_recorded_turn_and_nothing_else():
    kept = {
        frame["type"] if frame["type"] != "CUSTOM" else f"CUSTOM:{frame['name']}"
        for name in ("turn-subagents.jsonl", "turn-steered.jsonl", "turn-answered.jsonl")
        for frame in _frames(name)
        if touches_steps(frame)
    }

    assert kept == {
        "STEP_STARTED",
        "STEP_FINISHED",
        "SUBAGENT_STARTED",
        "SUBAGENT_FINISHED",
        "SUBAGENT_ERROR",
        "CUSTOM:steer_received",
        "CUSTOM:steer_applied",
    }


def test_keeps_per_row_the_first_the_newest_titled_and_the_newest_frame_and_a_subagent_s_first_end():
    frames = TurnFrames(maxlen=3)
    sent = [
        _frame(1, type="RUN_STARTED", message_id="answer-1"),
        _tool(2, "STEP_STARTED", "ok"),
        *(_tool(3 + index, "STEP_STARTED", "ok") for index in range(20)),
        _tool(23, "STEP_FINISHED", "error"),
        _skill(24, "offered"),
        _skill(25, "activated", "Brandschutznachweis"),
        _skill(26, "loaded"),
        _frame(27, type="SUBAGENT_STARTED", subagent_run_id="sa_1", name="researcher-agent"),
        _frame(28, type="SUBAGENT_ERROR", subagent_run_id="sa_1", message="failed", code="Boom"),
        _frame(29, type="SUBAGENT_FINISHED", subagent_run_id="sa_1"),
        _frame(30, type="CUSTOM", name="steer_received", value={"steer_id": "st_1", "text": "die Treppe"}),
        _frame(31, type="CUSTOM", name="steer_applied", value={"steer_id": "st_1", "round": 2}),
    ]
    for frame in sent:
        frames.append(frame)

    assert [frame["seq"] for frame in frames] == [29, 30, 31]  # the replay window
    # turn-steps.spec.ts folds these same seqs to the browser's rows: the error, the title, the first end.
    assert [frame["seq"] for frame in frames.steps] == [2, 23, 24, 25, 26, 27, 28, 30, 31]


def test_keeps_the_rows_the_stored_derivation_reads_and_no_more():
    frames = TurnFrames(maxlen=10)
    for seq in range(1, MAX_STEP_ROWS + 6):
        frames.append(_frame(seq, type="STEP_STARTED", step={"kind": "tool", "id": f"tool:{seq}", "tool": "search"}))
    frames.append(_frame(MAX_STEP_ROWS + 6, type="STEP_FINISHED", step={"kind": "tool", "id": "tool:1", "tool": "s"}))

    kept = frames.steps
    assert len(kept) == MAX_STEP_ROWS + 1
    assert kept[0]["seq"] == 1 and kept[-1]["seq"] == MAX_STEP_ROWS + 6  # a kept row still takes its end
