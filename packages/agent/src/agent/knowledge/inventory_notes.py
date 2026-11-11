"""The two inventory paragraphs a turn varies: files still being read, and the one shelf a listing asked about. Pure.

The inventory itself is the same bytes until a file settles; these two are
per turn. Split out so the conversation layout (the chat agent's ``context_layout``)
can send the inventory once at the head of the conversation and these in the
turn's note, while ``inventory.render_inventory_block`` keeps rendering all of
it in one block for every other prompt.
"""

from __future__ import annotations

from collections.abc import Sequence

from agent.common.source_kinds import SHELF_QUALIFIERS
from agent.common.source_kinds import Shelf
from agent.common.source_kinds import parse_shelf

#: The inventory's shelf order: user-facing shelves first, base last so the OIB corpus cannot evict them.
INVENTORY_ORDER: tuple[Shelf, ...] = (Shelf.OFFICE_SHELF, Shelf.PROJECT, Shelf.SESSION, Shelf.BASE)

#: How many in-flight filenames the prompt names before it counts the rest.
#:
#: Same rule as every other block here: carry the shape, not the list. A bulk
#: upload can have hundreds of files in flight, and the model needs to know
#: THAT rather than WHICH — past a handful the names stop informing the answer
#: and start being paid for on every turn.
_IN_FLIGHT_MAX_NAMED = 5


def in_flight_paragraph(in_flight: Sequence[str] | None) -> str | None:
    """The paragraph naming files still being indexed, or None when there are none. Pure."""
    pending = [name for name in (in_flight or []) if name]
    if not pending:
        return None
    shown = pending[:_IN_FLIGHT_MAX_NAMED]
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


def focus_paragraph(focus_shelf: Shelf | str | None) -> str | None:
    """The sentence naming the one shelf a listing question asked about, or None. Pure."""
    focused = parse_shelf(focus_shelf)
    if focused is None:
        return None
    other = [SHELF_QUALIFIERS[s] for s in INVENTORY_ORDER if s != focused]
    return (
        f"This question asked only about **{SHELF_QUALIFIERS[focused]}**. "
        f"Other shelves ({', '.join(other)}) exist on this request but are not listed."
    )
