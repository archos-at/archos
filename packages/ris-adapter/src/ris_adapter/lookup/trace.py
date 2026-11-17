"""What one ``ris_lookup`` call actually did.

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

    ``searched`` is the terms that went to RIS AFTER the planner rewrote them —
    the model needs to see the rewrite it did not write, or a miss reads as if
    its own question had been asked.
    """

    searched: str = ""
    application: str = ""
    candidates: list[Any] = field(default_factory=list)
    fetched: list[str] = field(default_factory=list)
    headings: list[str] = field(default_factory=list)
    as_of: str = ""
    versions_dropped: int = 0
