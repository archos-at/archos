from __future__ import annotations

import json
import re
from collections.abc import Container
from dataclasses import dataclass
from dataclasses import field
from typing import Any
from uuid import uuid4

from agent.cards.registry import get_card_registry
from agent.common import turn_status
from agent.common.status_keys import KEY_ACTION_CALCULATION
from agent.common.status_keys import KEY_ACTION_FILE_CHECK
from agent.common.status_keys import KEY_ACTION_FILE_EDIT
from agent.common.status_keys import KEY_ACTION_FILE_MAKE
from agent.common.status_keys import KEY_ACTION_FILE_RETRY
from agent.common.status_keys import KEY_ACTION_FILES_MAKE
from agent.common.turn_status import clip
from agent.common.turn_status import status_step

from ..documents.draft_store import DRAFT_ROOT
from .runner_client import WORKSPACE
from .trace import KeptFile
from .trace import file_type

SLOT_PREFIX = "file-run:"

HELD_PLAN = "execute_plan"

INPUT_PREFIX = f"{WORKSPACE}in/"

MAX_NAME_CHARS = 120

MAX_RESULT_CHARS = 80

MAX_LISTED = 8

_PATH_LITERAL = re.compile(r"""(["'`])(/workspace/[^"'`$\n]+?\.[A-Za-z0-9]{1,5})\1""")

_TEMPLATE_PATH = re.compile(r"""`(/workspace/[^`\n]*\$\{[^`\n]*\.[A-Za-z0-9]{1,5})`""")

_TEMPLATE_PART = re.compile(r"\$\{[^}]*\}")

UNNAMED_PART = "…"

REASON_TOO_LARGE = "too_large"

REASON_NOT_WRITTEN = "not_written"

_READ_CALL = re.compile(r"readFile\w*\(\s*$")

_WRITE_CALL = re.compile(r"(?:writeFile|appendFile)\w*\(\s*$")

_ASSIGNED = re.compile(r"(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$")

WRITE = "write"

READ = "read"


@dataclass(frozen=True)
class RunPlan:
    writes: tuple[str, ...] = ()
    reads: tuple[str, ...] = ()
    editing: tuple[str, ...] = ()
    written: tuple[str, ...] = ()


@dataclass(frozen=True)
class _Held:
    writes: tuple[str, ...]
    attempt: int
    made: bool


def _name(path: str) -> str:
    for root in (WORKSPACE, DRAFT_ROOT):
        if path.startswith(root):
            return clip(path[len(root) :], MAX_NAME_CHARS)
    return clip(path, MAX_NAME_CHARS)


def _role(code: str, start: int) -> str:
    before = code[:start]
    if _WRITE_CALL.search(before):
        return WRITE
    if _READ_CALL.search(before):
        return READ
    assigned = _ASSIGNED.search(before)
    if assigned is None:
        return ""
    name = re.escape(assigned.group(1))
    if re.search(rf"(?:writeFile|appendFile)\w*\(\s*{name}\b", code):
        return WRITE
    if re.search(rf"readFile\w*\(\s*{name}\b", code):
        return READ
    return ""


def _named_paths(code: str) -> list[tuple[str, str]]:
    literal = [(match.start(), match.group(2)) for match in _PATH_LITERAL.finditer(code)]
    template = [
        (match.start(), _TEMPLATE_PART.sub(UNNAMED_PART, match.group(1))) for match in _TEMPLATE_PATH.finditer(code)
    ]
    return [
        (path, _role(code, start)) for start, path in sorted(literal + template) if not path.startswith(INPUT_PREFIX)
    ]


def plan_run(code: str, existing: Container[str]) -> RunPlan:
    named = _named_paths(code)
    writes = list(dict.fromkeys(path for path, role in named if role != READ))
    reads = list(dict.fromkeys(path for path, role in named if role == READ and path in existing))
    checked = tuple(path for path in reads if path not in writes)
    written = tuple(dict.fromkeys(path for path, role in named if role == WRITE))
    return RunPlan(tuple(writes), checked, tuple(path for path in writes if path in existing), written)


def _scalar_result(value: Any) -> str | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float | str):
        text = " ".join(str(value).split())
        return clip(text, MAX_RESULT_CHARS) if text else None
    if isinstance(value, dict) and 0 < len(value) <= 3 and all(isinstance(v, int | float) for v in value.values()):
        return clip(json.dumps(value, ensure_ascii=False), MAX_RESULT_CHARS)
    return None


@dataclass
class FileRunProgress:
    plan: RunPlan
    documents: list[tuple[str, str | None]] = field(default_factory=list)
    attempt: int = 1
    slot: str = field(default_factory=lambda: f"{SLOT_PREFIX}{uuid4().hex[:12]}")

    @classmethod
    def begin(cls, code: str, existing: Container[str], documents: list[tuple[str, str | None]]) -> FileRunProgress:
        plan = plan_run(code, existing)
        progress = cls(plan, documents, attempt=_attempt(plan.writes))
        progress._emit(started=True)
        return progress

    def _key(self) -> tuple[str, dict[str, Any]]:
        plan = self.plan
        writes = plan.writes
        if len(writes) > 1:
            return KEY_ACTION_FILES_MAKE, {"count": len(writes)}
        if writes:
            values = {"file": _name(writes[0]), "format": file_type(writes[0])}
            if self.attempt > 1:
                return KEY_ACTION_FILE_RETRY, values
            return (KEY_ACTION_FILE_EDIT if plan.editing else KEY_ACTION_FILE_MAKE), values
        if plan.reads:
            return KEY_ACTION_FILE_CHECK, {"file": _name(plan.reads[0]), "format": file_type(plan.reads[0])}
        return KEY_ACTION_CALCULATION, {}

    def _detail(self) -> dict[str, Any]:
        named = self.documents[:MAX_LISTED]
        return {
            "attempt": self.attempt,
            "writes": [_name(path) for path in self.plan.writes[:MAX_LISTED]],
            "editing": [_name(path) for path in self.plan.editing[:MAX_LISTED]],
            "reads": [_name(path) for path in self.plan.reads[:MAX_LISTED]],
            "documents": [clip(name, MAX_NAME_CHARS) for name, _ in named],
            "document_ids": [document_id or "" for _, document_id in named],
        }

    def _emit(self, *, started: bool, **finished: Any) -> None:
        key, values = self._key()
        step = status_step(self.slot, key, values=values, **self._detail(), **finished)
        turn_status.emit_step(step, started=started)

    def finish(
        self,
        status: str,
        *,
        kept: list[KeptFile],
        elapsed_ms: int,
        value: Any = None,
        refused: tuple[str, ...] = (),
    ) -> None:
        made = [_name(file.path) for file in kept if file.new]
        changed = [_name(file.path) for file in kept if not file.new]
        failed = _not_kept(self.plan, kept, refused) if status == "ok" else []
        result = _scalar_result(value) if status == "ok" and not kept and not failed else None
        _hold(_Held(self.plan.writes, self.attempt, bool(kept) and status == "ok" and not failed))
        self._emit(
            started=False,
            status=status,
            made=made[:MAX_LISTED],
            changed=changed[:MAX_LISTED],
            failed=[name for name, _ in failed][:MAX_LISTED],
            failed_reasons=[reason for _, reason in failed][:MAX_LISTED],
            elapsed_ms=max(0, elapsed_ms),
            result=result,
        )


def _not_kept(plan: RunPlan, kept: list[KeptFile], refused: tuple[str, ...]) -> list[tuple[str, str]]:
    kept_names = {_name(file.path) for file in kept}
    failed = [(_name(path), REASON_TOO_LARGE) for path in refused]
    named = {name for name, _ in failed}
    for path in plan.written:
        name = _name(path)
        unchanged = path in plan.editing
        if unchanged or name in kept_names or name in named or (UNNAMED_PART in name and (kept or failed)):
            continue
        failed.append((name, REASON_NOT_WRITTEN))
    return failed


def _attempt(writes: tuple[str, ...]) -> int:
    registry = get_card_registry()
    if registry is None or not writes:
        return 1
    held = registry.held(HELD_PLAN)
    last = held[-1] if held else None
    if isinstance(last, _Held) and last.writes == writes and not last.made:
        return last.attempt + 1
    return 1


def _hold(entry: _Held) -> None:
    registry = get_card_registry()
    if registry is not None:
        registry.hold(HELD_PLAN, entry)
