from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
from dataclasses import replace
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from agent.common.screen_reading import _Reading


@dataclass(frozen=True)
class Span:
    kind: str
    start: int
    end: int
    term: str | None = None
    sample: str | None = None


def _in_original(span: Span, reading: _Reading) -> Span:
    start, end = reading.original(span.start, span.end)
    return replace(span, start=start, end=end)


def _outside_ibans(spans: list[Span]) -> list[Span]:
    ibans = sorted((span for span in spans if span.kind == "iban"), key=lambda span: span.start)
    starts = [iban.start for iban in ibans]

    def inside(span: Span) -> bool:
        at = bisect_right(starts, span.start) - 1
        return at >= 0 and span.end <= ibans[at].end

    return [span for span in spans if span.kind not in _NUMBER_KINDS or not inside(span)]


_NUMBER_KINDS = ("at_svnr", "credit_card", "de_svnr", "de_tax_id")


def _overlaps_any(span: Span, regions: list[tuple[int, int]]) -> bool:
    return any(span.start < end and start < span.end for start, end in regions)
