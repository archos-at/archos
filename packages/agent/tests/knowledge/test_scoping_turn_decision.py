from unittest.mock import MagicMock
from unittest.mock import patch

import pytest
from agent_testing.turn_decision import SECRET
from agent_testing.turn_decision import signed_decision

from agent.common.turn_decision import bind_turn_decision
from agent.common.turn_decision import reset_turn_decision
from agent.knowledge.restricted_use import RestrictedUse
from agent.knowledge.restricted_use import bind_restricted_use
from agent.knowledge.restricted_use import reset_restricted_use
from agent.knowledge.restricted_use import restricted_use_from_decision
from agent.knowledge.scoping import get_scoped_collections_from_context

RESTRICTED = "proj_p1_r0123456789ab"


@pytest.fixture
def bound():
    tokens = []

    def bind(decision):
        tokens.append(bind_turn_decision(decision))
        return decision

    yield bind
    for token in reversed(tokens):
        reset_turn_decision(token)


def test_a_turn_searches_the_decision_and_not_the_socket(monkeypatch, bound):
    monkeypatch.setenv("INTERNAL_API_TOKEN", SECRET)
    bound(signed_decision(may={"shelves": [{"collection": "proj_row", "shelf": "project"}]}))
    socket = MagicMock(envelope_signature="sig", collection_scope_entries=[{"collection": "proj_page_open"}])
    with patch("agent.project_context.get_signed_request_context", return_value=socket):
        scoped = get_scoped_collections_from_context()
    assert [entry.collection for entry in scoped] == ["proj_row"]


def test_an_empty_decision_stays_empty(bound):
    bound(signed_decision(may={"shelves": []}))
    assert get_scoped_collections_from_context() == []


def test_without_a_decision_a_turn_reads_nothing_even_inside_a_valid_signature(monkeypatch, bound):
    monkeypatch.setenv("INTERNAL_API_TOKEN", SECRET)
    bound(None)
    signed = MagicMock(
        envelope_signature="sig", collection_scope_entries=[{"collection": "proj_signed", "shelf": "project"}]
    )
    with patch("agent.project_context.get_signed_request_context", return_value=signed):
        assert get_scoped_collections_from_context() == []


def test_a_restricted_collection_of_the_decision_is_searched_only_while_drawable(bound):
    decision = bound(
        signed_decision(
            may={
                "shelves": [
                    {"collection": "proj_p1", "shelf": "project"},
                    {"collection": RESTRICTED, "shelf": "project"},
                ],
                "restrictedCollections": [RESTRICTED],
            },
            recordedRestricted=True,
        )
    )
    use = restricted_use_from_decision(decision, MagicMock(organization_id="org_1", user_id="u", project_id="p1"))
    assert isinstance(use, RestrictedUse)
    assert use.confined is True
    token = bind_restricted_use(use)
    try:
        assert [entry.collection for entry in get_scoped_collections_from_context()] == ["proj_p1", RESTRICTED]
        use.drop({RESTRICTED})
        assert [entry.collection for entry in get_scoped_collections_from_context()] == ["proj_p1"]
    finally:
        reset_restricted_use(token)


def test_no_restricted_use_is_bound_when_the_decision_draws_on_none():
    assert restricted_use_from_decision(signed_decision(), MagicMock()) is None


def test_the_search_keeps_an_empty_turn_scope_empty_instead_of_the_config_path(bound):
    from knowledge_layer.search import resolve_scoped_collections

    config = MagicMock(collection_name="oib_knowledge", use_fixed_collection=False, include_base_collection=True)
    config.include_session_collection = True
    config.project_collections = ["proj_config"]
    bound(signed_decision(may={"shelves": []}))
    assert resolve_scoped_collections(config, "s_conv_1") == []


def test_a_required_turn_without_a_decision_reads_no_countries_from_plain_headers(monkeypatch, bound):
    from agent.common import knowledge_context
    from agent.project_context import RequestContext

    monkeypatch.setenv("REQUIRE_AUTH", "true")
    monkeypatch.setenv("INTERNAL_API_TOKEN", SECRET)
    bound(None)
    plain = RequestContext(
        organization_id="org_1",
        collection_scope_entries=[{"collection": "oib_knowledge", "shelf": "base", "countries": ["AT"]}],
    )
    with (
        patch("agent.project_context.get_signed_request_context", return_value=None),
        patch.object(RequestContext, "from_context", return_value=plain),
    ):
        assert knowledge_context.corpus_countries() == frozenset()


def test_a_turn_reads_the_base_countries_of_its_decision(bound):
    from agent.common import knowledge_context

    bound(signed_decision(may={"shelves": [{"collection": "oib_knowledge", "shelf": "base", "countries": ["DE"]}]}))
    assert knowledge_context.corpus_countries() == frozenset({"DE"})


def test_a_required_turn_without_a_decision_draws_on_no_restricted_collection_from_plain_headers(monkeypatch, bound):
    from agent.project_context import RequestContext
    from agent.turn.context import signed_restricted_collections

    monkeypatch.setenv("REQUIRE_AUTH", "true")
    monkeypatch.setenv("INTERNAL_API_TOKEN", SECRET)
    bound(None)
    request = RequestContext(envelope_header="h", collection_scope=["proj_p1", RESTRICTED])
    with patch("agent.project_context.get_signed_request_context", return_value=None):
        assert signed_restricted_collections(request) == []


def test_a_required_turn_without_a_decision_reads_nothing_from_a_signed_scope_that_does_not_parse(monkeypatch, bound):
    from knowledge_layer.search import resolve_scoped_collections

    from agent.turn.inventory import resolve_scope

    monkeypatch.setenv("REQUIRE_AUTH", "true")
    monkeypatch.setenv("INTERNAL_API_TOKEN", SECRET)
    bound(None)
    config = MagicMock(collection_name="oib_knowledge", use_fixed_collection=False, include_base_collection=True)
    config.include_session_collection = True
    config.project_collections = ["proj_config"]
    signed = MagicMock(envelope_signature="sig", collection_scope_entries=[{"collection": 5}])
    with patch("agent.project_context.get_signed_request_context", return_value=signed):
        assert resolve_scope(get_scoped_collections_from_context(), "s_conv_1") == []
        assert resolve_scoped_collections(config, "s_conv_1") == []


def test_an_empty_signed_scope_outside_a_turn_stays_empty_instead_of_the_config_path(monkeypatch):
    from knowledge_layer.search import resolve_scoped_collections

    from agent.turn.inventory import resolve_scope

    monkeypatch.setenv("INTERNAL_API_TOKEN", SECRET)
    config = MagicMock(collection_name="oib_knowledge", use_fixed_collection=False, include_base_collection=True)
    config.include_session_collection = True
    config.project_collections = ["proj_config"]
    signed = MagicMock(envelope_signature="sig", collection_scope_entries=[])
    with patch("agent.project_context.get_signed_request_context", return_value=signed):
        assert resolve_scoped_collections(config, "s_conv_1") == []
        assert resolve_scope(get_scoped_collections_from_context(), "s_conv_1") == []


PERSONAL = "personal_org_1__user_1"


def test_the_owners_shelf_is_searched_only_while_drawable_like_a_restricted_folder(bound):
    from agent.knowledge.restricted_collections import is_restricted_collection

    decision = bound(
        signed_decision(
            may={
                "shelves": [
                    {"collection": "oib_knowledge", "shelf": "base"},
                    {"collection": PERSONAL, "shelf": "personal"},
                ],
                "restrictedCollections": [PERSONAL],
                "personalShelf": True,
            }
        )
    )
    assert is_restricted_collection(PERSONAL)
    use = restricted_use_from_decision(decision, MagicMock(organization_id="org_1", user_id="user_1", project_id=None))
    token = bind_restricted_use(use)
    try:
        assert [entry.collection for entry in get_scoped_collections_from_context()] == ["oib_knowledge", PERSONAL]
        use.drop({PERSONAL})
        assert [entry.collection for entry in get_scoped_collections_from_context()] == ["oib_knowledge"]
    finally:
        reset_restricted_use(token)


def test_a_personal_shelf_named_in_a_tool_result_is_admitted_before_the_model_sees_it():
    from types import SimpleNamespace

    from agent.knowledge.restricted_use import _carried

    message = SimpleNamespace(content=f"Treffer aus {PERSONAL}: Wettbewerb.pdf", response_metadata={})
    assert _carried(message) == {PERSONAL}


@pytest.mark.parametrize(
    "name",
    ["Personal_Liste_2026.xlsx", "personal_liste_2026.xlsx", "Personal_org_1__user_1", "personal_notes__v2.docx"],
)
def test_a_file_named_personal_is_not_taken_for_the_owners_shelf(name):
    from agent.knowledge.restricted_collections import is_restricted_collection

    assert not is_restricted_collection(name)


async def test_a_project_chat_result_naming_personal_liste_reaches_the_model_unwithheld():
    from types import SimpleNamespace

    from agent.knowledge.restricted_use import _carried
    from agent.knowledge.restricted_use import admit_tool_results

    message = SimpleNamespace(content="Gefunden: Personal_Liste_2026.xlsx, Blatt 2", response_metadata={})
    assert _carried(message) == set()
    assert await admit_tool_results([message]) == [message]


def test_a_later_turn_of_a_chat_that_read_the_owners_shelf_writes_nothing_shared():
    from agent.tools.canvas.policy import shared_write_refusal

    decision = signed_decision(
        may={
            "shelves": [{"collection": PERSONAL, "shelf": "personal"}],
            "restrictedCollections": [PERSONAL],
            "personalShelf": True,
        },
        recordedRestricted=True,
    )
    use = restricted_use_from_decision(decision, MagicMock(organization_id="org_1", user_id="user_1", project_id=None))
    assert use is not None and use.admitted == set()
    token = bind_restricted_use(use)
    try:
        assert shared_write_refusal() is not None
    finally:
        reset_restricted_use(token)


def test_a_workos_shaped_personal_collection_is_the_owners_shelf():
    from types import SimpleNamespace

    from agent.knowledge.restricted_collections import is_restricted_collection
    from agent.knowledge.restricted_use import _carried

    name = "personal_org_01HZX3K9QW8YB2C4D5E6F7G8H9__user_01HZX3KA0B1C2D3E4F5G6H7J8K"
    assert is_restricted_collection(name)
    assert _carried(SimpleNamespace(content=f"aus {name}, notes__v2", response_metadata={})) == {name}
    assert _carried(SimpleNamespace(content="personal_notes__v2.docx", response_metadata={})) == set()
