import pytest

from agent.common.focus_file import get_focused_file_name
from agent.common.focus_file import get_focused_shelf
from agent.common.focus_file import get_turn_shelves
from agent.common.focus_file import set_focus
from agent.common.focus_file import set_turn_intent
from agent.common.focus_file import shelves_for_turn


@pytest.mark.parametrize(
    ("focus_shelf", "source_preset", "expected"),
    [
        ("session", "project", frozenset({"session", "base"})),
        ("project", None, frozenset({"project", "session", "base"})),
        ("office_shelf", None, frozenset({"office_shelf", "session", "base"})),
        (None, "project", frozenset({"project", "session", "base"})),
        (None, "office", frozenset({"office_shelf", "session", "base"})),
        (None, "law", frozenset({"base"})),
        (None, None, None),
        ("bogus", "nope", None),
    ],
)
def test_shelves_for_turn(focus_shelf, source_preset, expected):
    assert shelves_for_turn(focus_shelf=focus_shelf, source_preset=source_preset) == expected


def test_set_turn_intent_from_file_shelf():
    set_turn_intent(file_name="Protokoll.pdf", shelf="session", source_preset="project")
    assert get_focused_file_name() == "Protokoll.pdf"
    assert get_focused_shelf() == "session"
    assert get_turn_shelves() == frozenset({"session", "base"})
    set_turn_intent()
    assert get_focused_file_name() is None
    assert get_focused_shelf() is None
    assert get_turn_shelves() is None


def test_set_turn_intent_from_preset():
    set_turn_intent(source_preset="law")
    assert get_focused_file_name() is None
    assert get_turn_shelves() == frozenset({"base"})
    set_turn_intent()
    assert get_turn_shelves() is None


def test_set_focus_ignores_client_include_shelves():
    set_focus(file_name="Protokoll.pdf", shelf="session", include_shelves=["office_shelf", "base"])
    assert get_focused_file_name() == "Protokoll.pdf"
    assert get_focused_shelf() == "session"
    assert get_turn_shelves() == frozenset({"session", "base"})
    set_focus()
    assert get_focused_file_name() is None
    assert get_focused_shelf() is None
    assert get_turn_shelves() is None


def test_a_subject_file_never_costs_the_turn_its_building_code():
    for shelf in ("session", "project", "office_shelf"):
        shelves = shelves_for_turn(focus_shelf=shelf)
        assert shelves is not None
        assert "base" in shelves, shelf


def test_a_subject_still_narrows_the_document_shelves():
    assert shelves_for_turn(focus_shelf="session") == frozenset({"session", "base"})
    assert "office_shelf" not in shelves_for_turn(focus_shelf="project")
    assert shelves_for_turn(source_preset="law") == frozenset({"base"})
