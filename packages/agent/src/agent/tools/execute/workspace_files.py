from __future__ import annotations

import re
from collections.abc import Iterable

MAX_FILE_BYTES = 32 * 1024 * 1024

MAX_LISTED_NAMES = 8

_WHOLE_DIRECTORY = re.compile(
    r"""readdir|opendir|\bglob\b|\.find\(|\.list\(|\bls\(|["'`]/workspace/?["'`]|`/workspace/[^`]*\$\{"""
)


def lists_directory(code: str) -> bool:
    return bool(_WHOLE_DIRECTORY.search(code))


def named_in(code: str, path: str) -> bool:
    return path in code


def referenced(code: str, drafts: Iterable[tuple[str, bytes]]) -> tuple[dict[str, bytes], list[str]]:
    everything = dict(drafts)
    if lists_directory(code):
        return everything, []
    sent = {path: data for path, data in everything.items() if named_in(code, path)}
    left = sorted(path for path in everything if path not in sent)
    return sent, left


def listed(paths: list[str]) -> str:
    shown = ", ".join(paths[:MAX_LISTED_NAMES])
    more = len(paths) - MAX_LISTED_NAMES
    return f"{shown} and {more} more" if more > 0 else shown


def size_text(count: int) -> str:
    return f"{count / 1024:.1f} KB" if count < 1024 * 1024 else f"{count / (1024 * 1024):.1f} MB"


def too_large_message(limit: int, drafts: dict[str, bytes], documents: list[tuple[str, int]]) -> str:
    parts = [f"The files for this run exceed {limit // (1024 * 1024)} MB."]
    if drafts:
        biggest = sorted(drafts.items(), key=lambda entry: -len(entry[1]))
        named = listed([f"{path} ({size_text(len(data))})" for path, data in biggest])
        parts.append(f"Working files the code names: {named}.")
    if documents:
        parts.append("Documents named: " + listed([f"'{name}' ({size_text(size)})" for name, size in documents]) + ".")
    parts.append(
        "Name fewer documents, or name only the working files this run needs by their /workspace/ path."
        if drafts
        else "Name fewer documents."
    )
    return " ".join(parts)


def oversize_file_message(name: str, size: int) -> str:
    return (
        f"'{name}' is {size_text(size)}; one file in a run may be at most {MAX_FILE_BYTES // (1024 * 1024)} MB. "
        "Nothing was run. Work on a smaller export of it, or answer from read_file."
    )


def not_loaded_message(names: list[str], limit: int) -> str:
    return (
        f"not loaded: {listed([f'{name!r}' for name in names])} — a run takes at most {limit} documents. "
        "Run again with those documents if they are needed."
    )
