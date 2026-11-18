from __future__ import annotations

import re
from dataclasses import dataclass
from dataclasses import field
from dataclasses import replace

from agent.common import bff_http
from agent.common.knowledge_context import UNAVAILABLE
from agent.common.knowledge_context import KnowledgeContext
from agent.common.knowledge_context import parse_knowledge_context
from agent.knowledge.personal_memory import PERSONAL_MEMORY_HEADER
from agent.project_context import MEMORY_HEADER_MAX_CHARS
from agent.project_context import RequestContext
from agent.project_context import normalize_org_instructions
from agent.project_context import normalize_project_context

INTERNAL_TURN_CONTEXT_PATH = "/api/internal/turn-context"
REQUEST_TIMEOUT_SECONDS = 5


@dataclass(frozen=True)
class ContextBlocks:
    project_context: str | None
    project_memory: str | None
    org_instructions: str | None
    drew_on_other_projects: bool = False
    reference_projects: str | None = None
    workspace: str | None = None
    base_knowledge: str | None = None
    base_knowledge_labels: tuple[dict[str, object], ...] = ()
    knowledge_context: KnowledgeContext = UNAVAILABLE
    project_models: frozenset[str] | None = None
    timing: dict[str, float | str] = field(default_factory=dict)
    personal_memory: str | None = None
    temporary: bool = False


REFERENCE_PROJECTS_MAX_CHARS = 4000

WORKSPACE_MAX_CHARS = 6500

BASE_KNOWLEDGE_MAX_CHARS = 17_000

PERSONAL_MEMORY_MAX_CHARS = 1600

BASE_KNOWLEDGE_MAX_LABELS = 40


def _labels(value: object) -> tuple[dict[str, object], ...]:
    if not isinstance(value, list):
        return ()
    return tuple(item for item in value if isinstance(item, dict))[:BASE_KNOWLEDGE_MAX_LABELS]


OFFICE_CONVENTIONS_HEADER = "office conventions ("


def office_convention_lines(workspace: str | None) -> int:
    if not workspace:
        return 0
    lines = workspace.splitlines()
    starts = [index for index, line in enumerate(lines) if line.startswith(OFFICE_CONVENTIONS_HEADER)]
    if not starts:
        return 0
    return sum(1 for line in lines[starts[0] + 1 :] if line.startswith("- "))


def _bounded_lines(value: str | None, max_chars: int) -> str | None:
    if not value or not value.strip():
        return None
    kept: list[str] = []
    used = 0
    for line in value.strip().splitlines():
        if used + len(line) + 1 > max_chars:
            break
        kept.append(line)
        used += len(line) + 1
    return "\n".join(kept) or None


def _personal_memory(value: object) -> str | None:
    block = _bounded_lines(value if isinstance(value, str) else None, PERSONAL_MEMORY_MAX_CHARS)
    return block if block and block.startswith(PERSONAL_MEMORY_HEADER) else None


def personal_memory_lines(block: str | None) -> int:
    return sum(1 for line in (block or "").splitlines() if line.startswith("- "))


class TurnContextError(bff_http.BffError):
    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message, status=status)


def _nullable_text(data: dict[str, object], field: str) -> str | None:
    if field not in data:
        raise TurnContextError(f"the turn-context API omitted {field}")
    value = data[field]
    if value is not None and not isinstance(value, str):
        raise TurnContextError(f"the turn-context API returned an invalid {field}")
    return value


_TIMING_TOKEN = re.compile(r"^[a-z][a-z0-9-]{0,31}$")


def parse_server_timing(header: str | None) -> dict[str, float | str]:
    facts: dict[str, float | str] = {}
    for entry in (header or "").split(","):
        name, *params = (part.strip() for part in entry.split(";"))
        if not _TIMING_TOKEN.match(name):
            continue
        key = name.replace("-", "_")
        for param in params:
            label, _, value = param.partition("=")
            value = value.strip().strip('"')
            if label == "dur":
                try:
                    facts[f"bff_{key}_ms"] = round(float(value), 1)
                except ValueError:
                    continue
            elif label == "desc" and _TIMING_TOKEN.match(value):
                facts[f"bff_{key}_desc"] = value
    return facts


def _parse_blocks(body: object) -> ContextBlocks:
    if not isinstance(body, dict) or not isinstance(body.get("data"), dict):
        raise TurnContextError("the turn-context API returned an invalid data envelope")
    data = body["data"]
    return ContextBlocks(
        project_context=normalize_project_context(_nullable_text(data, "projectContext")),
        project_memory=normalize_project_context(
            _nullable_text(data, "projectMemory"), max_chars=MEMORY_HEADER_MAX_CHARS
        ),
        org_instructions=normalize_org_instructions(_nullable_text(data, "orgInstructions")),
        drew_on_other_projects=data.get("drewOnOtherProjects") is True,
        reference_projects=_bounded_lines(
            data.get("referenceProjects") if isinstance(data.get("referenceProjects"), str) else None,
            REFERENCE_PROJECTS_MAX_CHARS,
        ),
        workspace=_bounded_lines(
            data.get("workspace") if isinstance(data.get("workspace"), str) else None,
            WORKSPACE_MAX_CHARS,
        ),
        base_knowledge=_bounded_lines(
            data.get("baseKnowledge") if isinstance(data.get("baseKnowledge"), str) else None,
            BASE_KNOWLEDGE_MAX_CHARS,
        ),
        base_knowledge_labels=_labels(data.get("baseKnowledgeLabels")),
        knowledge_context=parse_knowledge_context(data.get("knowledgeContext")),
        project_models=_model_kinds(data.get("projectModels")),
        personal_memory=_personal_memory(data.get("personalMemory")),
        temporary=data.get("temporary") is True,
    )


def _model_kinds(value: object) -> frozenset[str] | None:
    if not isinstance(value, dict):
        return None
    return frozenset(kind for kind in ("ifc", "dxf") if value.get(kind) is True)


def with_base_knowledge(memory: str | None, base_knowledge: str | None) -> str | None:
    if not base_knowledge:
        return memory
    block = f"<office_base_knowledge>\n{base_knowledge}\n</office_base_knowledge>"
    return f"{memory}\n\n{block}" if memory else block


def fetch_turn_context(request: RequestContext, *, query: str | None = None) -> ContextBlocks:
    if not bff_http.internal_token():
        raise TurnContextError("INTERNAL_API_TOKEN is not configured for turn context")
    if not request.envelope_header or not request.envelope_signature:
        raise TurnContextError("signed requester credentials are required for turn context")
    payload: dict[str, str] = {}
    if query and query.strip():
        payload["query"] = query.strip()[:2000]
    envelope = bff_http.SignedEnvelope(header=request.envelope_header, signature=request.envelope_signature)
    try:
        response = bff_http.send(
            "POST",
            INTERNAL_TURN_CONTEXT_PATH,
            timeout=REQUEST_TIMEOUT_SECONDS,
            body=payload,
            headers=envelope.headers(),
        )
        body = response.json()
    except bff_http.BffNotConfiguredError as exc:
        raise TurnContextError("INTERNAL_API_TOKEN is not configured for turn context") from exc
    except bff_http.BffRefusedError as exc:
        raise TurnContextError(f"the turn-context API refused the call ({exc.status})", status=exc.status) from exc
    except bff_http.BffMalformedResponseError as exc:
        raise TurnContextError("the turn-context API returned malformed JSON") from exc
    except bff_http.BffError as exc:
        raise TurnContextError("the turn-context API could not be reached") from exc
    return replace(_parse_blocks(body), timing=parse_server_timing(response.server_timing or None))
