from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from dataclasses import dataclass
from dataclasses import field
from datetime import UTC
from datetime import datetime
from typing import Any

from agent.common.run_ledger import MAX_BASIS_DOCS
from agent.common.run_ledger import MAX_DOCS_PER_STEP
from agent.common.run_ledger import MAX_ERROR_REASON_CHARS
from agent.common.run_ledger import MAX_FINDING_CHARS
from agent.common.run_ledger import MAX_FINDINGS_PER_STEP
from agent.common.run_ledger import MAX_INTENT_CHARS
from agent.common.run_ledger import MAX_LOCI_PER_DOC
from agent.common.run_ledger import MAX_LOCUS_CHARS
from agent.common.run_ledger import MAX_NAME_CHARS
from agent.common.run_ledger import MAX_OPEN_POINT_CHARS
from agent.common.run_ledger import MAX_OPEN_POINTS
from agent.common.run_ledger import MAX_REFERENCE_ID_CHARS
from agent.common.run_ledger import MAX_SHELF_CHARS
from agent.common.run_ledger import MAX_STEPS
from agent.common.run_ledger import MAX_TITLE_CHARS
from agent.common.run_ledger import RunError
from agent.common.run_ledger import RunFinishError
from agent.common.run_ledger import RunLedger
from agent.common.run_ledger import RunLedgerAppendRequest
from agent.common.run_ledger import RunLedgerDoc
from agent.common.run_ledger import RunLedgerFinishRequest
from agent.common.run_ledger import RunPhaseEntry
from agent.common.run_ledger import RunResult
from agent.common.run_ledger import RunStatus
from agent.common.run_ledger import RunStep
from agent.common.run_ledger import next_run_status
from agent.common.run_ledger import to_wire

from .phase_events import JOB_PHASE_EVENT_TYPE
from .phase_events import PHASE_CITATION_VERIFICATION_STARTED
from .phase_events import PHASE_DONE
from .phase_events import PHASE_PLANNING_STARTED
from .phase_events import PHASE_RESEARCH_STARTED
from .phase_events import PHASE_WRITING_STARTED
from .run_ledger_client import RunLedgerClient

logger = logging.getLogger(__name__)

RUN_LEDGER_EVENT_TYPE = "run.ledger"

ARTIFACT_EVENT_TYPE = "artifact.update"
JOB_ERROR_EVENT_TYPE = "job.error"
JOB_CANCELLED_EVENT_TYPE = "job.cancelled"
JOB_DEGRADED_EVENT_TYPE = "job.degraded"

PHASE_KEYS: dict[str, str] = {
    PHASE_PLANNING_STARTED: "planning",
    PHASE_RESEARCH_STARTED: "researching",
    PHASE_CITATION_VERIFICATION_STARTED: "checking",
    PHASE_WRITING_STARTED: "writing",
    PHASE_DONE: "filed",
}

DEFAULT_INTENTS: dict[str, str] = {
    "planning": "Rechercheplan erstellen",
    "checking": "Zitate gegen die belegten Quellen prüfen",
    "writing": "Bericht schreiben",
}

TRUNCATED_KEY = "research_truncated"


def _now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _clip(value: Any, limit: int) -> str:
    text = str(value or "").strip()
    return text[:limit]


def _locus(source: dict[str, Any]) -> str | None:
    page = source.get("page")
    clause = source.get("clause") or source.get("punkt")
    page_text = f"p.{page}" if page is not None else ""
    if not clause:
        return page_text or None
    return f"Pkt. {clause} {page_text}".strip()


@dataclass
class _Doc:
    name: str
    title: str | None = None
    shelf: str | None = None
    loci: list[str] = field(default_factory=list)

    def add_locus(self, locus: str | None) -> None:
        if not locus or locus in self.loci or len(self.loci) >= MAX_LOCI_PER_DOC:
            return
        self.loci.append(locus)

    def wire(self) -> RunLedgerDoc:
        return RunLedgerDoc(name=self.name, title=self.title, shelf=self.shelf, loci=list(self.loci))


@dataclass
class _Step:
    id: str
    phase: str
    intent: str
    started_at: str
    docs: dict[str, _Doc] = field(default_factory=dict)
    open_points: list[str] = field(default_factory=list)
    findings: list[str] = field(default_factory=list)

    def add_doc(self, source: dict[str, Any]) -> bool:
        name = _clip(source.get("file_name") or source.get("citation_key") or source.get("url"), MAX_NAME_CHARS)
        if not name:
            return False
        key = name.casefold()
        doc = self.docs.get(key)
        if doc is None and len(self.docs) >= MAX_DOCS_PER_STEP:
            return False
        if doc is None:
            title = _clip(source.get("title"), MAX_TITLE_CHARS)
            doc = _Doc(name=name, title=title if title and title != name else None)
            doc.shelf = _clip(source.get("shelf"), MAX_SHELF_CHARS) or None
            self.docs[key] = doc
        before = len(doc.loci)
        doc.add_locus(_clip(_locus(source), MAX_LOCUS_CHARS) or None)
        return before != len(doc.loci) or before == 0

    def wire(self) -> RunStep:
        docs = [doc.wire() for doc in self.docs.values()]
        points = self.open_points[:MAX_OPEN_POINTS] or None
        return RunStep(
            id=self.id,
            phase=self.phase,
            intent=self.intent,
            startedAt=self.started_at,
            docs=docs,
            openPoints=points,
            findings=self.findings[:MAX_FINDINGS_PER_STEP] or None,
        )


@dataclass
class _Phase:
    phase: str
    started_at: str
    ended_at: str | None = None

    def wire(self) -> RunPhaseEntry:
        return RunPhaseEntry(phase=self.phase, startedAt=self.started_at, endedAt=self.ended_at)


class RunLedgerFold:
    DEBOUNCE_SECONDS = 1.0

    def __init__(
        self,
        *,
        job_id: str,
        run_id: str | None = None,
        event_store: Any | None = None,
        client: RunLedgerClient | None = None,
        loop: asyncio.AbstractEventLoop | None = None,
        autoflush: bool = True,
        basis: list[dict[str, Any]] | None = None,
    ) -> None:
        self._job_id = job_id
        self._run_id = run_id
        self._event_store = event_store
        self._client = client if client is not None else RunLedgerClient()
        self._loop = (loop if loop is not None else _running_loop()) if autoflush else None
        self._lock = threading.RLock()

        started = _now()
        self._started_at = started
        self._status = "created"
        self._phases: list[_Phase] = []
        self._steps: list[_Step] = []
        self._open_step: _Step | None = None
        self._current_phase: str | None = None
        self._rounds = 0
        self._result: RunResult | None = None
        self._error_reason: str | None = None
        self._finished_at: str | None = None
        self._updated_at = started
        self._basis: list[RunLedgerDoc] = [doc for doc in map(_basis_doc, basis or []) if doc][:MAX_BASIS_DOCS]
        self._sent_basis: int = 0

        self._dirty = False
        self._flush_now = False
        self._last_flush = 0.0
        self._sent_steps: set[str] = set()
        self._sent_phases: dict[str, str | None] = {}
        self._sent_status: str | None = None

    def add_basis(self, doc: Any) -> None:
        wire = _basis_doc(doc.model_dump() if hasattr(doc, "model_dump") else doc)
        if wire is None:
            return
        with self._lock:
            if any(existing.name.casefold() == wire.name.casefold() for existing in self._basis):
                return
            if len(self._basis) >= MAX_BASIS_DOCS:
                return
            self._basis.append(wire)
            self._updated_at = _now()
            self._dirty = True
            self._flush_now = True
        self._schedule_flush()

    def observing(self, event_store: Any) -> FoldingEventStore:
        return FoldingEventStore(event_store, self)

    def observe(self, event: dict[str, Any]) -> None:
        try:
            with self._lock:
                changed = self._ingest(event)
        except Exception:  # noqa: BLE001 — best-effort by contract; see the module docstring
            logger.warning("Job %s: could not fold an event into the run ledger", self._job_id, exc_info=True)
            return
        if changed:
            self._schedule_flush()

    def _ingest(self, event: dict[str, Any]) -> bool:
        kind = event.get("type")
        data = event.get("data") if isinstance(event.get("data"), dict) else {}
        if kind == JOB_PHASE_EVENT_TYPE:
            return self._ingest_phase(data)
        if kind == ARTIFACT_EVENT_TYPE:
            return self._ingest_artifact(data)
        if kind == JOB_ERROR_EVENT_TYPE:
            return self._ingest_error(data)
        if kind == JOB_CANCELLED_EVENT_TYPE:
            return self._ingest_cancelled()
        if kind == JOB_DEGRADED_EVENT_TYPE:
            return self._ingest_degraded(data)
        return False

    def _ingest_phase(self, data: dict[str, Any]) -> bool:
        phase = PHASE_KEYS.get(str(data.get("phase") or ""))
        if phase is None:
            return False
        if phase == "researching":
            return self._open_round(data)
        self._enter_phase(phase)
        if phase == "filed":
            self._seal_open_step()
            return True
        self._begin_step(phase, phase, DEFAULT_INTENTS[phase])
        return True

    def _open_round(self, data: dict[str, Any]) -> bool:
        self._enter_phase("researching")
        index = data.get("batch_index")
        self._rounds = index if isinstance(index, int) and index > 0 else self._rounds + 1
        intent = _clip(data.get("conclusion"), MAX_INTENT_CHARS) or f"Recherche-Runde {self._rounds}"
        self._begin_step(f"runde-{self._rounds}", "researching", intent)
        return True

    def _ingest_artifact(self, data: dict[str, Any]) -> bool:
        step = self._open_step
        if step is None:
            return False
        if data.get("type") == "citation_source":
            return step.add_doc(data)
        if data.get("type") == "todo":
            return _set_open_points(step, data.get("content"))
        if data.get("type") == "output" and data.get("output_category") == "research_notes":
            return _add_findings(step, data.get("content"))
        return False

    def _ingest_error(self, data: dict[str, Any]) -> bool:
        if next_run_status(self._status, "failed") != "failed":
            return False
        reason = _clip(data.get("error"), MAX_ERROR_REASON_CHARS)
        self._error_reason = reason or "Der Lauf ist fehlgeschlagen."
        self._status = "failed"
        self._flush_now = True
        return True

    def _ingest_cancelled(self) -> bool:
        self._status = next_run_status(self._status, "cancelled")
        self._flush_now = True
        return True

    def _ingest_degraded(self, data: dict[str, Any]) -> bool:
        if not data.get(TRUNCATED_KEY):
            return False
        self._status = next_run_status(self._status, "interrupted")
        return True

    def note_result(self, *, report_message_id: str | None = None, file_id: str | None = None) -> None:
        with self._lock:
            self._result = RunResult(
                fileId=_clip(file_id, MAX_REFERENCE_ID_CHARS) or None,
                reportMessageId=_clip(report_message_id, MAX_REFERENCE_ID_CHARS) or None,
                filedAt=_now(),
            )
            self._status = next_run_status(self._status, "done")  # Stored, so done; interrupted stands.
            self._flush_now = True
            self._dirty = True

    def _enter_phase(self, phase: str) -> None:
        if self._current_phase == phase:
            return
        if self._status == "created":
            self._status = "running"
        now = _now()
        for entry in self._phases:
            if entry.phase == self._current_phase and entry.ended_at is None:
                entry.ended_at = now
        self._current_phase = phase
        self._flush_now = True
        if any(entry.phase == phase for entry in self._phases):
            return
        self._phases.append(_Phase(phase=phase, started_at=now))

    def _begin_step(self, step_id: str, phase: str, intent: str) -> None:
        self._seal_open_step()
        if any(step.id == step_id for step in self._steps):
            return
        if len(self._steps) >= MAX_STEPS:
            return
        step = _Step(id=step_id, phase=phase, intent=intent, started_at=_now())
        self._steps.append(step)
        self._open_step = step

    def _seal_open_step(self) -> None:
        self._open_step = None

    def _schedule_flush(self) -> None:
        with self._lock:
            self._dirty = True
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(self.flush(), loop)
        except Exception:  # noqa: BLE001 — a loop that will not take work costs a flush, not a run
            logger.debug("Job %s: could not schedule a run-ledger flush", self._job_id, exc_info=True)

    async def flush(self, *, force: bool = False) -> None:
        try:
            await self._flush(force=force)
        except Exception:  # noqa: BLE001 — best-effort by contract; see the module docstring
            logger.warning("Job %s: a run-ledger flush failed", self._job_id, exc_info=True)

    async def _flush(self, *, force: bool) -> None:
        with self._lock:
            if not self._dirty and not force:
                return
            if not (force or self._flush_now or self._debounce_elapsed()):
                return
            self._dirty = False
            self._flush_now = False
            self._last_flush = time.monotonic()
            self._updated_at = _now()
            snapshot = self._ledger_wire()
            body = self._pending_append()

        self._emit_snapshot(snapshot)
        if body is None or not self._run_id:
            return
        if await self._client.append(self._run_id, body):
            self._mark_sent(body)

    def _debounce_elapsed(self) -> bool:
        return (time.monotonic() - self._last_flush) >= self.DEBOUNCE_SECONDS

    async def close(self, *, status: RunStatus | None = None) -> None:
        with self._lock:
            self._seal_open_step()
            if status is not None:
                self._status = next_run_status(self._status, status)
            self._finished_at = _now()
            self._flush_now = True
        await self.flush(force=True)
        await self._send_finish()

    async def _send_finish(self) -> None:
        with self._lock:
            run_id, result, reason = self._run_id, self._result, self._error_reason
        if not run_id or (result is None and reason is None):
            return
        error = RunFinishError(reason=reason) if result is None else None
        try:
            await self._client.finish(run_id, RunLedgerFinishRequest(result=result, error=error))
        except Exception:  # noqa: BLE001 — best-effort by contract
            logger.warning("Job %s: the run ledger could not be finished", self._job_id, exc_info=True)

    def snapshot(self) -> dict[str, Any] | None:
        with self._lock:
            return self._ledger_wire()

    def _ledger_wire(self) -> dict[str, Any] | None:
        try:
            return to_wire(self._ledger())
        except Exception:  # noqa: BLE001 — a payload this tier cannot build is a log line, not a failure
            logger.warning("Job %s: the run ledger could not be built", self._job_id, exc_info=True)
            return None

    def _ledger(self) -> RunLedger:
        error = None
        if self._error_reason is not None:
            completed = [entry.phase for entry in self._phases if entry.ended_at]
            error = RunError(reason=self._error_reason, completedBefore=completed)
        return RunLedger(
            runId=self._run_id or self._job_id,
            status=self._status,
            phases=[entry.wire() for entry in self._phases],
            steps=[step.wire() for step in self._steps],
            result=self._result,
            error=error,
            basis=list(self._basis) or None,
            startedAt=self._started_at,
            updatedAt=self._updated_at,
            finishedAt=self._finished_at,
        )

    def _pending_append(self) -> RunLedgerAppendRequest | None:
        phases = [entry.wire() for entry in self._phases if self._sent_phases.get(entry.phase, "") != entry.ended_at]
        steps = [step.wire() for step in self._steps if step is not self._open_step and step.id not in self._sent_steps]
        status = self._status if self._status != self._sent_status else None
        basis = list(self._basis) if len(self._basis) != self._sent_basis else None
        if not phases and not steps and status is None and basis is None:
            return None
        return RunLedgerAppendRequest(steps=steps or None, phases=phases or None, status=status, basis=basis)

    def _mark_sent(self, body: RunLedgerAppendRequest) -> None:
        with self._lock:
            for step in body.steps or []:
                self._sent_steps.add(step.id)
            for entry in body.phases or []:
                self._sent_phases[entry.phase] = entry.ended_at
            if body.status is not None:
                self._sent_status = body.status
            if body.basis is not None:
                self._sent_basis = len(body.basis)

    def _emit_snapshot(self, ledger: dict[str, Any] | None) -> None:
        if ledger is None or self._event_store is None:
            return
        try:
            self._event_store.store({"type": RUN_LEDGER_EVENT_TYPE, "data": {"ledger": ledger}})
        except Exception:  # noqa: BLE001 — best-effort by contract
            logger.warning("Job %s: could not emit the run.ledger snapshot", self._job_id, exc_info=True)


class FoldingEventStore:
    def __init__(self, event_store: Any, fold: RunLedgerFold) -> None:
        self._event_store = event_store
        self._fold = fold

    @property
    def job_id(self) -> str | None:
        return getattr(self._event_store, "job_id", None)

    def store(self, event: dict[str, Any]) -> None:
        self._fold.observe(event)
        self._event_store.store(event)

    def store_batch(self, events: list[dict[str, Any]]) -> None:
        for event in events:
            self._fold.observe(event)
        self._event_store.store_batch(events)

    def flush(self) -> None:
        flush = getattr(self._event_store, "flush", None)
        if flush is not None:
            flush()


def _basis_doc(row: Any) -> RunLedgerDoc | None:
    if not isinstance(row, dict):
        return None
    name = _clip(row.get("name") or row.get("file_name"), MAX_NAME_CHARS)
    if not name:
        return None
    title = _clip(row.get("title"), MAX_TITLE_CHARS)
    return RunLedgerDoc(
        name=name,
        title=title if title and title != name else None,
        shelf=_clip(row.get("shelf"), MAX_SHELF_CHARS) or None,
        loci=[],
    )


def _add_findings(step: _Step, content: Any) -> bool:
    before = len(step.findings)
    for claim in _claims(content):
        if claim not in step.findings and len(step.findings) < MAX_FINDINGS_PER_STEP:
            step.findings.append(claim)
    return len(step.findings) > before


def _claims(content: Any) -> list[str]:
    if not isinstance(content, str):
        return []
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[4:] if text.startswith("json") else text
    start = text.find("{")
    if start < 0:
        return []
    try:
        notes = json.loads(text[start:])
    except ValueError:
        return []
    if not isinstance(notes, dict) or not isinstance(notes.get("findings"), list):
        return []
    claims: list[str] = []
    for finding in notes["findings"]:
        claim = _clip(finding.get("claim") if isinstance(finding, dict) else None, MAX_FINDING_CHARS)
        if claim:
            claims.append(claim)
    return claims


def _set_open_points(step: _Step, todos: Any) -> bool:
    if not isinstance(todos, list):
        return False
    points: list[str] = []
    for todo in todos:
        text = _open_point_text(todo)
        if text and text not in points and len(points) < MAX_OPEN_POINTS:
            points.append(text)
    if points == step.open_points:
        return False
    step.open_points = points
    return True


def _open_point_text(todo: Any) -> str | None:
    if not isinstance(todo, dict):
        return _clip(todo, MAX_OPEN_POINT_CHARS) or None
    if str(todo.get("status") or "").lower() == "completed":
        return None
    return _clip(todo.get("content") or todo.get("task") or todo.get("title"), MAX_OPEN_POINT_CHARS) or None


def _running_loop() -> asyncio.AbstractEventLoop | None:
    try:
        return asyncio.get_running_loop()
    except RuntimeError:
        return None
