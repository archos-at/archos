"""Tests for the ``remember`` tool's honest failure handling.

Drives the inner ``_remember`` function (the one yielded as an agent-runtime
``FunctionInfo``) with ``insert_memory_item`` mocked, so the tool's user-facing
result strings can be asserted without a real internal API.
"""

import io
import json
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError

import agent.knowledge.personal_memory as personal
import agent.knowledge.project_memory as pm
import agent.project_context as pc
from agent.common import bff_http
from agent.memory import register
from agent.memory.register import ProjectMemoryRememberConfig
from agent.memory.register import project_memory_remember


class _RefusingAdapter:
    """A card adapter that rejects everything, standing in for a card the schema
    has moved on from."""

    def validate_python(self, value):
        raise ValidationError.from_exception_data("AnswerCard", [])


def _patch_context(monkeypatch, *, project_id="p1", organization_id="o1", conversation_id="c1"):
    monkeypatch.setattr(pc, "get_project_id_from_context", lambda: project_id)
    monkeypatch.setattr(pc, "get_organization_id_from_context", lambda: organization_id)
    monkeypatch.setattr(pc, "get_conversation_id_from_context", lambda: conversation_id)


async def _remember(monkeypatch, insert, **kwargs):
    """Enter the agent-runtime registration, call _remember once, return its string result."""
    monkeypatch.setattr(pm, "insert_memory_item", insert)
    params = {"kind": "derived_fact", "content": "The roof load is 2 kN/m2.", "scope": "project"}
    params.update(kwargs)
    async with project_memory_remember(ProjectMemoryRememberConfig(), MagicMock()) as info:
        # The agent runtime wraps the inner fn behind a pydantic input schema; call it the same
        # way the framework does — with a validated input model instance.
        return await info.single_fn(info.input_schema(**params))


@pytest.mark.asyncio
async def test_success_path_reports_recorded(monkeypatch):
    _patch_context(monkeypatch)
    insert = MagicMock(return_value="item-1")
    result = await _remember(monkeypatch, insert)
    assert result == "Recorded derived_fact in project memory; the project's members can read it."
    assert insert.called


@pytest.mark.asyncio
async def test_org_memory_disabled_returns_honest_message(monkeypatch):
    _patch_context(monkeypatch)
    insert = MagicMock(side_effect=pm.OrgMemoryDisabledError("disabled"))
    result = await _remember(monkeypatch, insert)
    assert "NOT saved" in result
    assert "organization memory panel" in result
    # Must not claim it was noted, and must tell the model not to retry.
    assert "Do not retry" in result


@pytest.mark.asyncio
async def test_generic_failure_returns_not_saved_message(monkeypatch):
    _patch_context(monkeypatch)
    insert = MagicMock(side_effect=RuntimeError("boom"))
    result = await _remember(monkeypatch, insert)
    assert "NOT saved" in result
    # The generic path is distinct from the org-deny path.
    assert "organization memory panel" not in result


@pytest.mark.asyncio
async def test_unknown_project_returns_none_result(monkeypatch):
    _patch_context(monkeypatch)
    insert = MagicMock(return_value=None)
    result = await _remember(monkeypatch, insert)
    assert result == "Error: unknown project — nothing recorded."


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "content",
    ["Frau Huber is reachable at huber@example.com.", "The site manager's number is +43 660 1234567."],
)
async def test_a_project_write_that_looks_like_personal_data_says_so_and_names_the_personal_scope(monkeypatch, content):
    """It used to answer "unknown project": the client returns None for both."""
    _patch_context(monkeypatch)
    insert = MagicMock(return_value="item-1")
    result = await _remember(monkeypatch, insert, content=content)
    assert result.startswith("Not saved: the finding looks like personal data or a secret")
    assert "project memory is read by other people" in result
    assert "scope 'personal'" in result
    assert "unknown project" not in result
    insert.assert_not_called()


# ADR-0180: a finding about the person goes to their personal memory, with the
# turn's envelope; a temporary conversation keeps nothing.
_PERSONAL = {"scope": "personal", "kind": "preference", "content": "Prefers short answers without tables."}


def _patch_envelope(monkeypatch, envelope=("env-header", "env-signature")):
    monkeypatch.setattr(pc, "get_request_envelope_from_context", lambda: envelope)


def _personal_transport(monkeypatch, *, answer=None, error=None):
    """The BFF's personal-memory route, faked at the transport; what it was sent."""
    seen: dict = {"calls": 0}

    class _Response(io.BytesIO):
        status = 201
        headers = {"Content-Type": "application/json"}

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    class _Opener:
        def open(self, request, timeout=None):  # noqa: ANN001
            seen["calls"] += 1
            seen["url"] = request.full_url
            seen["headers"] = {key.lower(): value for key, value in request.header_items()}
            seen["payload"] = json.loads(request.data.decode("utf-8"))
            if error is not None:
                raise error
            return _Response(json.dumps(answer or {"item": {"id": "note-1"}, "created": True}).encode("utf-8"))

    monkeypatch.setenv("INTERNAL_API_TOKEN", "internal-token")
    monkeypatch.setattr(bff_http, "_opener", _Opener())
    return seen


def _refusal(status, code):
    body = io.BytesIO(json.dumps({"error": "refused", "code": code}).encode("utf-8"))
    return urllib.error.HTTPError("http://frontend:3000/api/internal/personal-memory", status, "err", {}, body)


@pytest.mark.asyncio
async def test_a_personal_finding_is_written_with_the_envelope_and_says_who_reads_it(monkeypatch):
    _patch_context(monkeypatch)
    _patch_envelope(monkeypatch)
    seen = _personal_transport(monkeypatch)
    insert = MagicMock(return_value="item-1")

    result = await _remember(monkeypatch, insert, **_PERSONAL)

    assert result == "Recorded preference in personal memory; only this person can read it."
    assert seen["url"].endswith("/api/internal/personal-memory")
    assert seen["payload"] == {
        "kind": "preference",
        "content": "Prefers short answers without tables.",
        "provenanceType": "agent",
        "sourceConversationId": "c1",
    }
    # The owner is the envelope's, echoed as it arrived; the body names nobody.
    assert seen["headers"][bff_http.REQUEST_CONTEXT_HEADER.lower()] == "env-header"
    assert seen["headers"][bff_http.REQUEST_CONTEXT_SIGNATURE_HEADER.lower()] == "env-signature"
    # Never the project's memory.
    insert.assert_not_called()


@pytest.mark.asyncio
async def test_a_personal_note_that_already_existed_is_reported_as_refreshed(monkeypatch):
    _patch_context(monkeypatch)
    _patch_envelope(monkeypatch)
    _personal_transport(monkeypatch, answer={"item": {"id": "note-1"}, "created": False})
    result = await _remember(monkeypatch, MagicMock(), **_PERSONAL)
    assert result == "Personal memory already held this preference; it was refreshed. Only this person can read it."


@pytest.mark.asyncio
async def test_a_personal_finding_without_an_envelope_is_not_saved(monkeypatch):
    _patch_context(monkeypatch)
    _patch_envelope(monkeypatch, (None, None))
    seen = _personal_transport(monkeypatch)
    insert = MagicMock(return_value="item-1")
    result = await _remember(monkeypatch, insert, **_PERSONAL)
    assert "NOT saved" in result and "Do not retry" in result
    assert seen["calls"] == 0
    insert.assert_not_called()


@pytest.mark.asyncio
async def test_a_personal_finding_needs_no_project_and_is_never_a_card(monkeypatch):
    from agent.cards.registry import CardRegistry
    from agent.cards.registry import reset_card_registry
    from agent.cards.registry import set_card_registry

    _patch_context(monkeypatch, project_id=None)
    _patch_envelope(monkeypatch)
    _patch_scope(monkeypatch, _RESTRICTED_SCOPE)
    _personal_transport(monkeypatch, error=_refusal(500, "INTERNAL"))
    registry = CardRegistry()
    token = set_card_registry(registry)
    try:
        result = await _remember(monkeypatch, MagicMock(), **_PERSONAL)
    finally:
        reset_card_registry(token)
    assert "NOT saved" in result
    assert registry.snapshot() == []


@pytest.mark.asyncio
async def test_a_personal_note_may_hold_contact_details_but_never_a_secret(monkeypatch):
    _patch_context(monkeypatch)
    _patch_envelope(monkeypatch)
    seen = _personal_transport(monkeypatch)
    kept = await _remember(
        monkeypatch, MagicMock(), scope="personal", kind="profile", content="Reachable at huber@example.com."
    )
    assert kept == "Recorded profile in personal memory; only this person can read it."
    refused = await _remember(
        monkeypatch, MagicMock(), scope="personal", kind="profile", content="The portal password is hunter2."
    )
    assert refused.startswith("Not saved: the finding looks like a secret")
    assert seen["calls"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("params", "expected"),
    [
        ({"scope": "personal", "kind": "decision"}, "Scope 'personal' takes kind 'preference'"),
        ({"scope": "project", "kind": "profile"}, "exists only in scope 'personal'"),
        ({"scope": "organization", "kind": "profile"}, "exists only in scope 'personal'"),
    ],
)
async def test_a_kind_that_does_not_fit_the_scope_writes_nothing_and_says_how_to_call_again(
    monkeypatch, params, expected
):
    _patch_context(monkeypatch)
    _patch_envelope(monkeypatch)
    seen = _personal_transport(monkeypatch)
    insert = MagicMock(return_value="item-1")
    result = await _remember(monkeypatch, insert, **params)
    assert expected in result and "nothing was saved" in result
    assert seen["calls"] == 0
    insert.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("params", [_PERSONAL, {"scope": "project"}, {"scope": "organization"}])
async def test_a_temporary_conversation_saves_nothing_and_calls_nobody(monkeypatch, params):
    _patch_context(monkeypatch)
    _patch_envelope(monkeypatch)
    seen = _personal_transport(monkeypatch)
    insert = MagicMock(return_value="item-1")
    token = pm.begin_turn_memory_log(None, temporary=True)
    try:
        result = await _remember(monkeypatch, insert, **params)
    finally:
        pm.end_turn_memory_log(token)
    assert result == "Not saved: this conversation is temporary, nothing from it is kept. Do not retry."
    assert seen["calls"] == 0
    insert.assert_not_called()


@pytest.mark.asyncio
async def test_the_bffs_temporary_refusal_reads_the_same_when_the_flag_arrived_late(monkeypatch):
    _patch_context(monkeypatch)
    _patch_envelope(monkeypatch)
    expected = "Not saved: this conversation is temporary, nothing from it is kept. Do not retry."
    # The personal route, refused at the transport.
    _personal_transport(monkeypatch, error=_refusal(403, "TEMPORARY_CONVERSATION"))
    assert await _remember(monkeypatch, MagicMock(), **_PERSONAL) == expected
    # The project route, refused by the client's named error; no card either.
    insert = MagicMock(
        side_effect=pm.TemporaryConversationError("temporary", status=403, code="TEMPORARY_CONVERSATION")
    )
    assert await _remember(monkeypatch, insert, scope="organization") == expected


@pytest.mark.asyncio
async def test_a_personal_write_is_on_the_turns_ledger_so_reflection_does_not_file_it_again(monkeypatch):
    _patch_context(monkeypatch)
    _patch_envelope(monkeypatch)
    _personal_transport(monkeypatch)
    token = pm.begin_turn_memory_log(None)
    try:
        await _remember(monkeypatch, MagicMock(), **_PERSONAL)
        assert pm.turn_memory_writes() == ("Prefers short answers without tables.",)
        assert pm.turn_restricted_memory_writes() == ()
    finally:
        pm.end_turn_memory_log(token)


@pytest.mark.asyncio
async def test_org_deny_with_card_registry_emits_confirmation(monkeypatch):
    # With a card channel bound, an org-write denial must surface a confirmation
    # card (so the user can complete the write from their own session) instead of
    # the dead-end error string.
    from agent.cards.registry import CardRegistry
    from agent.cards.registry import reset_card_registry
    from agent.cards.registry import set_card_registry

    _patch_context(monkeypatch)
    insert = MagicMock(side_effect=pm.OrgMemoryDisabledError("disabled"))

    reg = CardRegistry()
    token = set_card_registry(reg)
    try:
        result = await _remember(monkeypatch, insert, scope="organization")
    finally:
        reset_card_registry(token)

    # The tool result makes clear nothing was saved and the user decides.
    assert "NOT been saved yet" in result
    assert "org-wide" in result
    # Exactly one memory_proposal card was added to the registry.
    cards = reg.snapshot()
    assert len(cards) == 1
    assert cards[0]["type"] == "memory_proposal"
    assert cards[0]["kind"] == "derived_fact"
    assert cards[0]["content"] == "The roof load is 2 kN/m2."


@pytest.mark.asyncio
async def test_org_deny_without_card_registry_falls_back_to_error(monkeypatch):
    # No card channel bound -> the honest org-disabled error string is unchanged.
    _patch_context(monkeypatch)
    insert = MagicMock(side_effect=pm.OrgMemoryDisabledError("disabled"))
    result = await _remember(monkeypatch, insert, scope="organization")
    assert "NOT saved" in result
    assert "organization memory panel" in result
    assert "Do not retry" in result


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [RuntimeError("500 from the BFF"), TimeoutError("timed out")])
async def test_an_org_write_that_failed_otherwise_offers_no_card(monkeypatch, failure):
    # Only the refusal offers the card. The BFF audits the memory judge's
    # verdict before it refuses; a 500 or a timeout reached no audit, and a card
    # accepted then would write open memory whose verdict the trail never saw.
    from agent.cards.registry import CardRegistry
    from agent.cards.registry import reset_card_registry
    from agent.cards.registry import set_card_registry

    _patch_context(monkeypatch)
    insert = MagicMock(side_effect=failure)

    reg = CardRegistry()
    token = set_card_registry(reg)
    try:
        result = await _remember(monkeypatch, insert, scope="organization")
    finally:
        reset_card_registry(token)

    assert "NOT saved" in result
    assert "NOT been saved yet" not in result
    assert reg.snapshot() == []


@pytest.mark.asyncio
async def test_generic_project_failure_keeps_error_even_with_registry(monkeypatch):
    # A PROJECT-scoped generic failure keeps the existing honest error string —
    # the confirmation card is only for org writes the agent token can't make.
    from agent.cards.registry import CardRegistry
    from agent.cards.registry import reset_card_registry
    from agent.cards.registry import set_card_registry

    _patch_context(monkeypatch)
    insert = MagicMock(side_effect=RuntimeError("boom"))

    reg = CardRegistry()
    token = set_card_registry(reg)
    try:
        result = await _remember(monkeypatch, insert, scope="project")
    finally:
        reset_card_registry(token)

    assert "NOT saved" in result
    assert "organization memory panel" not in result
    assert reg.snapshot() == []


@pytest.mark.asyncio
async def test_supersedes_reports_a_replacement_without_claiming_it_landed(monkeypatch):
    # The frontend ignores a quote it cannot resolve, or one naming a
    # human-curated entry, and this call never learns which happened.
    _patch_context(monkeypatch)
    result = await _remember(monkeypatch, MagicMock(return_value="item-1"), supersedes="An older note")
    assert result == (
        "Recorded derived_fact in project memory, replacing the earlier note where it still matched; "
        "the project's members can read it."
    )


@pytest.mark.asyncio
async def test_empty_content_is_refused_without_a_write(monkeypatch):
    _patch_context(monkeypatch)
    insert = MagicMock(return_value="item-1")
    result = await _remember(monkeypatch, insert, content="   ")
    assert result == "Error: content must not be empty."
    assert not insert.called


@pytest.mark.asyncio
async def test_content_is_truncated_to_the_configured_cap(monkeypatch):
    _patch_context(monkeypatch)
    insert = MagicMock(return_value="item-1")
    monkeypatch.setattr(pm, "insert_memory_item", insert)
    async with project_memory_remember(ProjectMemoryRememberConfig(max_content_chars=10), MagicMock()) as info:
        await info.single_fn(info.input_schema(kind="decision", content="x" * 50))
    assert insert.call_args.kwargs["content"] == "x" * 10


@pytest.mark.asyncio
async def test_a_project_call_without_a_project_escalates_to_the_organization(monkeypatch):
    # The finding is still worth keeping; the org path then hits the frontend's
    # default deny and comes back as a confirmation card (audit finding S1).
    _patch_context(monkeypatch, project_id=None)
    insert = MagicMock(return_value="item-1")
    monkeypatch.setattr(pm, "insert_memory_item", insert)
    async with project_memory_remember(ProjectMemoryRememberConfig(), MagicMock()) as info:
        result = await info.single_fn(info.input_schema(kind="decision", content="Firm-wide rule.", scope="project"))
    assert result == "Recorded decision in organization memory; everyone in the organization can read it."
    assert insert.call_args.kwargs["scope"] == "organization"
    assert insert.call_args.kwargs["project_id"] is None


@pytest.mark.asyncio
async def test_no_project_and_no_organization_is_a_dead_end(monkeypatch):
    _patch_context(monkeypatch, project_id=None, organization_id=None)
    insert = MagicMock()
    result = await _remember(monkeypatch, insert)
    assert "no project in scope" in result
    assert "Do not retry" in result
    assert not insert.called


@pytest.mark.asyncio
async def test_org_scope_without_an_organization_is_a_dead_end(monkeypatch):
    _patch_context(monkeypatch, organization_id=None)
    insert = MagicMock()
    result = await _remember(monkeypatch, insert, scope="organization")
    assert "organization unknown" in result
    assert not insert.called


@pytest.mark.asyncio
async def test_a_vocabulary_disagreement_with_the_client_is_not_dressed_up_as_an_outage(monkeypatch):
    """``ValueError`` out of the client means this tool's vocabulary and
    ``knowledge.project_memory``'s have drifted apart. Reporting that as "memory
    is unavailable" is how a defect ships quietly."""
    _patch_context(monkeypatch)
    insert = MagicMock(side_effect=ValueError("Invalid kind 'decision'"))
    with pytest.raises(ValueError, match="Invalid kind"):
        await _remember(monkeypatch, insert)


@pytest.mark.asyncio
async def test_an_unbuildable_card_falls_back_to_the_error_string(monkeypatch):
    from agent.cards.registry import CardRegistry
    from agent.cards.registry import reset_card_registry
    from agent.cards.registry import set_card_registry

    _patch_context(monkeypatch)
    insert = MagicMock(side_effect=pm.OrgMemoryDisabledError("disabled"))
    # A card the adapter refuses must not take the turn down with it.
    monkeypatch.setattr(
        register,
        "answer_card_adapter",
        _RefusingAdapter(),
    )

    reg = CardRegistry()
    token = set_card_registry(reg)
    try:
        result = await _remember(monkeypatch, insert, scope="organization")
    finally:
        reset_card_registry(token)

    assert "organization memory panel" in result
    assert reg.snapshot() == []


class TestToolVocabulary:
    """The tool advertises its enums in its own JSON schema, so a provider
    constrains the argument before it is ever sent. Nothing checks those spellings
    against the write client's, so a rename on either side would start rejecting
    every call — pin them."""

    def test_kinds_match_the_write_clients_vocabulary(self):
        assert set(register.Kind.__args__[0].__args__) == pm.VALID_KINDS | personal.VALID_PERSONAL_KINDS

    def test_confidences_match_the_write_clients_vocabulary(self):
        assert set(register.Confidence.__args__[0].__args__) == pm.VALID_CONFIDENCES

    def test_scopes_match_the_write_clients_vocabulary(self):
        assert set(register.Scope.__args__[0].__args__) == pm.VALID_SCOPES | {"personal"}

    @pytest.mark.asyncio
    async def test_the_enums_reach_the_tool_schema(self):
        async with project_memory_remember(ProjectMemoryRememberConfig(), MagicMock()) as info:
            schema = info.input_schema.model_json_schema()
        assert set(schema["properties"]["kind"]["enum"]) == pm.VALID_KINDS | personal.VALID_PERSONAL_KINDS
        assert set(schema["properties"]["scope"]["enum"]) == pm.VALID_SCOPES | {"personal"}

    @pytest.mark.asyncio
    async def test_every_parameter_is_described_to_the_model(self):
        async with project_memory_remember(ProjectMemoryRememberConfig(), MagicMock()) as info:
            properties = info.input_schema.model_json_schema()["properties"]
        assert set(properties) == {"kind", "content", "confidence", "scope", "supersedes"}
        assert all(len(field.get("description", "")) > 40 for field in properties.values())
        assert "only that person reads it" in properties["scope"]["description"]

    @pytest.mark.asyncio
    async def test_case_and_whitespace_are_folded_rather_than_rejected(self, monkeypatch):
        _patch_context(monkeypatch)
        insert = MagicMock(return_value="item-1")
        result = await _remember(monkeypatch, insert, kind=" Derived_Fact ", confidence="HIGH")
        assert result == "Recorded derived_fact in project memory; the project's members can read it."
        assert insert.call_args.kwargs["confidence"] == "high"

    @pytest.mark.asyncio
    async def test_a_value_outside_the_vocabulary_is_a_correctable_validation_error(self):
        """It used to be rewritten in silence for ``scope`` and ``confidence``,
        which moved a finding into a scope nobody asked for. The tool loop hands
        the validation error back for the model to correct instead."""
        async with project_memory_remember(ProjectMemoryRememberConfig(), MagicMock()) as info:
            with pytest.raises(ValidationError):
                info.input_schema(kind="decision", content="x", scope="global")


# ADR-0087: a turn whose scope holds a restricted folder's collection still
# remembers; what it writes is restricted memory, never organization memory, and
# never a confirmation card (an accepted card is an open write by another door).
_RESTRICTED = "proj_abc_r0123456789ab"
_RESTRICTED_SCOPE = ["oib_knowledge", "proj_abc", _RESTRICTED, "s_c1"]
_CONTRACT_ROW = {"collection": _RESTRICTED, "file_name": "Honorarvertrag.pdf", "summary": "Honorar 184.000 EUR"}


def _patch_scope(monkeypatch, scope):
    from agent.knowledge import scoping

    monkeypatch.setattr(scoping, "get_collection_scope_from_context", lambda: scope)


def _patch_turn(monkeypatch, *, read=(), rows=(_CONTRACT_ROW,), judge=None):
    """Bind what the turn read and could list, and the judge model it resolves."""
    from agent.citations import session
    from agent.citations.entries import SourceEntry
    from agent.knowledge import inventory

    monkeypatch.setattr(session, "get_turn_captures", lambda: [SourceEntry(collection=name) for name in read])
    monkeypatch.setattr(session, "get_session_registry", lambda: None)
    monkeypatch.setattr(inventory, "get_turn_documents", lambda: tuple(rows))
    monkeypatch.setattr(register, "_turn_judge_llm", lambda _base: judge)


class _Judge:
    def __init__(self, documents_per_note):
        self._reply = json.dumps({"notes": [{"note": 1, "documents": documents_per_note}]})

    def bind(self, **_kwargs):
        return self

    async def ainvoke(self, _messages):
        return type("_R", (), {"content": self._reply})()


@pytest.mark.asyncio
async def test_a_finding_from_a_read_restricted_folder_is_restricted_memory(monkeypatch):
    _patch_context(monkeypatch)
    _patch_scope(monkeypatch, _RESTRICTED_SCOPE)
    _patch_turn(monkeypatch, read=[_RESTRICTED])
    insert = MagicMock(return_value="item-1")
    result = await _remember(monkeypatch, insert)
    assert insert.call_args.kwargs["restricted_collections"] == (_RESTRICTED,)
    assert insert.call_args.kwargs["scope"] == "project"
    assert result.startswith("Recorded derived_fact in project memory. It draws on a restricted folder")
    assert "restricted" in result


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("judge", "expected", "verdict"),
    [(_Judge([1]), (_RESTRICTED,), "drawn"), (_Judge([]), None, "none"), (None, (_RESTRICTED,), "failed")],
)
async def test_a_listed_but_unread_folder_is_judged(monkeypatch, judge, expected, verdict):
    """Yes restricts, no leaves it open, no judge at all fails closed."""
    _patch_context(monkeypatch)
    _patch_scope(monkeypatch, _RESTRICTED_SCOPE)
    _patch_turn(monkeypatch, judge=judge)
    insert = MagicMock(return_value="item-1")
    await _remember(monkeypatch, insert)
    assert insert.call_args.kwargs["restricted_collections"] == expected
    # AI Act: the verdict goes with the write, for the BFF's audit trail.
    assert insert.call_args.kwargs["restriction_judge"] == {
        "verdict": verdict,
        "judgedCollections": [_RESTRICTED],
        "drawnCollections": [_RESTRICTED] if verdict == "drawn" else [],
    }


@pytest.mark.asyncio
async def test_a_finding_no_judge_decided_sends_no_verdict(monkeypatch):
    _patch_context(monkeypatch)
    _patch_scope(monkeypatch, _RESTRICTED_SCOPE)
    _patch_turn(monkeypatch, read=[_RESTRICTED])
    insert = MagicMock(return_value="item-1")
    await _remember(monkeypatch, insert)
    assert insert.call_args.kwargs["restriction_judge"] is None


@pytest.mark.asyncio
async def test_a_paraphrase_of_restricted_memory_in_the_digest_is_restricted(monkeypatch):
    """The judge sees the digest's restricted lines; drawing on one restricts to all of the scope."""
    _patch_context(monkeypatch)
    _patch_scope(monkeypatch, _RESTRICTED_SCOPE)
    _patch_turn(monkeypatch, rows=({"collection": "proj_abc", "file_name": "Plan.pdf"},), judge=_Judge([1]))
    token = pm.begin_turn_memory_log('- [restricted | decision | high | unverified] "Honorar pauschal 184.000"')
    try:
        insert = MagicMock(return_value="item-1")
        await _remember(monkeypatch, insert, content="Das Honorar ist pauschal.")
    finally:
        pm.end_turn_memory_log(token)
    assert insert.call_args.kwargs["restricted_collections"] == (_RESTRICTED,)


@pytest.mark.asyncio
async def test_a_restricted_organization_finding_is_kept_as_restricted_project_memory(monkeypatch):
    _patch_context(monkeypatch)
    _patch_scope(monkeypatch, _RESTRICTED_SCOPE)
    _patch_turn(monkeypatch, read=[_RESTRICTED])
    insert = MagicMock(return_value="item-1")
    result = await _remember(monkeypatch, insert, scope="organization")
    kwargs = insert.call_args.kwargs
    assert (kwargs["scope"], kwargs["project_id"], kwargs["restricted_collections"]) == (
        "project",
        "p1",
        (_RESTRICTED,),
    )
    assert "not organization-wide" in result


@pytest.mark.asyncio
async def test_a_restricted_organization_finding_without_a_project_is_not_saved(monkeypatch):
    _patch_context(monkeypatch, project_id=None)
    _patch_scope(monkeypatch, _RESTRICTED_SCOPE)
    _patch_turn(monkeypatch, read=[_RESTRICTED])
    insert = MagicMock(return_value="item-1")
    result = await _remember(monkeypatch, insert, scope="organization")
    assert "NOT saved" in result
    insert.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("scope", ["project", "organization"])
async def test_a_failed_restricted_write_never_becomes_a_card(monkeypatch, scope):
    from agent.cards.registry import CardRegistry
    from agent.cards.registry import reset_card_registry
    from agent.cards.registry import set_card_registry

    _patch_context(monkeypatch)
    _patch_scope(monkeypatch, _RESTRICTED_SCOPE)
    _patch_turn(monkeypatch, read=[_RESTRICTED])
    insert = MagicMock(side_effect=pm.OrgMemoryDisabledError("disabled"))
    reg = CardRegistry()
    token = set_card_registry(reg)
    try:
        result = await _remember(monkeypatch, insert, scope=scope)
    finally:
        reset_card_registry(token)
    assert "NOT saved" in result
    assert reg.snapshot() == []


@pytest.mark.asyncio
async def test_an_open_scope_still_records(monkeypatch):
    _patch_context(monkeypatch)
    _patch_scope(monkeypatch, ["oib_knowledge", "proj_abc", "s_c1"])
    insert = MagicMock(return_value="item-1")
    assert (
        await _remember(monkeypatch, insert)
        == "Recorded derived_fact in project memory; the project's members can read it."
    )
    insert.assert_called_once()
    assert insert.call_args.kwargs["restricted_collections"] is None


@pytest.mark.asyncio
async def test_a_restricted_note_an_earlier_turn_was_shown_still_restricts(monkeypatch):
    """ADR-0087: the note is gone from this turn's digest and no restricted row is
    listable; what earlier turns were shown (bound by `turn_registries`) is still
    evidence, and a copy of it is restricted to the note's own collection."""
    from agent.memory.restriction import RestrictedNote
    from agent.memory.shown_notes import ShownNotes
    from agent.memory.shown_notes import bind_shown_notes
    from agent.memory.shown_notes import unbind_shown_notes

    _patch_context(monkeypatch)
    _patch_scope(monkeypatch, _RESTRICTED_SCOPE)
    # The judge answers "nothing": only the deterministic copy check can restrict.
    _patch_turn(monkeypatch, rows=({"collection": "proj_abc", "file_name": "Plan.pdf"},), judge=_Judge([]))
    token = bind_shown_notes(ShownNotes(notes=(RestrictedNote("Honorar pauschal 184.000 EUR netto", (_RESTRICTED,)),)))
    try:
        insert = MagicMock(return_value="item-1")
        await _remember(monkeypatch, insert, content="Honorar pauschal 184.000 EUR netto")
    finally:
        unbind_shown_notes(token)
    assert insert.call_args.kwargs["restricted_collections"] == (_RESTRICTED,)


# ── The confirmation card is backed by a server proposal (ADR-0105) ──────────
#
# An org-denied note becomes a `memory` proposal the BFF stores and the
# accepting person applies in their own session. Only the transport is faked, so
# the body checked here is the one `post_proposal` really sends.

_PROPOSALS_SCHEMA = Path(__file__).resolve().parents[4] / "apps/workspace/tests/fixtures/proposals.schema.json"
_PROPOSAL_ID = "55555555-0000-4000-8000-000000000005"
_HEADER, _SIGNATURE = "eyJzaWduZWQiOiJ0dXJuIn0", "c0ffee"


class _Transport:
    """``_opener.open`` with one queued answer: a dict is a 200 body, an int an HTTP error."""

    def __init__(self, answer):
        self.answer = answer
        self.requests: list[urllib.request.Request] = []

    def bodies(self):
        return [json.loads(request.data) for request in self.requests]

    def __call__(self, request, timeout):
        self.requests.append(request)
        if isinstance(self.answer, int):
            raise urllib.error.HTTPError(request.full_url, self.answer, "refused", {}, io.BytesIO(b"{}"))
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps(self.answer).encode("utf-8")
        return response


@pytest.fixture
def proposals(monkeypatch):
    """A turn with a signed envelope, a service token and a card registry; the installed transport."""
    from agent.cards.registry import CardRegistry
    from agent.cards.registry import reset_card_registry
    from agent.cards.registry import set_card_registry

    _patch_context(monkeypatch)
    monkeypatch.setattr(pc, "get_request_envelope_from_context", lambda: (_HEADER, _SIGNATURE))
    monkeypatch.setenv("INTERNAL_API_TOKEN", "internal-token")
    monkeypatch.setenv("FRONTEND_INTERNAL_URL", "http://bff.test")
    registry = CardRegistry()
    token = set_card_registry(registry)

    def install(answer):
        transport = _Transport(answer)
        monkeypatch.setattr(bff_http._opener, "open", transport)
        return transport

    yield type("Proposals", (), {"registry": registry, "install": staticmethod(install)})
    reset_card_registry(token)


def _contract_errors(body):
    from jsonschema import Draft202012Validator
    from jsonschema import FormatChecker

    schema = json.loads(_PROPOSALS_SCHEMA.read_text(encoding="utf-8"))
    request = {**schema["$defs"]["InternalProposalRequest"], "$defs": schema["$defs"]}
    return [error.message for error in Draft202012Validator(request, format_checker=FormatChecker()).iter_errors(body)]


@pytest.mark.asyncio
async def test_an_org_denied_note_becomes_a_memory_proposal_and_the_card_carries_its_id(monkeypatch, proposals):
    transport = proposals.install({"id": _PROPOSAL_ID, "status": "proposed"})
    insert = MagicMock(side_effect=pm.OrgMemoryDisabledError("disabled"))

    result = await _remember(
        monkeypatch,
        insert,
        scope="organization",
        kind="decision",
        content="Das Büro plant in Achsmaßen.",
        confidence="high",
        supersedes="Das Büro plant in Rohbaumaßen.",
    )

    (body,) = transport.bodies()
    assert _contract_errors(body) == []
    assert body["kind"] == "memory"
    assert body["payload"] == {
        "scope": "organization",
        "kind": "decision",
        "content": "Das Büro plant in Achsmaßen.",
        "confidence": "high",
        "supersedes": "Das Büro plant in Rohbaumaßen.",
    }
    assert body["originCardIndex"] == 0
    (request,) = transport.requests
    assert request.get_header("X-request-context") == _HEADER  # echoed, never signed
    assert request.get_header("X-request-context-sig") == _SIGNATURE
    (card,) = proposals.registry.snapshot()
    assert card["type"] == "memory_proposal"
    assert card["proposal_id"] == _PROPOSAL_ID
    assert card["supersedes"] == "Das Büro plant in Rohbaumaßen."
    # Nothing was saved yet, and the model is told so.
    assert result == register._CARD_SHOWN_RESULT
    assert "NOT been saved yet" in result


@pytest.mark.asyncio
async def test_a_note_that_corrects_nothing_sends_no_supersedes(monkeypatch, proposals):
    transport = proposals.install({"id": _PROPOSAL_ID, "status": "proposed"})
    insert = MagicMock(side_effect=pm.OrgMemoryDisabledError("disabled"))

    await _remember(monkeypatch, insert, scope="organization")

    (body,) = transport.bodies()
    assert _contract_errors(body) == []
    assert "supersedes" not in body["payload"]
    (card,) = proposals.registry.snapshot()
    assert "supersedes" not in card


@pytest.mark.asyncio
async def test_the_cards_index_is_its_position_among_the_turns_cards(monkeypatch, proposals):
    proposals.registry.add({"type": "document_draft"})
    transport = proposals.install({"id": _PROPOSAL_ID, "status": "proposed"})
    insert = MagicMock(side_effect=pm.OrgMemoryDisabledError("disabled"))

    await _remember(monkeypatch, insert, scope="organization")

    assert [body["originCardIndex"] for body in transport.bodies()] == [1]
    assert proposals.registry.snapshot()[1]["proposal_id"] == _PROPOSAL_ID


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", [404, 500], ids=["older-bff", "server-error"])
async def test_a_proposal_that_cannot_be_stored_leaves_the_legacy_card(monkeypatch, proposals, failure):
    transport = proposals.install(failure)
    insert = MagicMock(side_effect=pm.OrgMemoryDisabledError("disabled"))

    result = await _remember(monkeypatch, insert, scope="organization", supersedes="Früher.")

    assert len(transport.requests) == 1
    (card,) = proposals.registry.snapshot()
    assert card["type"] == "memory_proposal" and "proposal_id" not in card
    assert result == register._CARD_SHOWN_RESULT


@pytest.mark.asyncio
async def test_a_turn_without_an_envelope_asks_nobody_and_shows_the_legacy_card(monkeypatch, proposals):
    transport = proposals.install({"id": _PROPOSAL_ID, "status": "proposed"})
    monkeypatch.setattr(pc, "get_request_envelope_from_context", lambda: (None, None))
    insert = MagicMock(side_effect=pm.OrgMemoryDisabledError("disabled"))

    result = await _remember(monkeypatch, insert, scope="organization")

    assert transport.requests == []
    (card,) = proposals.registry.snapshot()
    assert "proposal_id" not in card
    assert result == register._CARD_SHOWN_RESULT


@pytest.mark.asyncio
@pytest.mark.parametrize("scope", ["project", "organization"])
async def test_a_restricted_finding_stores_no_proposal_and_shows_no_card(monkeypatch, proposals, scope):
    """A proposal would be accepted into open memory by the reader's session: the leak by another door."""
    transport = proposals.install({"id": _PROPOSAL_ID, "status": "proposed"})
    _patch_scope(monkeypatch, _RESTRICTED_SCOPE)
    _patch_turn(monkeypatch, read=[_RESTRICTED])
    insert = MagicMock(side_effect=pm.OrgMemoryDisabledError("disabled"))

    result = await _remember(monkeypatch, insert, scope=scope)

    assert "NOT saved" in result
    assert transport.requests == []
    assert proposals.registry.snapshot() == []


@pytest.mark.asyncio
async def test_a_failure_that_is_not_the_org_policy_stores_no_proposal(monkeypatch, proposals):
    transport = proposals.install({"id": _PROPOSAL_ID, "status": "proposed"})
    insert = MagicMock(side_effect=RuntimeError("boom"))

    result = await _remember(monkeypatch, insert, scope="organization")

    assert "NOT saved" in result
    assert transport.requests == []
    assert proposals.registry.snapshot() == []


@pytest.mark.asyncio
async def test_a_superseded_quote_too_long_for_a_proposal_is_dropped_not_sent(monkeypatch, proposals):
    transport = proposals.install({"id": _PROPOSAL_ID, "status": "proposed"})
    insert = MagicMock(side_effect=pm.OrgMemoryDisabledError("disabled"))

    await _remember(monkeypatch, insert, scope="organization", supersedes="x" * 600)

    (body,) = transport.bodies()
    assert _contract_errors(body) == []
    assert "supersedes" not in body["payload"]
