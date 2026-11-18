from __future__ import annotations

import logging
from typing import Any

from deepagents.backends import CompositeBackend
from deepagents.backends.protocol import BackendProtocol
from deepagents.middleware.filesystem import FilesystemMiddleware
from deepagents.middleware.filesystem import FilesystemPermission
from langchain_core.tools import BaseTool

from agent.project_context import get_conversation_id_from_context
from agent.skills import SKILLS_ROOT

from .draft_store import DRAFT_ROOT
from .draft_store import DraftBackend
from .draft_store import get_draft_backend
from .filesystem import DocumentFilesystem
from .filesystem import composite_backend
from .filesystem import with_bare_schema

logger = logging.getLogger(__name__)

DRAFT_TOOL_NAMES = ("ls", "read_file", "write_file", "edit_file")

ESTATE_TOOL_NAMES = ("ls", "read_file", "glob", "grep")

DRAFT_ONLY_TOOL_NAMES = ("write_file", "edit_file")

_WRITE_DESCRIPTIONS = {
    "write_file": (
        f"Writes a draft as Markdown at `{DRAFT_ROOT}<name>.md` (short, lowercase, hyphens). For a commissioned "
        "document (Aktenvermerk, Protokoll, Checkliste, Flächenaufstellung): write it here, complete and starting "
        "with a `# ` heading, rather than in the answer, which then says in one sentence what was written. A draft "
        f"is written once: an existing path is refused, and edit_file changes it. Only {DRAFT_ROOT} is writable."
    ),
    "edit_file": (
        "Changes part of a draft: replaces `old_string`, which must occur exactly once (or pass "
        "`replace_all=true`), with `new_string`. Copy `old_string` verbatim from read_file's output below its "
        f"`@@ … @@` header, anchored on a heading and covering the whole paragraph you change. Only {DRAFT_ROOT} "
        "is editable."
    ),
}

_TOOL_DESCRIPTIONS = {
    "ls": (
        "Lists the drafts of this conversation. The working directory is at "
        f"`{DRAFT_ROOT}` and contains only what was written in this conversation — "
        "no project files, no office shelf (Büroablage). Call it before a revision when the "
        "path of the draft is not known."
    ),
    "read_file": (
        "Reads a draft from the working directory. The output starts with a header line "
        "`@@ lines … @@` that belongs to the display and not to the document; the lines below it "
        "are the document verbatim. Read before a revision, so that `old_string` comes verbatim "
        "from the document. "
        "What stands here, the answer wrote itself; evidence comes from the "
        "source tools."
    ),
    **_WRITE_DESCRIPTIONS,
}

_PERMISSIONS = [
    FilesystemPermission(
        operations=["read", "write"],
        paths=[DRAFT_ROOT.rstrip("/"), DRAFT_ROOT, f"{DRAFT_ROOT}**"],
        mode="allow",
    ),
    FilesystemPermission(operations=["read", "write"], paths=["/**"], mode="deny"),
]


_ESTATE_DESCRIPTIONS = {
    "ls": (
        "Lists one folder: its subfolders with their document counts, and its files with pages, Dokumentart, "
        "Plankopf index and date. `path` is an absolute folder path under a mount: /project/ (this project), "
        "/office/ (the Büroablage), /chat/ (files dropped into this conversation), /law/oib/ (the "
        f'OIB-Richtlinien), {DRAFT_ROOT} (this conversation\'s drafts), {SKILLS_ROOT} (procedures); `ls("/")` '
        "lists the mounts this turn has. `depth` 2 to 4 returns the tree below as folder cards; a folder's "
        "`README.md` is its card. At most 40 files a folder are listed; a listing is an index, never cited. Use "
        "it to see what a project or folder holds; to find a file by part of its name, glob is quicker."
    ),
    "glob": (
        "Finds files by name. `pattern` takes `*`, `**`, `?`, `[abc]` and `{a,b}` (`**/*Brandschutz*`); case is "
        "ignored and ä/ae, ö/oe, ü/ue, ß/ss are folded, so `*Flaeche*` finds `Flächenwidmung`. `path` limits it to one "
        "folder; without it every mount is searched. Returns absolute paths, each with pages and Dokumentart, at "
        "most 100. Names only: for words inside documents use grep, for a topic knowledge_search."
    ),
    "grep": (
        "Finds wording inside documents: which files and pages contain a word, a number, a name, a Geschäftszahl "
        "or a clause reference, and shows that it stands nowhere else. Literal by default: case, ä/ae, ö/oe, "
        "ü/ue, ß/ss, soft hyphens and words split at a line break are folded, and a pattern of two or three "
        'characters matches whole words only. `mode="regex"` takes a regular expression (Python syntax, '
        "case-insensitive, `MA 37/\\d{6}`). `stemmed=true` also matches inflected German forms. `path` limits "
        "the search to a folder or one document and `glob` filters file names; without `path` every document "
        f"mount is searched, the OIB corpus included, and the drafts only with a {DRAFT_ROOT} path.\n"
        "`output_mode`: `files_with_matches` (default) gives each matching file with its count and pages and how "
        "many files were searched; `content` gives the matching pages as citable passages (up to 8, spread over "
        "files) and the lines around each match (`context`, 0 to 3, adds lines); `count` gives occurrences per "
        "file. `max_count` caps the matches returned. It matches words, not meaning: a question worded "
        "differently from the documents is knowledge_search's."
    ),
    "read_file": (
        f"Reads a file by its absolute path: a document, a draft under {DRAFT_ROOT} or a skill under "
        f"{SKILLS_ROOT}. A document's text is at its file name plus `.md` (`Brandschutzkonzept.pdf.md`); the bare "
        '`.pdf` path works too. `pages` ("3", "3-5", "3,7,11"; at most 30) reads those pages and `clause` '
        '("3.5.2", "Tabelle 3", or the Punkt a hit printed) one Punkt of a structured document such as an '
        "OIB-Richtlinie; without either you get the first page and the Gliederung. A document comes back one "
        "citable passage per page, up to about 6k tokens a call. `offset` and `limit` count lines (default 0 and "
        "100) and apply to drafts, skills and text files; on a paginated document use `pages`. A draft is what "
        "the answer wrote, never evidence."
    ),
    **_WRITE_DESCRIPTIONS,
}


_SKILL_PERMISSION = FilesystemPermission(operations=["read"], paths=[f"{SKILLS_ROOT}**"], mode="allow")

_SKILL_READ = (
    "a skill's instructions: the `SKILL.md` at a path the Skills section lists, under "
    f"`{SKILLS_ROOT}`. Pass `limit=1000` so the whole method arrives in one read."
)
_READ_WITH_SKILLS = f"{_TOOL_DESCRIPTIONS['read_file']} It also reads {_SKILL_READ}"
_READ_SKILLS_ONLY = f"Reads {_SKILL_READ}"


def filesystem_tools(
    drafts: DraftBackend | None, estate: Any, *, skills: BackendProtocol | None = None
) -> list[BaseTool]:
    names = [*ESTATE_TOOL_NAMES, *(DRAFT_ONLY_TOOL_NAMES if drafts is not None else ())]
    permissions = list(_PERMISSIONS)
    if skills is not None:
        permissions.insert(0, _SKILL_PERMISSION)
    middleware = DocumentFilesystem(
        estate=estate,
        drafts=drafts is not None,
        backend=composite_backend(drafts, estate, skills=skills),
        custom_tool_descriptions=dict(_ESTATE_DESCRIPTIONS),
        permissions=permissions,
        tools=names,
    )
    by_name = {tool.name: with_bare_schema(tool) for tool in middleware.tools}
    order = [*DRAFT_TOOL_NAMES, *(name for name in ESTATE_TOOL_NAMES if name not in DRAFT_TOOL_NAMES)]
    return [by_name[name] for name in order if name in by_name]


def draft_tools(backend: DraftBackend | None, *, skills: BackendProtocol | None = None) -> list[BaseTool]:
    if backend is None and skills is None:
        return []
    names = DRAFT_TOOL_NAMES if backend is not None else ("read_file",)
    descriptions = dict(_TOOL_DESCRIPTIONS)
    permissions = list(_PERMISSIONS)
    mounted: BackendProtocol = backend if backend is not None else skills  # ty: ignore[invalid-assignment]
    if skills is not None:
        mounted = CompositeBackend(default=mounted, routes={SKILLS_ROOT: skills})
        descriptions["read_file"] = _READ_WITH_SKILLS if backend is not None else _READ_SKILLS_ONLY
        permissions.insert(0, _SKILL_PERMISSION)
    middleware = FilesystemMiddleware(
        backend=mounted,
        custom_tool_descriptions=descriptions,
        permissions=permissions,
        tools=list(names),
    )
    by_name = {tool.name: tool for tool in middleware.tools}
    return [by_name[name] for name in names if name in by_name]


async def filesystem_tools_for_turn(estate: Any = None, *, skills: BackendProtocol | None = None) -> list[BaseTool]:
    if estate is None:
        return await draft_tools_for_turn(skills=skills)
    return filesystem_tools(await _turn_drafts(), estate, skills=skills)


async def _turn_drafts() -> DraftBackend | None:
    conversation_id = get_conversation_id_from_context()
    if not conversation_id:
        return None
    try:
        return await get_draft_backend(conversation_id)
    except Exception:  # noqa: BLE001 - a working directory is never worth the turn
        logger.warning("Working directory unavailable; this turn is answered without it.", exc_info=True)
        return None


async def draft_tools_for_turn(*, skills: BackendProtocol | None = None) -> list[BaseTool]:
    return draft_tools(await _turn_drafts(), skills=skills)
