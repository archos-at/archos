import base64
import contextlib
import json
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest
from agent_testing.envelope import SECRET
from agent_testing.envelope import signed_headers

from agent.common.source_kinds import Shelf
from agent.knowledge.scoping import ScopedCollection
from agent.knowledge.scoping import _parse_scope_payload
from agent.knowledge.scoping import get_collection_scope_from_context
from agent.knowledge.scoping import get_scoped_collections_from_context
from agent.project_context import _as_scope_entries
from agent.project_context import _scope_names


class _HeaderContext:
    def __init__(self, headers: dict[str, str]):
        self.metadata = MagicMock()
        self.metadata.headers.get.side_effect = lambda name, default=None: headers.get(name, default)


@pytest.fixture(autouse=True)
def _secret(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", SECRET)


@contextlib.contextmanager
def _headers(headers: dict[str, str]):
    with patch("nat.plugin_api.Context.get", return_value=_HeaderContext(headers)):
        yield


def _signed(scope):
    return _headers(signed_headers(collectionScope=scope))


class TestGetCollectionScopeFromContext:
    def test_a_signed_scope_is_read(self):
        scope = ["base_corpus", "proj_test", "s_conv123"]
        with _signed(scope):
            assert get_collection_scope_from_context() == scope

    def test_no_envelope_reads_no_scope(self):
        with _headers({}):
            assert get_collection_scope_from_context() is None

    def test_no_context_reads_no_scope(self):
        with patch("nat.plugin_api.Context.get", return_value=None):
            assert get_collection_scope_from_context() is None

    def test_a_context_that_cannot_be_read_reads_no_scope(self):
        with patch("nat.plugin_api.Context.get", side_effect=RuntimeError("boom")):
            assert get_collection_scope_from_context() is None

    def test_a_plain_scope_header_is_never_read(self):
        plain = base64.urlsafe_b64encode(json.dumps(["base_corpus", "s_conv"]).encode()).decode()
        with _headers({"x-grid-collection-scope": plain}):
            assert get_collection_scope_from_context() is None

    def test_an_envelope_is_refused_without_a_secret_to_verify_it(self, monkeypatch):
        headers = signed_headers(collectionScope=["base_corpus"])
        monkeypatch.delenv("INTERNAL_API_TOKEN")
        with _headers(headers):
            assert get_collection_scope_from_context() is None

    @pytest.mark.parametrize("scope", [{"key": "value"}, "just a string", ["good", 42, "also good"]])
    def test_a_scope_that_is_no_list_of_names_reads_as_none(self, scope):
        with _signed(scope):
            assert get_collection_scope_from_context() is None

    def test_duplicates_preserve_order(self):
        with _signed(["base_corpus", "proj_x", "base_corpus", "s_conv1", "proj_x"]):
            assert get_collection_scope_from_context() == ["base_corpus", "proj_x", "s_conv1"]

    def test_double_prefixed_session_collection_is_normalized(self):
        with _signed(["base_corpus", "proj_x", "s_s_conv1"]):
            assert get_collection_scope_from_context() == ["base_corpus", "proj_x", "s_conv1"]

    def test_empty_list(self):
        with _signed([]):
            assert get_collection_scope_from_context() == []


class TestTheShelfTravelsInTheEnvelope:
    def test_the_new_form_carries_a_shelf_per_collection(self):
        with _signed(
            [
                {"collection": "base_corpus", "shelf": "base"},
                {"collection": "archiv_org1", "shelf": "office_shelf"},
                {"collection": "proj_alpha", "shelf": "project"},
                {"collection": "s_9f2a4c", "shelf": "session"},
            ]
        ):
            assert get_scoped_collections_from_context() == [
                ScopedCollection("base_corpus", Shelf.BASE),
                ScopedCollection("archiv_org1", Shelf.OFFICE_SHELF),
                ScopedCollection("proj_alpha", Shelf.PROJECT),
                ScopedCollection("s_9f2a4c", Shelf.SESSION),
            ]

    def test_the_legacy_bare_string_form_leaves_the_shelf_unknown(self):
        with _signed(["base_corpus", "s_9f2a4c"]):
            assert get_scoped_collections_from_context() == [
                ScopedCollection("base_corpus", None),
                ScopedCollection("s_9f2a4c", None),
            ]

    def test_an_unknown_shelf_value_reads_as_unknown_never_base(self):
        with _signed(
            [
                {"collection": "proj_alpha", "shelf": "projekt"},
                {"collection": "archiv_org1", "shelf": ""},
                {"collection": "base_corpus"},
            ]
        ):
            entries = get_scoped_collections_from_context()
        assert [entry.shelf for entry in entries] == [None, None, None]
        assert [entry.collection for entry in entries] == ["proj_alpha", "archiv_org1", "base_corpus"]

    def test_the_new_form_still_normalizes_and_dedupes_collection_names(self):
        with _signed(
            [
                {"collection": "s_s_conv1", "shelf": "session"},
                {"collection": "s_conv1"},
                {"collection": "proj_alpha", "shelf": "project"},
            ]
        ):
            assert get_scoped_collections_from_context() == [
                ScopedCollection("s_conv1", Shelf.SESSION),
                ScopedCollection("proj_alpha", Shelf.PROJECT),
            ]

    def test_the_names_only_projection_matches(self):
        with _signed([{"collection": "proj_alpha", "shelf": "project"}, "s_9f2a4c"]):
            assert get_collection_scope_from_context() == ["proj_alpha", "s_9f2a4c"]


class TestABlankNameMeansTheSameOnBothSidesOfTheSeam:
    def test_a_blank_object_name_skips_only_that_entry(self):
        with _signed(
            [
                {"collection": "proj_alpha", "shelf": "project"},
                {"collection": "", "shelf": "office_shelf"},
                {"collection": "s_conv1", "shelf": "session"},
            ]
        ):
            assert get_scoped_collections_from_context() == [
                ScopedCollection("proj_alpha", Shelf.PROJECT),
                ScopedCollection("s_conv1", Shelf.SESSION),
            ]

    def test_a_whitespace_only_name_is_blank_too(self):
        with _signed([{"collection": "   "}, "proj_alpha", "  "]):
            assert get_scoped_collections_from_context() == [ScopedCollection("proj_alpha", None)]

    def test_both_parsers_read_the_same_payload_the_same_way(self):
        payload = [{"collection": "proj_alpha", "shelf": "project"}, {"collection": "  "}, "", "s_conv1"]
        envelope_names = _scope_names(_as_scope_entries(payload))
        resolver_names = [entry.collection for entry in _parse_scope_payload(payload)]
        assert envelope_names == ["proj_alpha", "s_conv1"]
        assert resolver_names == envelope_names

    def test_an_unreadable_entry_voids_the_payload_on_both_sides(self):
        payload = [{"collection": "proj_alpha", "shelf": "project"}, {"shelf": "session"}]
        assert _as_scope_entries(payload) is None
        assert _parse_scope_payload(payload) is None


class TestSignedEnvelopePrecedence:
    def test_the_signed_scope_wins_over_a_forged_plain_header(self):
        trusted = ["base_corpus", "s_my_conversation"]
        forged = base64.urlsafe_b64encode(json.dumps(["s_victim_conversation"]).encode()).decode()
        with _headers({**signed_headers(collectionScope=trusted), "x-grid-collection-scope": forged}):
            assert get_collection_scope_from_context() == trusted

    def test_a_tampered_signature_is_not_honored(self):
        headers = signed_headers(collectionScope=["another_tenant_corpus"])
        headers["x-grid-request-context-sig"] = "deadbeef" * 8
        with _headers(headers):
            assert get_collection_scope_from_context() is None


def test_a_reader_of_another_request_takes_its_scope_only_from_a_signed_envelope():
    from agent.knowledge.scoping import signed_scope_names
    from agent.project_context import RequestContext

    assert signed_scope_names(RequestContext(collection_scope=["proj_x"])) is None
    assert signed_scope_names(RequestContext(collection_scope=["proj_x"], envelope_signature="sig")) == ["proj_x"]
    assert signed_scope_names(RequestContext(envelope_signature="sig")) is None
    assert signed_scope_names(None) is None
