"""Which tool a step of a chat turn calls (read by the score writers)."""

from __future__ import annotations

from typing import Any


def tool_called_by(body: Any) -> str | None:
    """The basename of the tool a ``tool`` step names, from a step body; nothing for any other body.

    A file tool that stayed in the drafts (``mount`` ``drafts``, ADR-0133) is named ``draft:<tool>``: it
    was a call, but no office-file move, so ``file_tool_scores`` counts it as neither search nor navigate.
    """
    step = getattr(body, "step", None)
    if getattr(step, "kind", None) != "tool":
        return None
    tool = getattr(step, "tool", None) or None
    mount = getattr(step, "mount", None)
    if tool and mount in ("drafts", "skills"):
        # A skill read (ADR-0135) is no office-file move either.
        return f"{'draft' if mount == 'drafts' else 'skill'}:{tool}"
    return tool
