from __future__ import annotations

import json
import logging
from typing import Any

from agent.common.status_keys import KEY_ACTION_ANNOTATIONS_DELETE
from agent.common.status_keys import KEY_ACTION_ANNOTATIONS_PROPOSE
from agent.common.status_keys import KEY_ACTION_ANNOTATIONS_READ
from agent.common.status_keys import KEY_ACTION_ANNOTATIONS_REPLY
from agent.common.status_keys import KEY_ACTION_ANNOTATIONS_SET
from agent.common.status_keys import KEY_ACTION_ANNOTATIONS_UPDATE
from agent.common.status_keys import KEY_ACTION_CARD
from agent.common.status_keys import KEY_ACTION_CODE_RUN
from agent.common.status_keys import KEY_ACTION_DRAFT_EDIT
from agent.common.status_keys import KEY_ACTION_DRAFT_FILED
from agent.common.status_keys import KEY_ACTION_DRAFT_LIST
from agent.common.status_keys import KEY_ACTION_DRAFT_READ
from agent.common.status_keys import KEY_ACTION_DRAFT_SUBMITTED
from agent.common.status_keys import KEY_ACTION_DRAFT_WRITE
from agent.common.status_keys import KEY_ACTION_FILE_PROPOSAL
from agent.common.status_keys import KEY_ACTION_LOOK
from agent.common.status_keys import KEY_ACTION_REMEMBER
from agent.common.status_keys import KEY_ACTION_TASK_CREATED
from agent.common.status_keys import KEY_ACTION_WORKSPACE_CALL
from agent.common.status_keys import KEY_RETRIEVAL_CLAUSE
from agent.common.status_keys import KEY_RETRIEVAL_PAGE
from agent.common.turn_status import clip
from agent.common.workspace_records import is_workspace_call

logger = logging.getLogger(__name__)

KNOWLEDGE_SEARCH_TOOL = "knowledge_search"


READ_PASSAGE_TOOL = "read_passage"


READ_FILE_TOOL = "read_file"


_LEGAL_DATABASE_CORPUS = "ris"

_SEARCH_CORPORA: tuple[tuple[str, str], ...] = (
    (KNOWLEDGE_SEARCH_TOOL, "knowledge"),
    (READ_PASSAGE_TOOL, "knowledge"),
    ("ris_", _LEGAL_DATABASE_CORPUS),
    ("law_lookup", _LEGAL_DATABASE_CORPUS),
    ("advanced_web_search", "web"),
    ("web_search", "web"),
    ("surface_documents", "documents"),
    ("list_files", "documents"),
    ("ifc_", "ifc"),
    ("dxf_measure", "documents"),
    ("project_lookup", "otherProjects"),
)


_ACTION_KEYS = {
    "remember": KEY_ACTION_REMEMBER,
    "emit_card": KEY_ACTION_CARD,
    "ls": KEY_ACTION_DRAFT_LIST,
    "read_file": KEY_ACTION_DRAFT_READ,
    "write_file": KEY_ACTION_DRAFT_WRITE,
    "edit_file": KEY_ACTION_DRAFT_EDIT,
    "propose_file_change": KEY_ACTION_FILE_PROPOSAL,
    "file_draft": KEY_ACTION_DRAFT_FILED,
    "execute": KEY_ACTION_CODE_RUN,
    "create_task": KEY_ACTION_TASK_CREATED,
    "marks": KEY_ACTION_ANNOTATIONS_READ,
    "mark": KEY_ACTION_ANNOTATIONS_PROPOSE,
    "update": KEY_ACTION_ANNOTATIONS_UPDATE,
    "delete": KEY_ACTION_ANNOTATIONS_DELETE,
    "reply": KEY_ACTION_ANNOTATIONS_REPLY,
    "look": KEY_ACTION_LOOK,
}


def _flag(args: Any, name: str) -> bool:
    return isinstance(args, dict) and str(args.get(name)).strip().lower() == "true"


def action_status_key(base: str, args: Any, name: str = "") -> str | None:
    if is_workspace_call(name):
        return KEY_ACTION_WORKSPACE_CALL
    if base == "file_draft" and _flag(args, "submit"):
        return KEY_ACTION_DRAFT_SUBMITTED
    if base == "mark" and _flag(args, "open"):
        return KEY_ACTION_ANNOTATIONS_SET
    return _ACTION_KEYS.get(base)


_QUERY_KEYS = ("query", "search_query", "question", "q", "text", "name_contains", "pattern")


_SELECTOR_ARGS = frozenset({"action", "scope", "path", "file_path", "glob", "output_mode", "mode", "match"})


def _is_selector(name: str) -> bool:
    return name in _SELECTOR_ARGS or name.endswith("_id")


CONCLUSION_ARG = "conclusion"


CONCLUSION_DESCRIPTION = "Optional: one line on what you are looking for, shown to the person. No effect on the result."


CHECKPOINT_FROM_ARGUMENT = "argument"


CHECKPOINT_FROM_PROSE = "prose"


CHECKPOINT_FROM_NONE = "none"


LOCATOR_TOOL_BASENAMES = frozenset({READ_PASSAGE_TOOL, READ_FILE_TOOL})


MAX_DOCUMENT_CHARS = 32


_TOOL_NAME_SEPARATORS = ("__", ".")


def tool_basename(tool_name: str) -> str:
    base = tool_name or ""
    for separator in _TOOL_NAME_SEPARATORS:
        if separator in base:
            base = base.rsplit(separator, 1)[-1]
    return base


def _search_corpus(base: str) -> str | None:
    for prefix, corpus in _SEARCH_CORPORA:
        if base.startswith(prefix):
            return corpus
    return None


FILESYSTEM_READ_TOOLS = frozenset({"ls", "glob", "grep", READ_FILE_TOOL})


def call_corpus(base: str, args: Any) -> str | None:
    if base not in FILESYSTEM_READ_TOOLS:
        return _search_corpus(base)
    from agent.common.estate_paths import call_mount

    mount = call_mount(base, args)
    if mount in (None, "drafts", "skills"):
        return None
    return "knowledge" if mount == "law" else "documents"


def tool_fetches_evidence(base: str) -> bool:
    if base in FILESYSTEM_READ_TOOLS:
        return True
    return bool(base) and _search_corpus(base) is not None


SKILLS_ROOT = "/skills/"


def is_skill_read(call: Any) -> bool:
    if not isinstance(call, dict) or tool_basename(str(call.get("name") or "")) != "read_file":
        return False
    args = call.get("args")
    path = args.get("file_path") if isinstance(args, dict) else None
    return isinstance(path, str) and path.startswith(SKILLS_ROOT)


def is_search_call(call: Any) -> bool:
    if not isinstance(call, dict):
        return False
    base = tool_basename(str(call.get("name") or ""))
    if base in FILESYSTEM_READ_TOOLS:
        return call_corpus(base, call.get("args")) is not None
    return tool_fetches_evidence(base)


def is_retrieval_round(tool_calls: list[dict[str, Any]] | None) -> bool:
    return any(is_search_call(call) for call in tool_calls or ())


_SIGNATURE_SEPARATOR = "\x1f"


def _argument_text(args: dict[str, Any], name: str, *, fold_case: bool = False) -> str:
    value = args.get(name)
    text = str(value).strip() if value is not None else ""
    return text.casefold() if fold_case else text


def _page_text(value: Any) -> str:
    text = str(value).strip() if value is not None else ""
    if not text:
        return ""
    try:
        return str(int(text))
    except ValueError:
        return text


def _pages_text(value: Any) -> str:
    text = str(value).strip() if value is not None else ""
    return "".join(text.replace("\u2013", "-").replace("\u2014", "-").lower().split())


def _search_signature(args: dict[str, Any]) -> str:
    filters = args.get("filters")
    canonical = (
        json.dumps(filters, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str) if filters else ""
    )
    parts = [
        "knowledge_search",
        " ".join(str(args.get("query") or "").split()).casefold(),
        _argument_text(args, "doc_class"),
        _argument_text(args, "title_contains"),
        _argument_text(args, "file_name", fold_case=True),
        _argument_text(args, "folder"),
        canonical,
    ]
    if str(args.get("match") or "").strip().lower() == "exact":
        parts.append("exact")
    return _SIGNATURE_SEPARATOR.join(parts)


def _clause_argument(args: dict[str, Any]) -> str:
    return _argument_text(args, "clause") or _argument_text(args, "punkt")


def _passage_signature(args: dict[str, Any]) -> str:
    return _SIGNATURE_SEPARATOR.join(
        [
            "read_passage",
            _argument_text(args, "document", fold_case=True),
            _clause_argument(args).strip("."),
            _page_text(args.get("page")),
            _pages_text(args.get("pages")),
            str(args.get("cursor") or "").strip(),
        ]
    )


FETCH_FAILED_MARKER = "[fetch failed]"


def fetch_signature(call: Any) -> str | None:
    if not isinstance(call, dict):
        return None
    args = call.get("args")
    if not isinstance(args, dict):
        return None
    base = tool_basename(str(call.get("name") or ""))
    if base == "knowledge_search":
        return _search_signature(args)
    if base == "read_passage":
        return _passage_signature(args)
    if base in (READ_FILE_TOOL, "grep"):
        return _filesystem_signature(base, args)
    return None


def _filesystem_signature(base: str, args: dict[str, Any]) -> str | None:
    from agent.common.estate_paths import nfc
    from agent.common.estate_paths import reaches_drafts_only

    if reaches_drafts_only(base, args):
        return None
    if base == READ_FILE_TOOL and not _argument_text(args, "file_path"):
        return None
    if base == READ_FILE_TOOL:
        parts = [
            READ_FILE_TOOL,
            nfc(_argument_text(args, "file_path", fold_case=True)),
            _pages_text(args.get("pages")),
            _clause_argument(args).strip("."),
            _page_text(args.get("offset")),
            _page_text(args.get("limit")),
        ]
        return _SIGNATURE_SEPARATOR.join(parts)
    return _SIGNATURE_SEPARATOR.join(
        [
            "grep",
            " ".join(str(args.get("pattern") or "").split()).casefold(),
            nfc(_argument_text(args, "path", fold_case=True)),
            _argument_text(args, "glob", fold_case=True),
            _argument_text(args, "output_mode") or "files_with_matches",
            _argument_text(args, "mode") or "exact",
            _argument_text(args, "stemmed", fold_case=True),
            _argument_text(args, "context"),
            _argument_text(args, "max_count"),
        ]
    )


def locator_line(args: Any) -> tuple[str, dict[str, str]] | None:
    if not isinstance(args, dict):
        return None
    document = str(args.get("document") or "").strip() or _file_path_document(args)
    if not document:
        return None
    values = {"document": clip(document, MAX_DOCUMENT_CHARS)}
    clause = _clause_argument(args).strip()
    if clause:
        return KEY_RETRIEVAL_CLAUSE, {**values, "clause": clause}
    page = args.get("page")
    if page is None or not str(page).strip():
        page = args.get("pages")
    if page is not None and str(page).strip():
        return KEY_RETRIEVAL_PAGE, {**values, "page": str(page).strip()}
    return None


def _file_path_document(args: dict[str, Any]) -> str:
    path = str(args.get("file_path") or "").strip().rstrip("/")
    if not path:
        return ""
    leaf = path.rsplit("/", 1)[-1]
    stem = leaf[:-3] if leaf.lower().endswith(".md") and "." in leaf[:-3] else leaf
    return stem


def query_text(args: Any) -> str | None:
    if not isinstance(args, dict):
        return None
    for key in _QUERY_KEYS:
        value = args.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    for name, value in args.items():
        if name == CONCLUSION_ARG or _is_selector(name):
            continue
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _conclusion_argument(calls: list[dict[str, Any]]) -> str | None:
    for call in calls:
        args = call.get("args")
        if not isinstance(args, dict):
            continue
        value = args.get(CONCLUSION_ARG)
        if isinstance(value, str) and value.strip():
            return " ".join(value.split())
    return None


def resolve_conclusion(calls: list[dict[str, Any]], prose: str | None) -> tuple[str, str]:
    argument = _conclusion_argument(calls)
    if argument:
        return argument, CHECKPOINT_FROM_ARGUMENT
    text = " ".join(str(prose).split()) if prose else ""
    if text:
        return text, CHECKPOINT_FROM_PROSE
    return "", CHECKPOINT_FROM_NONE
