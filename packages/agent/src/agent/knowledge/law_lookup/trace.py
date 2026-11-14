"""What one law lookup call actually did.

Every stage writes one fact here and nothing reads another stage's internals:
the miss message, the span and the tests are all built from this record rather
than from what a stage happened to still have in scope.
"""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field
from typing import Any


@dataclass
class LookupTrace:
    """The call's own account of itself.

    ``searched`` is the terms that went to the source AFTER the planner rewrote
    them: the model needs to see the rewrite it did not write, or a miss reads
    as if its own question had been asked.
    """

    #: The search terms actually used (planner output, or the caller's words).
    searched: str = ""
    #: The source's collection searched (the record's ``lookup.collections``).
    collection: str = ""
    #: Every document considered, fetched or not.
    candidates: list[Any] = field(default_factory=list)
    #: URLs actually downloaded this call.
    fetched: list[str] = field(default_factory=list)
    #: Headings of a document that was read but answered nothing: an INDEX, never evidence.
    headings: list[str] = field(default_factory=list)
    #: The day asked for (``as_of``), empty for today's law.
    as_of: str = ""
    #: A day asked for that was today or later, and so read as today's law (``as_of.reads_today``).
    as_of_today: str = ""
    #: Hits of an ``as_of`` search left unread because no version of that day.
    versions_dropped: int = 0
    #: Which source record answered: its id, its revision (a released record's), and how the call came to read
    #: it (``turn``: the record the turn carries; ``repository``: the fallback file).
    source: str = ""
    source_revision: str = ""
    source_origin: str = ""
