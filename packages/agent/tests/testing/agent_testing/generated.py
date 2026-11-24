from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[5]
REGENERATE = "task generate"


def assert_generated(path: Path, text: str, *, detail: str = "") -> None:
    if os.environ.get("UPDATE_FIXTURES") == "1":
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return
    committed = path.read_text(encoding="utf-8") if path.exists() else None
    assert committed == text, (f"{detail}\n\n" if detail else "") + (
        f"{path.resolve().relative_to(ROOT)} is generated from code and no longer matches it. "
        f"Run `{REGENERATE}` and commit what it rewrites in this change."
    )
