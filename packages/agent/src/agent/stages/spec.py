"""The post-answer **stage** primitive: what a stage declares, receives, returns.

A post-answer stage is a bounded, gated, independently-failing unit of work that
runs *after* a turn's answer exists, produces at most one payload addressed to
that turn, and may not affect the answer in any way. Two properties are
load-bearing:

- **The answer is already written when a stage runs.** A stage can therefore
  never delay, alter, block or fail an answer. If it can, it is not a stage.
- **A stage is addressed to a turn, not to a session.** Its output lands on one
  turn or nowhere.

This module holds only the shapes. Registration lives in :mod:`.registry`,
execution in :mod:`.runner`, and the frame channel in :mod:`.delivery`. Nothing
here knows about any individual stage — a module in this package that branches on
a stage id is a design failure, not a special case.

See docs/architecture/post-answer-stages.md.
"""

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
    """Everything a gate or handler may know about the finished turn.

    Frozen and request-context-free: captured by the single call site **while
    the request context is still live**, then passed explicitly, because a stage
    task outlives that context. Everything a gate needs to decide must be in
    here. If a stage wants a fact that is not present, the fact gets added to
    ``TurnFacts`` — never fetched inside the handler, where the request context
    is gone.
    """

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
        """Whether ``stage_id``'s flag is on for this turn. Fails closed."""
        return bool(self.enabled_stages) and stage_id in self.enabled_stages

    @property
    def turn_key(self) -> tuple[str, str] | None:
        """The ``(conversation_id, ws_parent_id)`` pair that identifies the turn.

        ``None`` when either half is missing — there is then no turn identity to
        be idempotent against, and the runner says so rather than inventing one
        that would collapse every turn of a conversation onto the same key.
        """
        if not self.conversation_id or not self.ws_parent_id:
            return None
        return (self.conversation_id, self.ws_parent_id)


@dataclass(frozen=True)
class StageContext:
    """What a handler receives: the turn's facts plus its resolved LLM.

    The LLM has already been through the org's model override and the ADR-0022
    BYOK credential swap, applied at schedule time while the request context was
    live. The handler is given **no reference to the response object**: it cannot
    mutate the answer even if it tries.
    """

    facts: TurnFacts
    llm: Any


@dataclass(frozen=True)
class StageEmpty:
    """A deliberate "nothing" that names *which* nothing it was.

    A handler may return ``None`` for the plain case, but "nothing" is rarely one
    fact. A follow-ups handler that gets no questions back from the model and one
    that gets four unusable ones have produced the same absence for opposite
    reasons: the first says the gate let through a turn the model saw nothing in,
    the second says the prompt is not landing. Collapsing them into one
    ``empty`` bucket makes the number the stage exists to produce unreadable, so
    a handler may name the case and the runner puts the name on the span next to
    the outcome.

    Not a status: ``empty`` stays a first-class *success* on the wire, and the
    reason is telemetry, never something a client reads.
    """

    reason: str

    def __post_init__(self) -> None:
        if not self.reason:
            raise ValueError("StageEmpty requires a machine-readable reason")


@dataclass(frozen=True)
class GateDecision:
    """A deterministic gate's verdict. Never an LLM's opinion."""

    run: bool
    reason: str | None = None

    @classmethod
    def proceed(cls) -> GateDecision:
        return cls(run=True)

    @classmethod
    def skip(cls, reason: str) -> GateDecision:
        """Decline, naming the condition that declined. The reason is required:
        a gate's own correctness is then measurable rather than assumed."""
        if not reason:
            raise ValueError("GateDecision.skip requires a machine-readable reason")
        return cls(run=False, reason=reason)


@dataclass(frozen=True)
class StageOutcome:
    """One terminal record per stage per turn — including the runs that did not
    happen, which is exactly the data that makes the gate falsifiable."""

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
    """One stage, declared once. Adding a stage is a declaration and a handler.

    ``timeout_s`` has **no default**: a stage without a hard bound is the defect
    this primitive exists to close (memory reflection ran with the provider's
    120s × 2 retries as its only limit, holding a concurrency slot for minutes),
    so the declaration is forced to state one.
    """

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
