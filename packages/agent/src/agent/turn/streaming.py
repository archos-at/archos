import logging
import re
from dataclasses import dataclass
from dataclasses import field
from typing import Any

from agent.common.wire_v2 import AnswerRetractedBody
from agent.common.wire_v2 import CardBody
from agent.common.wire_v2 import CardRefusedBody
from agent.common.wire_v2 import EventBody
from agent.common.wire_v2 import KeyedCard
from agent.common.wire_v2 import MastheadBody
from agent.common.wire_v2 import RunFinishedBody
from agent.common.wire_v2 import ShownAnswer
from agent.common.wire_v2 import StateSnapshotBody
from agent.common.wire_v2 import TextMessageContentBody
from agent.common.wire_v2 import WireSource

logger = logging.getLogger(__name__)


_STOP_WHITESPACE = " \t\n\r\f\v"
_PENDING_MARKER = re.compile(r"[ \t\n\r\f\v]*\[[0-9]+\]")
_CARD_MARKER = re.compile(r"[ \t\n\r\f\v]*\[\[card:[0-9]+\]\]")
_NUMBERED_CARD_MARKER = re.compile(r"[ \t\n\r\f\v]*\[\[card:([0-9]+)\]\]")
_OPEN_MARKER_TAIL = re.compile(r"[ \t\n\r\f\v]*(?:\[\[?[^\[\] \t\n\r\f\v]*|\[\[card:[0-9]+\])\Z")


@dataclass
class _Stretch:
    text: str = ""
    settled: str | None = None
    sources: list[WireSource] = field(default_factory=list)
    mastheads: list[tuple[int, dict[str, Any] | None]] = field(default_factory=list)
    cards: dict[int, tuple[int, KeyedCard | None]] = field(default_factory=dict)
    ended_at: int | None = None


@dataclass(frozen=True)
class StoppedAnswer:
    text: str
    sources: list[WireSource] = field(default_factory=list)
    answer_meta: dict[str, Any] | None = None
    cards: list[KeyedCard] = field(default_factory=list)


class TurnTextFold:
    def __init__(self) -> None:
        self._stretches: list[_Stretch] = [_Stretch()]
        self._seq = 0

    @property
    def text(self) -> str:
        return self._stretches[-1].text

    @property
    def settled(self) -> str | None:
        return self._stretches[-1].settled

    def add(self, body: EventBody, seq: int | None = None) -> None:
        self._seq = self._seq + 1 if seq is None else seq
        current = self._stretches[-1]
        if isinstance(body, TextMessageContentBody):
            current.text += body.delta
        elif isinstance(body, StateSnapshotBody):
            snapshot = body.snapshot
            mastheads = [(self._seq, snapshot.answer_meta)]
            self._replace(
                _Stretch(snapshot.text, snapshot.text, list(snapshot.sources), mastheads, dict(current.cards))
            )
        elif isinstance(body, AnswerRetractedBody):
            self._replace(_Stretch(mastheads=[(self._seq, None)]))
        elif isinstance(body, MastheadBody):
            current.mastheads.append((self._seq, body.value.answer_meta))
        elif isinstance(body, CardBody):
            current.cards[body.value.index] = (self._seq, KeyedCard(key=body.value.key, card=body.value.card))
        elif isinstance(body, CardRefusedBody):
            current.cards[body.value.index] = (self._seq, None)
        elif isinstance(body, RunFinishedBody):
            current.text = body.result.text

    def _replace(self, stretch: _Stretch) -> None:
        self._stretches[-1].ended_at = self._seq
        self._stretches.append(stretch)

    def _stretch_at(self, seq: int) -> _Stretch:
        return next(s for s in self._stretches if s.ended_at is None or s.ended_at > seq)

    def partial(self) -> str:
        return self.stopped().text

    def stopped(self, shown: ShownAnswer | None = None) -> StoppedAnswer:
        if shown is None:
            stretch, text = self._stretches[-1], self.text
        else:
            stretch = self._stretch_at(shown.seq)
            text = stretch.text[: shown.chars]
            if len(text) < len(stretch.text):
                text = _OPEN_MARKER_TAIL.sub("", text)
        resolved = stretch.settled is not None and stretch.settled.startswith(text)
        if not resolved:
            text = _PENDING_MARKER.sub("", text)
        sources = list(stretch.sources) if resolved and text.strip(_STOP_WHITESPACE) else []
        if shown is None:
            return StoppedAnswer(text=_CARD_MARKER.sub("", text).strip(_STOP_WHITESPACE), sources=sources)
        cards = _placed_cards(stretch, text, shown.seq)
        text = _NUMBERED_CARD_MARKER.sub(lambda m: m.group(0) if int(m.group(1)) <= len(cards) else "", text)
        mastheads = [meta for at, meta in stretch.mastheads if at <= shown.seq]
        return StoppedAnswer(
            text=text.strip(_STOP_WHITESPACE),
            sources=sources,
            answer_meta=mastheads[-1] if mastheads else None,
            cards=cards,
        )


def _placed_cards(stretch: _Stretch, text: str, seq: int) -> list[KeyedCard]:
    placed = {int(number) for number in _NUMBERED_CARD_MARKER.findall(text)}
    cards: list[KeyedCard] = []
    for index in range(len(stretch.cards)):
        arrived_at, card = stretch.cards.get(index, (seq + 1, None))
        if card is None or arrived_at > seq or index + 1 not in placed:
            break
        cards.append(card)
    return cards


def note_settled_replaced(settled: str | None, terminal: str) -> bool:
    if settled is None or terminal.rstrip() == settled.rstrip():
        return False
    logger.info(
        "Piloti: the terminal frame replaced the settled answer (%d -> %d chars)",
        len(settled),
        len(terminal),
    )
    return True


def fold_turn(bodies: list[EventBody]) -> str:
    for body in reversed(bodies):
        if isinstance(body, RunFinishedBody):
            return body.result.text
    raise ValueError("the turn's stream ended without RUN_FINISHED")
