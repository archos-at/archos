from __future__ import annotations

import re
from pathlib import Path

ROOT = next(path for path in Path(__file__).resolve().parents if (path / "Taskfile.yml").is_file())

FIRST_IMPRESSION = [
    "README.md",
    "AGENTS.md",
    "CONTEXT.md",
    "docs/README.md",
    "docs/architecture/system-overview.md",
    "docs/architecture/overview.md",
    "apps/workspace/README.md",
]

PROMPTS = sorted(
    path.relative_to(ROOT).as_posix()
    for path in (ROOT / "packages" / "agent" / "src" / "agent").rglob("prompts/*")
    if path.suffix in {".j2", ".md"}
)

OLD_FRAME = re.compile(
    r"compliance assistant|grid oib|answers oib questions|research assistant for austrian building|oib chatbot",
    re.IGNORECASE,
)

FILE_AS_PLAN = re.compile(r"(?<![\w-])(Pläne|Plänen|Planstand|Planstände|Planständen)(?![\w-])")
