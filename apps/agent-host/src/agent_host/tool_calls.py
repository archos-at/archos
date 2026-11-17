from __future__ import annotations

from typing import Any


def tool_called_by(body: Any) -> str | None:
    step = getattr(body, "step", None)
    if getattr(step, "kind", None) != "tool":
        return None
    tool = getattr(step, "tool", None) or None
    mount = getattr(step, "mount", None)
    if tool and mount in ("drafts", "skills"):
        return f"{'draft' if mount == 'drafts' else 'skill'}:{tool}"
    return tool
