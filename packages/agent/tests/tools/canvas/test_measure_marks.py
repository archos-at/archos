from __future__ import annotations

import pytest

from agent.common.turn_file_kinds import stating
from agent.tools.canvas.calls import Refused
from agent.tools.canvas.marks import propose_payload
from agent.tools.canvas.marks import proposed_items
from agent.tools.canvas.marks import render_list

LINE = {"page": 2, "shape": "line", "points": [[0.21, 0.4], [0.36, 0.4]], "kind": "hint", "body": "Lichte Breite"}


def test_a_measurement_goes_with_its_points_and_its_first_point_as_its_place() -> None:
    with stating(frozenset({"pdf"})):
        [mark] = propose_payload([LINE])["proposals"]

    assert mark == {**LINE, "x": 0.21, "y": 0.4}
    assert "w" not in mark and "reading" not in mark


def test_a_measurement_is_refused_where_the_turn_measures_no_pdf() -> None:
    with pytest.raises(Refused, match="PDF drawing"):
        propose_payload([LINE])


@pytest.mark.parametrize(
    ("shape", "points"),
    [("line", [[0.1, 0.1]]), ("polygon", [[0.1, 0.1], [0.2, 0.2]]), ("path", [[0.1, 0.1], [1.4, 0.2]])],
)
def test_a_measurement_takes_its_shape_s_points_on_the_page(shape: str, points: list[list[float]]) -> None:
    with stating(frozenset({"pdf"})), pytest.raises(Refused):
        propose_payload([{**LINE, "shape": shape, "points": points}])


def test_a_pin_takes_no_points() -> None:
    pin = {
        "page": 1,
        "shape": "point",
        "x": 0.2,
        "y": 0.3,
        "points": [[0.1, 0.1], [0.2, 0.2]],
        "kind": "hint",
        "body": "x",
    }
    with stating(frozenset({"pdf"})), pytest.raises(Refused, match="no `points`"):
        propose_payload([pin])


def test_a_kept_measurement_reads_with_its_reading_and_shows_as_its_box() -> None:
    item = {
        "id": "a1",
        "number": 4,
        "page": 2,
        "shape": "polygon",
        "box": [0.1, 0.1, 0.3, 0.4],
        "points": [[0.1, 0.1], [0.3, 0.1], [0.3, 0.4]],
        "reading": {"value": 12.5, "unit": "m2", "low": 12.3, "high": 12.7, "provenance": "vector_verified"},
        "kind": "hint",
        "status": "open",
        "authorKind": "person",
        "body": "Raum 1",
    }

    listed = render_list({"documentName": "EG.pdf", "annotations": [item]})
    [shown] = proposed_items({"proposed": [{**item, "x": 0.1, "y": 0.1}]})

    assert "polygon through 3 points, 12.500 m² (interval 12.300 to 12.700, vector_verified)" in listed
    assert shown["shape"] == "region" and (shown["x"], shown["y"]) == (0.1, 0.1)
    assert shown["w"] == pytest.approx(0.2) and shown["h"] == pytest.approx(0.3)
