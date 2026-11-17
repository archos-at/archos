from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Any
from typing import Literal

Mount = Literal["drafts", "skills", "project", "office", "chat", "law"]

ESTATE_MOUNTS: tuple[Mount, ...] = ("project", "office", "chat", "law")

MOUNT_ROOTS: dict[Mount, str] = {
    "project": "/project/",
    "office": "/office/",
    "chat": "/chat/",
    "law": "/law/oib/",
    "drafts": "/drafts/",
    "skills": "/skills/",
}

LEGACY_DRAFT_ROOT = "/entwuerfe/"

SHELF_MOUNTS: dict[str, Mount] = {
    "project": "project",
    "office_shelf": "office",
    "session": "chat",
    "base": "law",
}

MOUNT_SHELVES: dict[Mount, str] = {mount: shelf for shelf, mount in SHELF_MOUNTS.items()}

TEXT_EXTENSIONS = (".txt", ".md", ".csv")

AGENT_FILED_PREFIX = "piloti/"

PATH_ARGUMENTS: dict[str, str] = {"ls": "path", "glob": "path", "grep": "path", "read_file": "file_path"}

WRITE_TOOLS = frozenset({"write_file", "edit_file"})

_PERCENT_ESCAPE = re.compile(r"%[0-9A-Fa-f]{2}")


def nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text or "")


def leaf_for(file_name: str) -> str:
    name = nfc(file_name).strip()
    if name.startswith(AGENT_FILED_PREFIX):
        name = name[len(AGENT_FILED_PREFIX) :]
    name = name.rsplit("/", 1)[-1]
    if not name:
        return ""
    if name.lower().endswith(TEXT_EXTENSIONS):
        return name
    return f"{name}.md"


def estate_path(shelf: Any, folder: str | None, file_name: str) -> str | None:
    value = str(getattr(shelf, "value", shelf) or "").strip().lower()
    if value == "archiv":  # the office shelf's legacy wire value (source_kinds.LEGACY_SHELF_VALUES)
        value = "office_shelf"
    mount = SHELF_MOUNTS.get(value)
    leaf = leaf_for(file_name)
    if mount is None or not leaf:
        return None
    root = MOUNT_ROOTS[mount]
    parts = [] if mount == "law" else [part for part in nfc(folder or "").strip().strip("/").split("/") if part]
    return root + "".join(f"{part}/" for part in parts) + leaf


def is_draft_path(path: str | None) -> bool:
    candidate = (path or "").strip()
    if not candidate.startswith("/"):
        candidate = "/" + candidate
    for root in (MOUNT_ROOTS["drafts"], LEGACY_DRAFT_ROOT):
        if candidate == root.rstrip("/") or candidate.startswith(root):
            return True
    return False


def is_skill_path(path: str | None) -> bool:
    candidate = (path or "").strip()
    root = MOUNT_ROOTS["skills"]
    return candidate == root.rstrip("/") or candidate.startswith(root)


def mount_of_path(path: str | None) -> Mount | None:
    if is_draft_path(path):
        return "drafts"
    if is_skill_path(path):
        return "skills"
    candidate = nfc((path or "").strip())
    if not candidate.startswith("/"):
        return None
    for mount in ESTATE_MOUNTS:
        root = MOUNT_ROOTS[mount]
        if candidate == root.rstrip("/") or candidate.startswith(root):
            return mount
    return None


def call_path(tool: str, args: Any) -> str | None:
    if not isinstance(args, dict):
        return None
    name = PATH_ARGUMENTS.get(tool)
    if name is None:
        return None
    value = args.get(name)
    text = str(value).strip() if value is not None else ""
    return text or None


def call_mount(tool: str, args: Any) -> Mount | Literal["estate"] | None:
    if tool in WRITE_TOOLS:
        return "drafts"
    if tool not in PATH_ARGUMENTS:
        return None
    path = call_path(tool, args)
    if path is None or path.strip() in ("/", ""):
        return "estate"
    mount = mount_of_path(path)
    return mount if mount is not None else "estate"


ESTATE_VERBS = frozenset({"ls", "glob", "grep", "read_file"})


def reads_the_estate(tool_names: Any) -> bool:
    return ESTATE_VERBS <= frozenset(tool_names)


def reaches_drafts_only(tool: str, args: Any) -> bool:
    return call_mount(tool, args) in ("drafts", "skills")


@dataclass(frozen=True)
class EstatePath:
    path: str
    mount: Mount | None
    folders: tuple[str, ...]
    leaf: str | None

    @property
    def folder(self) -> str:
        return "/".join(self.folders)


class PathRefused(ValueError): ...


def parse_estate_path(path: str | None, *, directory: bool = False) -> EstatePath:
    raw = nfc((path or "").strip())
    if not raw:
        raw = "/"
    if not raw.startswith("/"):
        raise PathRefused(f'Paths are absolute: "{raw}" does not start with "/". Start from "/" or a mount root.')
    if "\\" in raw:
        raise PathRefused(f'"{raw}" holds a backslash; paths use "/".')
    if _PERCENT_ESCAPE.search(raw):
        raise PathRefused(f'"{raw}" holds a percent-escape; write the name as it is (umlauts and spaces included).')
    segments = [segment for segment in raw.split("/") if segment not in ("", ".")]
    if ".." in segments or raw.startswith("~"):
        raise PathRefused(f'"{raw}" climbs out of its folder (".."); paths are absolute and canonical.')
    names_directory = directory or raw.endswith("/") or not segments
    canonical = "/" + "/".join(segments) + ("/" if names_directory and segments else "")
    if not segments:
        return EstatePath(path="/", mount=None, folders=(), leaf=None)
    if segments[0] == "law" and (len(segments) == 1 or segments[1] != "oib"):
        if len(segments) == 1:
            return EstatePath(path="/law/", mount=None, folders=(), leaf=None)
        return EstatePath(path=canonical, mount="law", folders=(), leaf=None if names_directory else segments[-1])
    mount = mount_of_path(canonical if canonical.endswith("/") else canonical + "/") or mount_of_path(canonical)
    if mount is None or mount == "drafts":
        return EstatePath(path=canonical, mount=None, folders=tuple(segments), leaf=None)
    depth = 2 if mount == "law" else 1
    rest = segments[depth:]
    if names_directory or not rest:
        return EstatePath(path=canonical if rest else MOUNT_ROOTS[mount], mount=mount, folders=tuple(rest), leaf=None)
    return EstatePath(path=canonical, mount=mount, folders=tuple(rest[:-1]), leaf=rest[-1])


def file_name_candidates(leaf: str) -> list[str]:
    name = nfc(leaf).strip()
    if not name.lower().endswith(".md"):
        return [name]
    stem = name[:-3]
    has_extension = "." in stem.rsplit("/", 1)[-1]
    return list(dict.fromkeys([stem, name] if has_extension else [name, stem]))


def action_place(path: str | None) -> dict[str, str]:
    raw = (path or "").strip()
    try:
        parsed = parse_estate_path(raw, directory=True)
    except PathRefused:
        return {}
    if parsed.path == "/":
        return {"mount": "estate"}
    if parsed.mount is None or parsed.mount in ("drafts", "skills"):
        return {}
    folder = "" if parsed.mount == "law" else parsed.folder
    return {"mount": parsed.mount, **({"target": folder} if folder else {})}


def asked_document(path: str | None) -> str:
    text = nfc((path or "").strip())
    if not text or text.endswith("/"):
        return ""
    leaf = text.rsplit("/", 1)[-1]
    return leaf[:-3] if leaf.lower().endswith(".md") and len(leaf) > 3 else leaf
