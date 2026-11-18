from __future__ import annotations

import json

import pytest

from agent.citations.references import expand_grouped_citations
from agent.common.answer_prose_stream import AnswerProseStream


@pytest.mark.parametrize(
    ("text", "expanded"),
    [
        ("Teile [2–5].", "Teile [2][3][4][5]."),
        ("a [2, 3] b", "a [2][3] b"),
        ("[1-3, 7]", "[1][2][3][7]"),
        ("[3]", "[3]"),
        ("Jahr [1990–2020]", "Jahr [1990–2020]"),
        ("[5–2]", "[5–2]"),
        ("[1-40]", "[1-40]"),
        ("[1,000]", "[1,000]"),
        ("[0, 1]", "[0, 1]"),
        ("[1–3, 2]", "[1][2][3]"),
        ("[2, 2]", "[2]"),
        ("[1,2]", "[1][2]"),
        ("Liste [a, b]", "Liste [a, b]"),
        ("siehe [1-3](https://x.at)", "siehe [1-3](https://x.at)"),
        ("[[1, 2]]", "[[1, 2]]"),
        ("a [1, 2][3] b", "a [1][2][3] b"),
        ("[2, 3]\n```python\nw = grid[1, 2]\n```\n", "[2][3]\n```python\nw = grid[1, 2]\n```\n"),
        ("Matrix `m[2, 3]` und [4–5].", "Matrix `m[2, 3]` und [4][5]."),
    ],
)
def test_a_group_becomes_one_marker_per_source(text, expanded):
    assert expand_grouped_citations(text) == expanded


def test_the_stream_shows_a_range_as_its_single_markers():
    reply = json.dumps({"answer": "Die Ausgabe gliedert sich in vier Teile [2–5]."})
    reader = AnswerProseStream()
    for i in range(0, len(reply), 3):
        reader.feed(reply[i : i + 3])
    assert reader.emitted == "Die Ausgabe gliedert sich in vier Teile [2][3][4][5]."


@pytest.mark.parametrize("size", [1, 3, 10_000])
def test_the_stream_leaves_an_index_in_code_as_written(size):
    prose = "Text [2, 3].\n\n```python\nw = grid[1, 2]\n```\n\nInline `m[2, 3]` und [4–5]."
    reply = json.dumps({"answer": prose})
    reader = AnswerProseStream()
    for i in range(0, len(reply), size):
        reader.feed(reply[i : i + size])
    assert reader.emitted == "Text [2][3].\n\n```python\nw = grid[1, 2]\n```\n\nInline `m[2, 3]` und [4][5]."
