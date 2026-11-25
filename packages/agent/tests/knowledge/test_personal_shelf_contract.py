import json
from pathlib import Path

import pytest

from agent.knowledge.restricted_collections import is_personal_shelf_collection
from agent.knowledge.restricted_collections import is_restricted_collection

FIXTURE = (
    Path(__file__).resolve().parents[4]
    / "apps"
    / "workspace"
    / "tests"
    / "fixtures"
    / "personal-shelf-collections.json"
)
COLLECTIONS = json.loads(FIXTURE.read_text(encoding="utf-8"))["collections"]


@pytest.mark.parametrize("collection", COLLECTIONS)
def test_the_agent_takes_every_name_the_bff_gives_an_own_shelf_for_it(collection):
    assert is_personal_shelf_collection(collection)
    assert is_restricted_collection(collection)


def test_the_fixture_names_some_shelves():
    assert COLLECTIONS
