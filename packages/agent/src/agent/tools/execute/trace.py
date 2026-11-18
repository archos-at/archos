from __future__ import annotations

import hashlib
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from agent.cards.registry import get_card_registry
from agent.observability.langfuse_scores import RuntimeScore
from agent.observability.langfuse_scores import emit_scores
from agent.observability.langfuse_trace_attributes import add_trace_tag
from agent.observability.retrieval_trace import emit_step_span
from agent.observability.turn_phases import now

STEP = "execute.run"

FEATURE_TAG = "feature:execute"

WRITER = "execute"

HELD_KIND = "execute_run"

MAX_STDERR_LINE = 200

_NOT_RUN = frozenset({"unavailable", "refused"})


@dataclass
class KeptFile:
    path: str
    size: int
    new: bool


@dataclass
class RunFacts:
    code_chars: int
    code_sha256: str
    documents_named: int
    started_at: float = field(default_factory=now)
    timeout_s: int = 0
    input_files: int = 0
    input_bytes: int = 0
    status: str = "refused"
    reason: str | None = None
    runner_ms: int = 0
    stderr: str = ""
    kept: list[KeptFile] = field(default_factory=list)
    files_refused: int = 0

    @classmethod
    def of(cls, code: str, documents: list[str] | None) -> RunFacts:
        digest = hashlib.sha256(code.encode("utf-8")).hexdigest()[:16]
        return cls(code_chars=len(code), code_sha256=digest, documents_named=len(documents or []))

    def stop(self, status: str, reason: str) -> None:
        self.status, self.reason = status, reason

    def sent(self, files: dict[str, bytes], timeout_s: int) -> None:
        self.input_files = len(files)
        self.input_bytes = sum(len(data) for data in files.values())
        self.timeout_s = timeout_s

    def ran(self, status: str, duration_ms: int, stderr: str) -> None:
        self.status, self.runner_ms, self.stderr = status, duration_ms, stderr

    @property
    def files_new(self) -> int:
        return sum(1 for kept in self.kept if kept.new)


def file_type(path: str) -> str:
    name = path.rsplit("/", 1)[-1]
    return name.rsplit(".", 1)[-1].lower() if "." in name.strip(".") else "none"


def stderr_first_line(stderr: str) -> str | None:
    for line in stderr.splitlines():
        if line.strip():
            return line.strip()[:MAX_STDERR_LINE]
    return None


def span_input(facts: RunFacts, run: int) -> dict[str, Any]:
    return {
        "run": run,
        "code_chars": facts.code_chars,
        "code_sha256": facts.code_sha256,
        "documents": facts.documents_named > 0,
        "documents_named": facts.documents_named,
        "input_files": facts.input_files,
        "input_bytes": facts.input_bytes,
        "timeout_s": facts.timeout_s,
    }


def span_output(facts: RunFacts, ended_at: float) -> dict[str, Any]:
    output: dict[str, Any] = {
        "status": facts.status,
        "runner_ms": facts.runner_ms,
        "wall_ms": round(1000 * (ended_at - facts.started_at), 1),
        "files_kept": len(facts.kept),
        "files_new": facts.files_new,
        "kept_bytes": sum(kept.size for kept in facts.kept),
        "file_types": sorted({file_type(kept.path) for kept in facts.kept}),
        "files_refused": facts.files_refused,
    }
    if facts.reason:
        output["reason"] = facts.reason
    if facts.status in ("error", "timeout"):
        output["stderr_first_line"] = stderr_first_line(facts.stderr)
    return output


def turn_runs(kept_file: bool) -> tuple[int, int]:
    registry = get_card_registry()
    if registry is None:
        return 1, 1
    run = registry.hold(HELD_KIND, kept_file)
    held = registry.held(HELD_KIND)
    earlier = [index for index, made in enumerate(held[:-1], start=1) if made]
    return run, run - (earlier[-1] if earlier else 0)


def run_scores(facts: RunFacts, run: int, runs_to_file: int) -> list[RuntimeScore]:
    item = f"run:{run}"
    scores = [RuntimeScore("execute-status", facts.status, comment=facts.reason, item=item)]
    if facts.status in _NOT_RUN:
        return scores
    scores.append(RuntimeScore("execute-files-made", float(facts.files_new), item=item))
    if facts.kept:
        scores.append(RuntimeScore("execute-runs-to-file", float(runs_to_file), item=item))
    return scores


def record_run(facts: RunFacts) -> None:
    ended_at = now()
    run, runs_to_file = turn_runs(bool(facts.kept))
    add_trace_tag(FEATURE_TAG)
    emit_step_span(
        STEP, span_input(facts, run), span_output(facts, ended_at), started_at=facts.started_at, ended_at=ended_at
    )
    emit_scores(run_scores(facts, run, runs_to_file), writer=WRITER)


def filed_scores(path: str) -> list[RuntimeScore]:
    item = "file:" + hashlib.sha256(path.encode("utf-8")).hexdigest()[:16]
    return [RuntimeScore("execute-files-filed", 1.0, item=item)]
