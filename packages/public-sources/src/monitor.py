"""Change monitors: deterministic, no model call (design 4.2).

A monitor fetches what it watched last time and compares. What counts as a
change is the source record's ``monitor.kind``:

* ``sha256``: the bytes differ;
* ``etag``: the server's validator differs (a 304 is no change, and costs the
  publisher nothing);
* ``version``: the version the protocol states differs (the Fedlex
  consolidation date, an ELI point in time).

A change becomes a :class:`Change`: the snapshots before and after, the
passages whose text changed, appeared or went (by anchor, when the engine reads
passages), and ``needs`` for the reviewer. :meth:`Change.review_item` is the
shape a review queue receives; the queue itself, its inbox item and the change
request belong to the platform records (build S7), which take this as input.
Nothing here decides whether the change matters: a person does.
"""

from __future__ import annotations

from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import field
from datetime import UTC
from datetime import datetime
from typing import Any

from public_sources.access.base import Fetched
from public_sources.engines.base import ParsedDocument


@dataclass(frozen=True)
class Snapshot:
    """What one watched item looked like when it was last fetched."""

    source_id: str
    key: str
    url: str
    sha256: str
    etag: str = ""
    version: str = ""
    fetched_at: str = ""
    #: anchor -> sha256 of the passage text, when the engine reads passages.
    passages: dict[str, str] = field(default_factory=dict)

    @classmethod
    def of(cls, source_id: str, key: str, fetched: Fetched, document: ParsedDocument | None = None) -> Snapshot:
        import hashlib

        passages = {}
        if document is not None:
            passages = {
                p.anchor: hashlib.sha256(p.text.encode("utf-8")).hexdigest() for p in document.passages if p.anchor
            }
        return cls(
            source_id=source_id,
            key=key,
            url=fetched.url,
            sha256=fetched.sha256,
            etag=fetched.etag,
            version=fetched.version or (document.version if document else ""),
            fetched_at=datetime.now(UTC).isoformat(timespec="seconds"),
            passages=passages,
        )


@dataclass(frozen=True)
class Change:
    before: Snapshot
    after: Snapshot
    changed: tuple[str, ...] = ()
    added: tuple[str, ...] = ()
    removed: tuple[str, ...] = ()

    @property
    def needs(self) -> tuple[str, ...]:
        """What a reviewer has to look at, derived from the facts, never from a model."""
        needs = ["review_text"]
        if self.after.version and self.after.version != self.before.version:
            needs.append("new_edition")
        if self.removed:
            needs.append("recheck_relations")
        return tuple(needs)

    def review_item(self) -> dict[str, Any]:
        """The change as a review queue receives it (origin ``monitor``)."""
        return {
            "origin": "monitor",
            "source_id": self.after.source_id,
            "key": self.after.key,
            "url": self.after.url,
            "before": asdict(self.before) | {"passages": len(self.before.passages)},
            "after": asdict(self.after) | {"passages": len(self.after.passages)},
            "changed": list(self.changed),
            "added": list(self.added),
            "removed": list(self.removed),
            "needs": list(self.needs),
        }


def changes_since(
    kind: str, previous: Snapshot | None, current: Snapshot, *, not_modified: bool = False
) -> Change | None:
    """The change between two snapshots under the record's monitor kind, or ``None``.

    The first snapshot of an item is no change: there is nothing to review
    against. ``not_modified`` is the access type's 304.
    """
    if previous is None or not_modified or kind == "none":
        return None
    if kind == "etag":
        moved = bool(current.etag) and current.etag != previous.etag
    elif kind == "version":
        moved = bool(current.version) and current.version != previous.version
    else:
        moved = current.sha256 != previous.sha256
    if not moved:
        return None
    before, after = previous.passages, current.passages
    return Change(
        before=previous,
        after=current,
        changed=tuple(sorted(a for a in before.keys() & after.keys() if before[a] != after[a])),
        added=tuple(sorted(after.keys() - before.keys())),
        removed=tuple(sorted(before.keys() - after.keys())),
    )
