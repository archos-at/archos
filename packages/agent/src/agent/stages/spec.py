from __future__ import annotations

from collections.abc import Awaitable
from collections.abc import Callable
from dataclasses import dataclass
from dataclasses import field
from typing import Any
from typing import Literal

from pydantic import BaseModel

from agent.common.bff_http import SignedEnvelope
from agent.common.model_overrides import AgentGroup
from agent.knowledge.project_memory import TurnMemoryNote
from agent.memory.restriction import RestrictionEvidence

StageStatus = Literal["ready", "empty", "skipped", "failed", "timeout", "disabled"]


@dataclass(frozen=True)
class TurnFacts:
    conversation_id: str | None = None
    ws_parent_id: str | None = None
    organization_id: str | None = None
    project_id: str | None = None
    user_id: str | None = None

    query: str = ""
    answer: str = ""
    memory_digest: str | None = None
    remembered_this_turn: tuple[str, ...] = ()
    noted_this_turn: tuple[TurnMemoryNote, ...] = ()
    restriction: RestrictionEvidence = RestrictionEvidence()
    drew_on_other_projects: bool = False
    federal_state: str | None = None
    temporary: bool = False
    personal_memory: str | None = None
    envelope: SignedEnvelope | None = field(default=None, repr=False)

    routing_decision: str | None = None
    research_truncated: bool = False
    run_id: str | None = None
    emitted_card_types: frozenset[str] = frozenset()
    answer_confidence: str | None = None

    enabled_stages: frozenset[str] | None = None

    def stage_enabled(self, stage_id: str) -> bool:
        return bool(self.enabled_stages) and stage_id in self.enabled_stages

    @property
    def turn_key(self) -> tuple[str, str] | None:
        if not self.conversation_id or not self.ws_parent_id:
            return None
        return (self.conversation_id, self.ws_parent_id)


@dataclass(frozen=True)
class StageContext:
    facts: TurnFacts
    llm: Any


@dataclass(frozen=True)
class StageEmpty:
    reason: str

    def __post_init__(self) -> None:
        if not self.reason:
            raise ValueError("StageEmpty requires a machine-readable reason")


@dataclass(frozen=True)
class GateDecision:
    run: bool
    reason: str | None = None

    @classmethod
    def proceed(cls) -> GateDecision:
        return cls(run=True)

    @classmethod
    def skip(cls, reason: str) -> GateDecision:
        if not reason:
            raise ValueError("GateDecision.skip requires a machine-readable reason")
        return cls(run=False, reason=reason)


@dataclass(frozen=True)
class StageOutcome:
    stage_id: str
    status: StageStatus
    reason: str | None = None
    payload: dict[str, Any] | None = None
    duration_ms: int = 0

    def __post_init__(self) -> None:
        if self.status in {"skipped", "failed", "disabled"} and not self.reason:
            raise ValueError(f"a {self.status!r} outcome must name a reason")
        if self.status != "ready" and self.payload is not None:
            raise ValueError("only a 'ready' outcome may carry a payload")


@dataclass(frozen=True)
class StageSpec:
    id: str
    agent_group: AgentGroup
    flag_slug: str
    timeout_s: float
    gate: Callable[[TurnFacts], GateDecision]
    handler: Callable[[StageContext], Awaitable[dict[str, Any] | StageEmpty | None]]
    payload_model: type[BaseModel] | None
    delivery: Literal["frame", "silent"]
    max_output_tokens: int | None
    tags: frozenset[str] = field(default_factory=frozenset)

    def __post_init__(self) -> None:
        if not self.id:
            raise ValueError("a StageSpec needs a stable id")
        if not self.timeout_s or self.timeout_s <= 0:
            raise ValueError(f"stage {self.id!r} must declare a positive timeout_s")
        if self.max_output_tokens is not None and self.max_output_tokens <= 0:
            raise ValueError(f"stage {self.id!r} declared a non-positive max_output_tokens")
