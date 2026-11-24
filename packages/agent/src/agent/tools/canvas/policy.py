from __future__ import annotations

from agent.knowledge.restricted_use import current_restricted_use
from agent.knowledge.restricted_use import drew_on_other_projects

RESTRICTED_REFUSAL = (
    "Not possible: This conversation has used content from a folder with restricted access or from "
    "another project. What you show or write in the document is seen by everyone who opens it, "
    "so it stays here in the chat. Tell the person you can answer it only here; do not "
    "retry."
)


def shared_write_refusal() -> str | None:
    use = current_restricted_use()
    if use is not None and (use.confined or use.admitted):
        return RESTRICTED_REFUSAL
    if drew_on_other_projects():
        return RESTRICTED_REFUSAL
    return None


def withhold_restricted_for_thread() -> None:
    use = current_restricted_use()
    if use is not None:
        use.drop(set(use.drawable))
