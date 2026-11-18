from __future__ import annotations

import asyncio
import logging
from typing import Any
from typing import get_args

from agent import project_context
from agent.cards.workspace_cards import TaskKind
from agent.common.bff_http import SignedEnvelope
from agent.common.brand import PRODUCT_NAME
from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import register_function

from .cards import emit_task_card
from .client import DelegationError
from .client import post_task

logger = logging.getLogger(__name__)

MAX_GOAL_CHARS = 500

MAX_CADENCE_CHARS = 120

TASK_KINDS: tuple[str, ...] = get_args(TaskKind)

LEGACY_TASK_KINDS: dict[str, str] = {"einreichcheck": "submission_check"}

_KIND_LIST = ", ".join(f"`{kind}`" for kind in TASK_KINDS)

_NO_PROJECT = (
    "Error: There is no project in this conversation, so there is no task that could belong to a "
    "project. Nothing was created. Do not retry."
)

_NO_ENVELOPE = (
    "Error: This run has no signed session credential, so no task can be created in a "
    "person's name. Nothing was created. Do not retry."
)


class _Refused(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def _envelope() -> SignedEnvelope:
    header, signature = project_context.get_request_envelope_from_context()
    if not header or not signature:
        raise _Refused(_NO_ENVELOPE)
    return SignedEnvelope(header=header, signature=signature)


def _project_or_refuse() -> str:
    project_id = project_context.get_project_id_from_context()
    if not project_id:
        raise _Refused(_NO_PROJECT)
    return project_id


def _kind_or_refuse(kind: str) -> str:
    normalized = (kind or "").strip().lower()
    normalized = LEGACY_TASK_KINDS.get(normalized, normalized)
    if normalized not in TASK_KINDS:
        raise _Refused(f"Error: `{kind}` is not a task kind. The possible kinds are {_KIND_LIST}. Nothing was created.")
    return normalized


def _goal_or_refuse(goal: str) -> str:
    text = " ".join((goal or "").split())
    if not text:
        raise _Refused("Error: A task needs a description of what is to be done. Nothing was created.")
    return text[:MAX_GOAL_CHARS]


def _cadence_or_refuse(cadence: str) -> str:
    text = " ".join((cadence or "").split())
    if not text:
        raise _Refused("Error: A recurring task needs a schedule. Nothing was created.")
    if len(text) > MAX_CADENCE_CHARS:
        raise _Refused("Error: The schedule is too long. Nothing was created.")
    return text


async def _post(payload: dict[str, Any], envelope: SignedEnvelope) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(post_task, payload, envelope)
    except DelegationError as exc:
        raise _Refused(
            f"Error creating the task: {exc}. Nothing was created; tell the user that the task was not accepted."
        ) from exc


_QUEUED = (
    "The task is created and running; it is NOT done. Say in one sentence that you are "
    "taking care of it and will get back — do not claim the result is already available."
)

_SCHEDULED = (
    "The task is created as a recurring schedule; the first run starts at the given "
    "time, not now. Say in one sentence that the schedule is set and when it first "
    "runs — do not claim anything is already done."
)

_CREATE_TASK_DESCRIPTION = (
    "Creates a task that you carry out on your own after this conversation, reporting back "
    "when it is done. Call it when the user asks for work that takes longer than this "
    "answer („mach den Einreichcheck bis Freitag“, „@" + PRODUCT_NAME + " prüf das“, „schreib mir bis Montag den "
    "Aktenvermerk“) — not for a question that can be answered now. "
    "`kind` is one of " + _KIND_LIST + ": `compliance_check` is the norm check of a document "
    "against the OIB guidelines, `submission_check` checks the completeness of the "
    "submission (Einreichung), `document` "
    "writes a document and files it as a draft, `revision` revises a returned "
    "draft. "
    "`goal` is the task in the user's words. `due` is optionally the desired date as "
    "`YYYY-MM-DD` — convert „bis Freitag“ to a date yourself, do not pass text. "
    "`cadence` is optionally a 5-field cron for recurring tasks („jeden Montag“ → "
    "`0 8 * * 1`, UTC): it creates a schedule instead of a single run; it needs the "
    "permission `project:skills:manage`, and without it it is refused. "
    "The task runs with the user's rights and costs their budget. After the call the "
    "work is CREATED, not done. "
    "A task belongs to a project: without a project in this conversation none is created; tell "
    "the user so instead of retrying."
)


class CreateTaskConfig(FunctionBaseConfig, name="create_task"): ...


async def _create(kind: str, goal: str, due: str, cadence: str) -> str:
    project_id = _project_or_refuse()
    envelope = _envelope()
    chosen_kind = _kind_or_refuse(kind)
    chosen_goal = _goal_or_refuse(goal)

    payload: dict[str, Any] = {
        "op": "create",
        "projectId": project_id,
        "kind": chosen_kind,
        "goal": chosen_goal,
    }
    if (due or "").strip():
        payload["due"] = due.strip()
    if (cadence or "").strip():
        payload["cadence"] = _cadence_or_refuse(cadence)

    body = await _post(payload, envelope)
    emit_task_card(body, goal=chosen_goal, kind=chosen_kind)
    title = str(body.get("title") or chosen_goal)
    if body.get("scheduled"):
        next_run = str(body.get("nextRunAt") or "").strip()
        first_run = f" The first run is planned for {next_run}." if next_run else ""
        return f"Schedule created: „{title}“.{first_run} {_SCHEDULED}"
    return f"Task created: „{title}“. {_QUEUED}"


async def run_create_task(kind: str, goal: str, due: str = "", cadence: str = "") -> str:
    try:
        return await _create(kind, goal, due, cadence)
    except _Refused as refused:
        return refused.message


@register_function(config_type=CreateTaskConfig)
async def create_task(tool_config: CreateTaskConfig, builder: Builder):
    yield FunctionInfo.from_fn(run_create_task, description=_CREATE_TASK_DESCRIPTION)
