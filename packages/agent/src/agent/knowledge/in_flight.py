"""The sentence that names the files still being read, for every prompt that lists files.

THE ABSENCE OF A FILE IS NOT THE SAME FACT AS ITS NON-EXISTENCE. The inventory
is built from the summaries table, written when a job completes, so a plan
attached moments ago is missing from it in exactly the way it is missing from
retrieval. Naming those files lets the answer say what it could not see.

Its own module because two renderers say it: the inventory block
(``inventory.render_inventory_block``), and the chat turn's note in the
conversation layout, where the list of files still being read changes from one
turn to the next and so cannot sit in the conversation's stable head.
"""

from __future__ import annotations

from collections.abc import Sequence

#: How many in-flight filenames the prompt names before it counts the rest.
#:
#: Carry the shape, not the list. A bulk upload can have hundreds of files in
#: flight, and the model needs to know THAT rather than WHICH — past a handful
#: the names stop informing the answer and start being paid for on every turn.
IN_FLIGHT_MAX_NAMED = 5


def render_in_flight_note(in_flight: Sequence[str] | None) -> str:
    """The paragraph naming the files whose indexing has not finished, or ``""`` when there are none. Pure."""
    pending = [name for name in (in_flight or []) if name]
    if not pending:
        return ""
    shown = pending[:IN_FLIGHT_MAX_NAMED]
    rest = len(pending) - len(shown)
    tail = f", und {rest} weitere" if rest > 0 else ""
    return (
        "**Still being read.** These files were uploaded but their indexing has not "
        f"finished, so they are NOT in the inventory above and a search will not find "
        f"them yet: {', '.join(f'`{name}`' for name in shown)}{tail}. If the question "
        "depends on one of them, say plainly that it is still being processed and "
        "answer what you can without it — do not present an answer that omits it as "
        "though the file had been read."
    )
