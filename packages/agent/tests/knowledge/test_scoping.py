import base64
import json
from unittest.mock import MagicMock
from unittest.mock import patch

from knowledge_layer.search import scope as scope_module

from agent.common.source_kinds import Shelf
from agent.knowledge.scoping import ScopedCollection
from agent.knowledge.scoping import _base64url_decode
from agent.knowledge.scoping import get_collection_scope_from_context
from agent.knowledge.scoping import get_scoped_collections_from_context


class TestBase64UrlDecode:
    def test_standard_padded(self):
        assert _base64url_decode("SGVsbG8=") == b"Hello"

    def test_missing_padding(self):
        assert _base64url_decode("SGVsbG8") == b"Hello"

    def test_urlsafe_chars(self):
        encoded = base64.urlsafe_b64encode(b"\xfb\xff\xff\xff").decode().rstrip("=")
        assert "+" not in encoded and "/" not in encoded
        assert _base64url_decode(encoded) == b"\xfb\xff\xff\xff"

    def test_empty_string(self):
        assert _base64url_decode("") == b""

    def test_double_padding(self):
        val = base64.urlsafe_b64encode(b"ab").decode()
        assert _base64url_decode(val) == b"ab"


class _MockContext:
    def __init__(self, header_value: str | None):
        self.metadata = MagicMock()
        self.metadata.headers.get.return_value = header_value


class TestGetCollectionScopeFromContext:
    def test_valid_header(self):
        scope = ["oib_knowledge", "proj_test", "s_conv123"]
        encoded = base64.urlsafe_b64encode(json.dumps(scope).encode()).decode()
        ctx = _MockContext(encoded)
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            result = get_collection_scope_from_context()
            assert result == scope

    def test_missing_header(self):
        ctx = _MockContext(None)
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            result = get_collection_scope_from_context()
            assert result is None

    def test_context_get_returns_none(self):
        with patch("agent.knowledge.scoping.Context.get", return_value=None):
            result = get_collection_scope_from_context()
            assert result is None

    def test_context_metadata_none(self):
        ctx = MagicMock()
        ctx.metadata = None
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            result = get_collection_scope_from_context()
            assert result is None

    def test_context_get_raises(self):
        with patch("agent.knowledge.scoping.Context.get", side_effect=RuntimeError("boom")):
            result = get_collection_scope_from_context()
            assert result is None

    def test_malformed_base64(self):
        ctx = _MockContext("!!!not-valid-base64!!!")
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            result = get_collection_scope_from_context()
            assert result is None

    def test_malformed_json(self):
        encoded = base64.urlsafe_b64encode(b"not json").decode()
        ctx = _MockContext(encoded)
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            result = get_collection_scope_from_context()
            assert result is None

    def test_non_list_json(self):
        encoded = base64.urlsafe_b64encode(json.dumps({"key": "value"}).encode()).decode()
        ctx = _MockContext(encoded)
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            result = get_collection_scope_from_context()
            assert result is None

    def test_json_string_not_list(self):
        encoded = base64.urlsafe_b64encode(json.dumps("just a string").encode()).decode()
        ctx = _MockContext(encoded)
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            result = get_collection_scope_from_context()
            assert result is None

    def test_json_list_with_non_strings(self):
        encoded = base64.urlsafe_b64encode(json.dumps(["good", 42, "also good"]).encode()).decode()
        ctx = _MockContext(encoded)
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            result = get_collection_scope_from_context()
            assert result is None

    def test_duplicates_preserve_order(self):
        scope = ["oib_knowledge", "proj_x", "oib_knowledge", "s_conv1", "proj_x"]
        encoded = base64.urlsafe_b64encode(json.dumps(scope).encode()).decode()
        ctx = _MockContext(encoded)
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            result = get_collection_scope_from_context()
            assert result == ["oib_knowledge", "proj_x", "s_conv1"]

    def test_double_prefixed_session_collection_is_normalized(self):
        scope = ["oib_knowledge", "proj_x", "s_s_conv1"]
        encoded = base64.urlsafe_b64encode(json.dumps(scope).encode()).decode()
        ctx = _MockContext(encoded)
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            result = get_collection_scope_from_context()
            assert result == ["oib_knowledge", "proj_x", "s_conv1"]

    def test_empty_list(self):
        encoded = base64.urlsafe_b64encode(json.dumps([]).encode()).decode()
        ctx = _MockContext(encoded)
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            result = get_collection_scope_from_context()
            assert result == []

    def test_single_item(self):
        encoded = base64.urlsafe_b64encode(json.dumps(["only_one"]).encode()).decode()
        ctx = _MockContext(encoded)
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            result = get_collection_scope_from_context()
            assert result == ["only_one"]


class TestTheShelfTravelsInTheHeader:
    @staticmethod
    def _ctx(payload):
        return _MockContext(base64.urlsafe_b64encode(json.dumps(payload).encode()).decode())

    def test_the_new_form_carries_a_shelf_per_collection(self):
        ctx = self._ctx(
            [
                {"collection": "oib_knowledge", "shelf": "base"},
                {"collection": "archiv_org1", "shelf": "office_shelf"},
                {"collection": "proj_alpha", "shelf": "project"},
                {"collection": "s_9f2a4c", "shelf": "session"},
            ]
        )
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            assert get_scoped_collections_from_context() == [
                ScopedCollection("oib_knowledge", Shelf.BASE),
                ScopedCollection("archiv_org1", Shelf.OFFICE_SHELF),
                ScopedCollection("proj_alpha", Shelf.PROJECT),
                ScopedCollection("s_9f2a4c", Shelf.SESSION),
            ]

    def test_a_session_collection_is_session_not_project(self):
        ctx = self._ctx([{"collection": "s_9f2a4c", "shelf": "session"}])
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            (entry,) = get_scoped_collections_from_context()
        assert entry.shelf is Shelf.SESSION
        assert entry.shelf != Shelf.PROJECT

    def test_the_legacy_bare_string_form_leaves_the_shelf_unknown(self):
        ctx = self._ctx(["oib_knowledge", "s_9f2a4c"])
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            assert get_scoped_collections_from_context() == [
                ScopedCollection("oib_knowledge", None),
                ScopedCollection("s_9f2a4c", None),
            ]

    def test_an_unknown_shelf_value_reads_as_unknown_never_base(self):
        ctx = self._ctx(
            [
                {"collection": "proj_alpha", "shelf": "projekt"},
                {"collection": "archiv_org1", "shelf": ""},
                {"collection": "oib_knowledge"},
            ]
        )
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            entries = get_scoped_collections_from_context()
        assert [entry.shelf for entry in entries] == [None, None, None]
        assert [entry.collection for entry in entries] == ["proj_alpha", "archiv_org1", "oib_knowledge"]

    def test_the_new_form_still_normalizes_and_dedupes_collection_names(self):
        ctx = self._ctx(
            [
                {"collection": "s_s_conv1", "shelf": "session"},
                {"collection": "s_conv1"},
                {"collection": "proj_alpha", "shelf": "project"},
            ]
        )
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            entries = get_scoped_collections_from_context()
        assert entries == [
            ScopedCollection("s_conv1", Shelf.SESSION),
            ScopedCollection("proj_alpha", Shelf.PROJECT),
        ]

    def test_the_names_only_projection_matches(self):
        ctx = self._ctx([{"collection": "proj_alpha", "shelf": "project"}, "s_9f2a4c"])
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            assert get_collection_scope_from_context() == ["proj_alpha", "s_9f2a4c"]

    def test_an_entry_in_neither_shape_voids_the_whole_scope(self):
        ctx = self._ctx([{"collection": "proj_alpha", "shelf": "project"}, {"shelf": "session"}])
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            assert get_scoped_collections_from_context() is None


class TestABlankNameMeansTheSameOnBothSidesOfTheSeam:
    @staticmethod
    def _ctx(payload):
        return _MockContext(base64.urlsafe_b64encode(json.dumps(payload).encode()).decode())

    def test_a_blank_object_name_skips_only_that_entry(self):
        ctx = self._ctx(
            [
                {"collection": "proj_alpha", "shelf": "project"},
                {"collection": "", "shelf": "office_shelf"},
                {"collection": "s_conv1", "shelf": "session"},
            ]
        )
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            assert get_scoped_collections_from_context() == [
                ScopedCollection("proj_alpha", Shelf.PROJECT),
                ScopedCollection("s_conv1", Shelf.SESSION),
            ]

    def test_a_whitespace_only_name_is_blank_too(self):
        ctx = self._ctx([{"collection": "   "}, "proj_alpha", "  "])
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            assert get_scoped_collections_from_context() == [ScopedCollection("proj_alpha", None)]

    def test_both_parsers_read_the_same_payload_the_same_way(self):
        from agent.project_context import _as_scope_entries
        from agent.project_context import _scope_names

        payload = [
            {"collection": "proj_alpha", "shelf": "project"},
            {"collection": "  "},
            "",
            "s_conv1",
        ]
        envelope_names = _scope_names(_as_scope_entries(payload))

        ctx = self._ctx(payload)
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            resolver_names = get_collection_scope_from_context()

        assert envelope_names == ["proj_alpha", "s_conv1"]
        assert resolver_names == envelope_names

    def test_an_unreadable_entry_still_voids_the_payload_on_both_sides(self):
        from agent.project_context import _as_scope_entries

        payload = [{"collection": "proj_alpha", "shelf": "project"}, {"shelf": "session"}]
        assert _as_scope_entries(payload) is None

        ctx = self._ctx(payload)
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            assert get_scoped_collections_from_context() is None


class _HeaderContext:
    def __init__(self, headers: dict[str, str]):
        self.metadata = MagicMock()
        self.metadata.headers.get.side_effect = lambda name, default=None: headers.get(name, default)


class TestSignedEnvelopePrecedence:
    @staticmethod
    def _envelope(scope, secret):
        import hashlib
        import hmac

        json_text = json.dumps({"collectionScope": scope})
        header = base64.urlsafe_b64encode(json_text.encode()).decode()
        sig = hmac.new(secret.encode(), json_text.encode(), hashlib.sha256).hexdigest()
        return header, sig

    def test_signed_envelope_scope_wins_over_forged_raw_header(self, monkeypatch):
        secret = "unit-test-internal-token"
        monkeypatch.setenv("INTERNAL_API_TOKEN", secret)

        trusted = ["oib_knowledge", "s_my_conversation"]
        envelope, sig = self._envelope(trusted, secret)

        forged = ["s_victim_conversation", "another_tenant_corpus"]
        forged_header = base64.urlsafe_b64encode(json.dumps(forged).encode()).decode()

        ctx = _HeaderContext(
            {
                "x-grid-request-context": envelope,
                "x-grid-request-context-sig": sig,
                "x-grid-collection-scope": forged_header,
            }
        )
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            result = get_collection_scope_from_context()

        assert result == trusted
        assert "s_victim_conversation" not in result
        assert "another_tenant_corpus" not in result

    def test_tampered_envelope_signature_is_not_honored(self, monkeypatch):
        secret = "unit-test-internal-token"
        monkeypatch.setenv("INTERNAL_API_TOKEN", secret)

        privileged = ["another_tenant_corpus"]
        envelope, _good_sig = self._envelope(privileged, secret)

        ctx = _HeaderContext(
            {
                "x-grid-request-context": envelope,
                "x-grid-request-context-sig": "deadbeef" * 8,
            }
        )
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            result = get_collection_scope_from_context()

        assert result is None

    def test_raw_header_honored_when_no_envelope(self, monkeypatch):
        monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
        scope = ["oib_knowledge", "s_conv"]
        header = base64.urlsafe_b64encode(json.dumps(scope).encode()).decode()
        ctx = _HeaderContext({"x-grid-collection-scope": header})
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            result = get_collection_scope_from_context()

        assert result == scope


class TestGetCollectionScopeFromContextOr:
    def test_context_scope_takes_precedence(self):
        from agent.knowledge.scoping import get_collection_scope_from_context_or

        scope = ["oib_knowledge", "proj_test"]
        encoded = base64.urlsafe_b64encode(json.dumps(scope).encode()).decode()
        ctx = _MockContext(encoded)
        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            result = get_collection_scope_from_context_or(None, None)
            assert result == scope

    def test_a_request_with_an_empty_scope_falls_back_without_the_base(self):
        from agent.knowledge.scoping import get_collection_scope_from_context_or

        encoded = base64.urlsafe_b64encode(json.dumps([]).encode()).decode()
        ctx = _MockContext(encoded)

        mock_config = MagicMock()
        mock_config.use_fixed_collection = False
        mock_config.collection_name = "oib_knowledge"
        mock_config.include_base_collection = True
        mock_config.include_session_collection = False
        mock_config.project_collections = []

        with (
            patch("agent.knowledge.scoping.Context.get", return_value=ctx),
            patch("agent.project_context.get_profile_context_from_context", return_value=None),
            patch.object(
                scope_module,
                "resolve_scoped_collections",
                return_value=[ScopedCollection("oib_knowledge", Shelf.BASE)],
            ),
        ):
            result = get_collection_scope_from_context_or(mock_config, None)
            assert result == []

    def test_missing_header_falls_back(self):
        from agent.knowledge.scoping import get_collection_scope_from_context_or

        ctx = _MockContext(None)

        mock_config = MagicMock()
        mock_config.use_fixed_collection = False
        mock_config.collection_name = "oib_knowledge"
        mock_config.include_base_collection = True
        mock_config.include_session_collection = True
        mock_config.project_collections = ["proj_extra"]

        with (
            patch("agent.knowledge.scoping.Context.get", return_value=ctx),
            patch.object(
                scope_module,
                "resolve_scoped_collections",
                return_value=[
                    ScopedCollection("oib_knowledge", Shelf.BASE),
                    ScopedCollection("s_abc", Shelf.SESSION),
                    ScopedCollection("proj_extra", Shelf.PROJECT),
                ],
            ),
        ):
            result = get_collection_scope_from_context_or(mock_config, "s_abc")
            assert result == ["oib_knowledge", "s_abc", "proj_extra"]

    def test_the_legacy_fallback_states_each_layer_s_shelf(self):
        from agent.knowledge.scoping import get_scoped_collections_from_context_or

        ctx = _MockContext(None)

        mock_config = MagicMock()
        mock_config.use_fixed_collection = False
        mock_config.collection_name = "oib_knowledge"
        mock_config.include_base_collection = True
        mock_config.include_session_collection = True
        mock_config.project_collections = ["proj_extra"]

        with patch("agent.knowledge.scoping.Context.get", return_value=ctx):
            result = get_scoped_collections_from_context_or(mock_config, "abc")

        assert result == [
            ScopedCollection("oib_knowledge", Shelf.BASE),
            ScopedCollection("s_abc", Shelf.SESSION),
            ScopedCollection("proj_extra", Shelf.PROJECT),
        ]
