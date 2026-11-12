"""The frames a turn's Herleitung is folded from (``agent_host.turn_record``).

The BFF folds what this keeps with the browser's fold, and
``apps/workspace/bff/turns/turn-steps.spec.ts`` reads :data:`STEP_FRAME_TYPES`
and :data:`STEP_CUSTOM_NAMES` from this module to prove the rows agree over
every recorded turn. Here: what is kept, and that it outlives the replay window.
"""

from __future__ import annotations

import json
from pathlib import Path

from agent_host.turn_record import MAX_STEP_FRAMES
from agent_host.turn_record import TurnFrames
from agent_host.turn_record import touches_steps

WIRE = Path(__file__).resolve().parents[3] / "contracts" / "wire" / "v2"


def _frames(name: str) -> list[dict]:
    return [json.loads(line) for line in (WIRE / name).read_text(encoding="utf-8").splitlines() if line.strip()]


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


def test_the_step_frames_outlive_the_replay_window_up_to_their_own_bound():
    frames = TurnFrames(maxlen=3)
    frames.append({"type": "STEP_STARTED", "seq": 1})
    for seq in range(2, 10):
        frames.append({"type": "TEXT_MESSAGE_CONTENT", "seq": seq})

    assert [frame["seq"] for frame in frames] == [7, 8, 9]  # the replay window
    assert [frame["seq"] for frame in frames.steps] == [1]

    for seq in range(10, 10 + MAX_STEP_FRAMES + 5):
        frames.append({"type": "STEP_FINISHED", "seq": seq})
    assert len(frames.steps) == MAX_STEP_FRAMES
    assert frames.steps[0]["seq"] == 1  # a turn past the bound keeps its first
