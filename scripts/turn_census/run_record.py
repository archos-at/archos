from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field


@dataclass
class Run:
    question_id: str
    run: int
    wall_s: float = 0.0
    final_call_s: float = 0.0
    first_text_s: float = 0.0
    research_calls: int = 0
    post_answer_calls: int = 0
    tool_calls: list[str] = field(default_factory=list)
    tool_args: list[dict] = field(default_factory=list)
    reasoning_tokens: int = 0
    max_reasoning_tokens: int = 0
    output_tokens: int = 0
    input_tokens: int = 0
    cost_usd: float | None = None
    cost_missing: int = 0
    signals: list[str] = field(default_factory=list)
    kind: str = ""
    cited_families: list[str] = field(default_factory=list)
    envelope: dict | None = None
    checks: dict[str, bool] = field(default_factory=dict)
    lookups: list[str] = field(default_factory=list)
    precedent_p: float | None = None
    scenario: str = ""
    holdout: bool = False
    answer: str = ""
    error: str = ""
    door: list[dict] = field(default_factory=list)
    door_offset: int | None = None
    turns: int = 1
