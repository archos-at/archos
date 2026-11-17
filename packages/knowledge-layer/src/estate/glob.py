from __future__ import annotations

import difflib
from collections.abc import Sequence

from knowledge_layer.browse import fold

from agent.common.estate_paths import ESTATE_MOUNTS
from agent.common.estate_paths import MOUNT_ROOTS
from agent.common.estate_paths import EstatePath
from agent.common.estate_paths import PathRefused
from agent.common.estate_paths import file_name_candidates
from agent.common.estate_paths import parse_estate_path

from .constants import MAX_SUGGESTIONS
from .constants import SUGGESTION_CUTOFF
from .files import EstateFile
from .files import Resolution


def _names_of(file: EstateFile) -> set[str]:
    names = {fold(file.leaf), fold(file.row.file_name), fold(file.row.file_name.rsplit("/", 1)[-1])}
    if file.row.display_title:
        names.add(fold(file.row.display_title))
    return names


def resolve_in(files: Sequence[EstateFile], parsed: EstatePath) -> Resolution:
    if parsed.mount is None or parsed.leaf is None:
        return Resolution(file=None)
    wanted = {fold(name) for name in file_name_candidates(parsed.leaf)} | {fold(parsed.leaf)}
    in_mount = [file for file in files if file.mount == parsed.mount]
    matches = [file for file in in_mount if _names_of(file) & wanted]
    folder = fold(parsed.folder)
    same_folder = [file for file in matches if parsed.mount == "law" or fold(file.row.folder) == folder]
    listable = [file for file in matches if not file.restricted]
    chosen = (same_folder or listable or [None])[0]
    if chosen is None:
        return Resolution(file=None, suggestions=_suggestions(in_mount, parsed))
    note = ""
    if parsed.mount != "law" and fold(chosen.row.folder) != folder and folder:
        note = f"Moved: {parsed.path} is now {chosen.path}."
    return Resolution(file=chosen, note=note)


def _suggestions(files: Sequence[EstateFile], parsed: EstatePath) -> list[str]:
    wanted = fold(parsed.leaf or "")
    scored: list[tuple[float, str]] = []
    for file in files:
        if file.restricted:
            continue
        ratio = difflib.SequenceMatcher(None, wanted, fold(file.leaf)).ratio()
        if ratio >= SUGGESTION_CUTOFF:
            scored.append((ratio, file.path))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [path for _ratio, path in scored[:MAX_SUGGESTIONS]]


def children(files: Sequence[EstateFile], path: str | None) -> list[str]:
    try:
        parsed = parse_estate_path(path, directory=True)
    except PathRefused:
        return []
    if parsed.mount is None:
        return [MOUNT_ROOTS[mount] for mount in ESTATE_MOUNTS if any(file.mount == mount for file in files)]
    prefix = parsed.path if parsed.path.endswith("/") else parsed.path + "/"
    out: set[str] = set()
    for file in files:
        if file.mount != parsed.mount or not fold(file.path).startswith(fold(prefix)):
            continue
        rest = file.path[len(prefix) :]
        head, _, tail = rest.partition("/")
        out.add(prefix + head + ("/" if tail else ""))
    return sorted(out)


def _glob_flags() -> int:
    from wcmatch import glob as wcglob

    return wcglob.GLOBSTAR | wcglob.BRACE | wcglob.DOTGLOB


def glob_files(files: Sequence[EstateFile], pattern: str, path: str | None = None) -> list[EstateFile]:
    from wcmatch import glob as wcglob

    wanted = fold((pattern or "").strip())
    if not wanted:
        return []
    try:
        root = parse_estate_path(path, directory=True) if path else None
    except PathRefused:
        return []
    prefix = fold(root.path) if root is not None and root.mount is not None else ""
    flags = _glob_flags()
    out: list[EstateFile] = []
    for file in files:
        full = fold(file.path)
        if prefix and not full.startswith(prefix):
            continue
        names = {fold(file.leaf), fold(file.row.file_name.rsplit("/", 1)[-1])}
        stem = full[: -len(fold(file.leaf))]
        if "/" not in wanted:
            candidates = names
        elif wanted.startswith("/"):
            candidates = {stem + name for name in names}
        else:
            relative_stem = stem[len(prefix) :] if prefix else stem.lstrip("/")
            candidates = {relative_stem + name for name in names}
        if any(wcglob.globmatch(candidate, wanted, flags=flags) for candidate in candidates):
            out.append(file)
    return sorted(out, key=lambda file: file.path)
