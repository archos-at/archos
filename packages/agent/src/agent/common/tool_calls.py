"""What each tool call is.

Its base name, its corpus, whether it fetches evidence, and the signature a
repeat is recognised by.

Pure functions over a call's name and arguments, shared by the status lines, the
retrieval-round guards and the action rows.
"""

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
    "create_task": KEY_ACTION_TASK_CREATED,
    "marks": KEY_ACTION_ANNOTATIONS_READ,
    "mark": KEY_ACTION_ANNOTATIONS_PROPOSE,
    "update": KEY_ACTION_ANNOTATIONS_UPDATE,
    "delete": KEY_ACTION_ANNOTATIONS_DELETE,
    "reply": KEY_ACTION_ANNOTATIONS_REPLY,
    "look": KEY_ACTION_LOOK,
}


def _flag(args: Any, name: str) -> bool:
    """Whether a boolean argument is on. `str(True)` is "True": a boolean and a model that quoted it read alike."""
    return isinstance(args, dict) and str(args.get(name)).strip().lower() == "true"


def action_status_key(base: str, args: Any, name: str = "") -> str | None:
    """The live-line key for a non-retrieval tool call, read from its arguments where they decide it.

    One tool, two promises: ``file_draft`` with ``submit`` hands the draft to a
    reviewer, and the filing line would describe only the half of that call
    which asks nobody for anything. Likewise ``mark`` with ``open`` sets a mark
    in the person's name, which the proposal line would understate.
    """
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
    """The final segment of a (possibly group-qualified) tool name."""
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
    """The corpus one call reads: by its tool, and for a filesystem tool by its mount.

    A call under ``/drafts/`` reads no corpus (it keeps its draft line); one on
    ``/law/oib/`` reads the knowledge corpus; any other estate call reads the
    reader's own files, „in Ihren Unterlagen“.
    """
    if base not in FILESYSTEM_READ_TOOLS:
        return _search_corpus(base)
    from agent.common.estate_paths import call_mount

    mount = call_mount(base, args)
    if mount in (None, "drafts", "skills"):
        return None
    return "knowledge" if mount == "law" else "documents"


def tool_fetches_evidence(base: str) -> bool:
    """Does a tool with this BASENAME return hits of its own?

    The same question :func:`is_search_call` answers, asked of a name rather
    than of a call, because a stored round announcement keeps basenames and
    not the calls they came from. The retrieval ledger reads it to tell which
    of a round's tools could have produced the documents it returned.
    """
    if base in FILESYSTEM_READ_TOOLS:
        return True
    return bool(base) and _search_corpus(base) is not None


SKILLS_ROOT = "/skills/"


def is_skill_read(call: Any) -> bool:
    """Is this ONE tool call a ``read_file`` of a skill (ADR-0135)?

    Such a read is not narrated as a tool: the skills substrate announces the
    activation with the skill's own title (``skills.events``), and a draft-read
    line for it would say the wrong thing.
    """
    if not isinstance(call, dict) or tool_basename(str(call.get("name") or "")) != "read_file":
        return False
    args = call.get("args")
    path = args.get("file_path") if isinstance(args, dict) else None
    return isinstance(path, str) and path.startswith(SKILLS_ROOT)


def is_search_call(call: Any) -> bool:
    """Does this ONE tool call fetch evidence from a corpus?

    The atom under :func:`is_retrieval_round`: an interaction call
    (``emit_card``, ``remember``), a skill load or an ``ask_user`` fetches no
    evidence and is not a search.
    """
    if not isinstance(call, dict):
        return False
    base = tool_basename(str(call.get("name") or ""))
    if base in FILESYSTEM_READ_TOOLS:
        return call_corpus(base, call.get("args")) is not None
    return tool_fetches_evidence(base)


def is_retrieval_round(tool_calls: list[dict[str, Any]] | None) -> bool:
    """Would :func:`emit_retrieval` count this batch of calls as a FETCH?

    The same predicate, exported, because two nodes need the same answer about
    the same batch: the agent node charges the round and advances the counter,
    the tools node stamps the hits with the round that counter was on. Deriving
    it twice from different rules is how the stamp and the spine layer would
    drift apart by one.
    """
    return any(is_search_call(call) for call in tool_calls or ())


_SIGNATURE_SEPARATOR = "\x1f"


def _argument_text(args: dict[str, Any], name: str, *, fold_case: bool = False) -> str:
    """One argument as a comparable string; absent and empty are the same thing."""
    value = args.get(name)
    text = str(value).strip() if value is not None else ""
    return text.casefold() if fold_case else text


def _page_text(value: Any) -> str:
    """A page number as its canonical decimal, or the raw text when it is not one."""
    text = str(value).strip() if value is not None else ""
    if not text:
        return ""
    try:
        return str(int(text))
    except ValueError:
        return text


def _pages_text(value: Any) -> str:
    """A ``pages`` range in one spelling (``"4 – 6"`` and ``"4-6"`` are one range), or the raw text."""
    text = str(value).strip() if value is not None else ""
    return "".join(text.replace("\u2013", "-").replace("\u2014", "-").lower().split())


def _search_signature(args: dict[str, Any]) -> str:
    """What a ``knowledge_search`` call ASKS FOR: the query plus every narrowing.

    The query is whitespace-folded and casefolded because the model rewrites
    its own query between rounds and a changed capital is not a changed
    question. Every narrowing argument is part of the identity: the same words
    against a different ``file_name`` or ``folder`` is a different corpus and a
    different answer, which is why (e) is not a repeat.
    """
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
    """The clause a ``read_passage`` call names: ``clause``, or ``punkt`` from a call made before the rename.

    A replayed turn and a model that learned the old name still send ``punkt``. Remove the
    fallback with the alias on ``ReadPassageInput``.
    """
    return _argument_text(args, "clause") or _argument_text(args, "punkt")


def _passage_signature(args: dict[str, Any]) -> str:
    """What a ``read_passage`` call OPENS: the document and the locus in it.

    ``clause`` (or ``punkt``, its former name) loses its surrounding dots because "3.5.2." and "3.5.2" are the
    same point printed two ways — the Richtlinien themselves print both — and
    the page stays part of the identity, so the same document at a different
    page is a different passage.
    """
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
    """What this ONE call would fetch, as a comparable id — ``None`` when it is not a fetch.

    The atom under the duplicate-fetch guard, and it lives here for the same
    reason :func:`is_search_call` does: this module already owns what the
    retrieval tools' arguments MEAN (:func:`locator_line` reads
    ``document``/``clause``/``page``, :data:`_QUERY_KEYS` reads the query), and
    a second reading of those argument names somewhere else would drift from
    this one without anything failing.

    Only the two tools that open a passage get a signature. Everything else is
    ``None`` and is therefore never withheld: two ``emit_card`` calls are two
    cards, two ``remember`` calls are two facts, and a repeated measurement or
    web search is not the same bytes twice. A call whose ``args`` are missing
    or not a dict is ``None`` as well — the conservative direction, since a
    guard that cannot read a call must not take it away.
    """
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
    """What an estate ``read_file`` OPENS or an estate ``grep`` LOOKS FOR; ``None`` for a call on ``/drafts/``.

    A draft read after ``edit_file`` is not a repeat: it reads what the edit
    changed, so a call under ``/drafts/`` is never signed (ADR-0133 §6). The
    path is case- and NFC-folded, so two spellings of one path are one read.
    """
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
    """The ``(key, values)`` for a round that OPENS a named passage.

    "Liest OIB-Richtlinie 2, Pkt. 3.5.2" is a different claim from "Sucht im
    OIB-Wissen": it says the passage was already identified and is being read,
    which is exactly the checkpoint the Herleitung draws. ``None`` when the call
    names no document — the round then falls back to the plain corpus line
    rather than printing a line with a hole in it.
    """
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
    """The document a ``read_file`` path names: its leaf, without the ``.md`` the text is served under."""
    path = str(args.get("file_path") or "").strip().rstrip("/")
    if not path:
        return ""
    leaf = path.rsplit("/", 1)[-1]
    stem = leaf[:-3] if leaf.lower().endswith(".md") and "." in leaf[:-3] else leaf
    return stem


def query_text(args: Any) -> str | None:
    """The retrieval query inside a tool call's arguments, or ``None``.

    Named keys first (a search tool's query is nearly always one of them), then
    the first non-empty string argument — a tool naming its query something
    unexpected should still show what was asked, and a tool with no string
    argument at all correctly shows nothing.
    """
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
    """The checkpoint sentence a round wrote INTO its tool calls, if any.

    First non-empty wins: a parallel batch is one round and therefore one
    checkpoint, and the calls are emitted together, so "the first one that said
    something" is the only ordering there is.
    """
    for call in calls:
        args = call.get("args")
        if not isinstance(args, dict):
            continue
        value = args.get(CONCLUSION_ARG)
        if isinstance(value, str) and value.strip():
            return " ".join(value.split())
    return None


def resolve_conclusion(calls: list[dict[str, Any]], prose: str | None) -> tuple[str, str]:
    """This round's checkpoint sentence and where it came from.

    The ARGUMENT wins. It is the one the prompt now asks for and the one a
    tool-calling model reliably produces; prose beside the calls stays as the
    fallback because a model that narrates anyway should not lose its
    checkpoint, and because a deployment pinned to an older prompt still has
    only that channel.
    """
    argument = _conclusion_argument(calls)
    if argument:
        return argument, CHECKPOINT_FROM_ARGUMENT
    text = " ".join(str(prose).split()) if prose else ""
    if text:
        return text, CHECKPOINT_FROM_PROSE
    return "", CHECKPOINT_FROM_NONE
