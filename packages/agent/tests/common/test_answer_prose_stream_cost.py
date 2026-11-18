from __future__ import annotations

import json
import time
import tracemalloc

import pytest

from agent.common.answer_prose_stream import AnswerProseStream

_CHUNK = 4  # characters per token, about what a provider streams
_GROWTH = 4
_MAX_RATIO = 8.0
_MAX_ALLOCATION_RATIO = 6.0


def _read(reply: str) -> float:
    reader = AnswerProseStream()
    started = time.thread_time()
    for i in range(0, len(reply), _CHUNK):
        reader.feed(reply[i : i + _CHUNK])
        reader.take_cards()
    return time.thread_time() - started


def _cost_ratio(small: str, large: str) -> float:
    smalls, larges = [], []
    for _ in range(7):
        smalls.append(_read(small))
        larges.append(_read(large))
    return min(larges) / min(smalls)


def _allocated(reply: str) -> int:
    started = not tracemalloc.is_tracing()
    if started:
        tracemalloc.start()
    reader, total = AnswerProseStream(), 0
    try:
        for i in range(0, len(reply), _CHUNK):
            before = tracemalloc.get_traced_memory()[0]
            tracemalloc.reset_peak()
            reader.feed(reply[i : i + _CHUNK])
            reader.take_cards()
            total += tracemalloc.get_traced_memory()[1] - before
    finally:
        if started:
            tracemalloc.stop()
    return total


def _long_prose(lines: int) -> str:
    prose = "Vorab [2, 3].\n" + "Der Fluchtweg ist höchstens 40 m lang [1], gemessen bis zur Treppe.\n" * lines
    return json.dumps({"kind": "direct", "answer": prose, "cards": []})


def _long_card(rows: int) -> str:
    card = {"type": "table", "rows": [["Wand {tragend}", 'REI 60 "geprüft" [1]']] * rows}
    return json.dumps({"kind": "direct", "answer": "Siehe [[card:1]].", "cards": [card]})


def _open_code_line(words: int) -> str:
    prose = "Vorab `" + "x = grid[1, 2] und so weiter " * words + "`\nEnde."
    return json.dumps({"kind": "direct", "answer": prose, "cards": []})


@pytest.mark.parametrize(
    ("build", "size"),
    [(_long_prose, 60), (_long_card, 80), (_open_code_line, 200)],
    ids=["prose", "card", "open-code-line"],
)
def test_reading_four_times_the_text_costs_about_four_times_as_much(build, size):
    ratio = _cost_ratio(build(size), build(size * _GROWTH))
    assert ratio < _MAX_RATIO, f"{ratio:.1f}x the time for {_GROWTH}x the text"


@pytest.mark.parametrize(
    ("build", "size"),
    [(_long_prose, 60), (_long_card, 80), (_open_code_line, 200)],
    ids=["prose", "card", "open-code-line"],
)
def test_reading_four_times_the_text_allocates_about_four_times_as_much(build, size):
    ratio = _allocated(build(size * _GROWTH)) / _allocated(build(size))
    assert ratio < _MAX_ALLOCATION_RATIO, f"{ratio:.1f}x the memory allocated for {_GROWTH}x the text"
