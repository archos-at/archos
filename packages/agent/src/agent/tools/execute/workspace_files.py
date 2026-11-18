from __future__ import annotations

import hashlib

MAX_FILE_BYTES = 32 * 1024 * 1024

MAX_LISTED_NAMES = 8


def listed(paths: list[str]) -> str:
    shown = ", ".join(paths[:MAX_LISTED_NAMES])
    more = len(paths) - MAX_LISTED_NAMES
    return f"{shown} and {more} more" if more > 0 else shown


def size_text(count: int) -> str:
    return f"{count / 1024:.1f} KB" if count < 1024 * 1024 else f"{count / (1024 * 1024):.1f} MB"


def oversize_file_message(name: str, size: int) -> str:
    return (
        f"'{name}' is {size_text(size)}; one file in a run may be at most {MAX_FILE_BYTES // (1024 * 1024)} MB. "
        "Nothing was run. Work on a smaller export of it, or answer from read_file."
    )


def over_budget_message(name: str, size: int, left: int, limit: int) -> str:
    return (
        f"'{name}' is {size_text(size)}, but only {size_text(max(left, 0))} of the {limit // (1024 * 1024)} MB a "
        "run takes are left after the working files and the documents before it. Nothing was run. Name fewer "
        "documents in one run."
    )


def not_loaded_message(names: list[str], limit: int) -> str:
    return (
        f"not loaded: {listed([f'{name!r}' for name in names])} — a run takes at most {limit} documents. "
        "Run again with those documents if they are needed."
    )


def content_hash(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def _base(path: str) -> str:
    return path.replace("\\", "/").rsplit("/", 1)[-1].casefold()


def derived_origin(output: str, origins: dict[str, dict[str, str]]) -> dict[str, str] | None:
    for path, origin in origins.items():
        if _base(path) == _base(output) or _base(origin.get("name", "")) == _base(output):
            return dict(origin)
    return None
