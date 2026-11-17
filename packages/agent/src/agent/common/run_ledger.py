from __future__ import annotations

from typing import Literal

from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

RUN_PHASES: tuple[str, ...] = ("planning", "researching", "checking", "writing", "filed")
RunPhase = Literal["planning", "researching", "checking", "writing", "filed"]

RUN_STATUSES: tuple[str, ...] = (
    "created",
    "running",
    "waiting",
    "done",
    "failed",
    "cancelled",
    "interrupted",
)
RunStatus = Literal[
    "created",
    "running",
    "waiting",
    "done",
    "failed",
    "cancelled",
    "interrupted",
]

TERMINAL_RUN_STATUSES: tuple[str, ...] = ("done", "failed", "cancelled", "interrupted")

RUN_STATUS_MOVES: dict[str, tuple[str, ...]] = {
    "created": ("running", "waiting", "done", "failed", "cancelled"),
    "running": ("waiting", "done", "failed", "cancelled", "interrupted"),
    "waiting": ("running", "done", "failed", "cancelled"),
    "done": ("interrupted",),
    "failed": (),
    "cancelled": (),
    "interrupted": (),
}


def next_run_status(current: str, asked: str) -> str:
    return asked if asked in RUN_STATUS_MOVES.get(current, ()) else current


MAX_RUN_ID_CHARS = 64
MAX_STEPS = 50
MAX_STEP_ID_CHARS = 64
MAX_INTENT_CHARS = 160
MAX_DOCS_PER_STEP = 100
MAX_NAME_CHARS = 256
MAX_TITLE_CHARS = 256
MAX_SHELF_CHARS = 64
MAX_LOCUS_CHARS = 128
MAX_LOCI_PER_DOC = 20
MAX_OPEN_POINTS = 20
MAX_OPEN_POINT_CHARS = 200
MAX_FINDINGS_PER_STEP = 8
MAX_FINDING_CHARS = 200
MAX_ERROR_REASON_CHARS = 400
MAX_REFERENCE_ID_CHARS = 128
MAX_BASIS_DOCS = 20


class _Wire(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class RunLedgerDoc(_Wire):
    name: str = Field(max_length=MAX_NAME_CHARS)
    title: str | None = Field(default=None, max_length=MAX_TITLE_CHARS)
    shelf: str | None = Field(default=None, max_length=MAX_SHELF_CHARS)
    loci: list[str] = Field(default_factory=list, max_length=MAX_LOCI_PER_DOC)
    repeat: bool | None = None


class RunStep(_Wire):
    id: str = Field(max_length=MAX_STEP_ID_CHARS)
    phase: RunPhase
    intent: str = Field(max_length=MAX_INTENT_CHARS)
    started_at: str = Field(alias="startedAt")
    docs: list[RunLedgerDoc] = Field(default_factory=list, max_length=MAX_DOCS_PER_STEP)
    open_points: list[str] | None = Field(default=None, alias="openPoints", max_length=MAX_OPEN_POINTS)
    findings: list[str] | None = Field(default=None, max_length=MAX_FINDINGS_PER_STEP)


class RunPhaseEntry(_Wire):
    phase: RunPhase
    started_at: str = Field(alias="startedAt")
    ended_at: str | None = Field(default=None, alias="endedAt")


class RunResult(_Wire):
    file_id: str | None = Field(default=None, alias="fileId", max_length=MAX_REFERENCE_ID_CHARS)
    report_message_id: str | None = Field(default=None, alias="reportMessageId", max_length=MAX_REFERENCE_ID_CHARS)
    filed_at: str = Field(alias="filedAt")


class RunError(_Wire):
    reason: str = Field(max_length=MAX_ERROR_REASON_CHARS)
    completed_before: list[RunPhase] = Field(default_factory=list, alias="completedBefore")


class RunLedger(_Wire):
    run_id: str = Field(alias="runId", max_length=MAX_RUN_ID_CHARS)
    status: RunStatus
    phases: list[RunPhaseEntry] = Field(default_factory=list, max_length=len(RUN_PHASES))
    steps: list[RunStep] = Field(default_factory=list, max_length=MAX_STEPS)
    result: RunResult | None = None
    error: RunError | None = None
    basis: list[RunLedgerDoc] | None = Field(default=None, max_length=MAX_BASIS_DOCS)
    started_at: str = Field(alias="startedAt")
    updated_at: str = Field(alias="updatedAt")
    finished_at: str | None = Field(default=None, alias="finishedAt")


class RunFinishError(_Wire):
    reason: str = Field(max_length=MAX_ERROR_REASON_CHARS)


class RunLedgerAppendRequest(_Wire):
    op: Literal["append"] = "append"
    steps: list[RunStep] | None = Field(default=None, max_length=MAX_STEPS)
    phases: list[RunPhaseEntry] | None = Field(default=None, max_length=len(RUN_PHASES))
    status: RunStatus | None = None
    basis: list[RunLedgerDoc] | None = Field(default=None, max_length=MAX_BASIS_DOCS)


class RunLedgerFinishRequest(_Wire):
    op: Literal["finish"] = "finish"
    result: RunResult | None = None
    error: RunFinishError | None = None


def to_wire(model: _Wire) -> dict:
    return model.model_dump(by_alias=True, exclude_none=True, mode="json")
