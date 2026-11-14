"""Tests for insert_memory_item and check_internal_api error handling.

Reuses the fake-opener harness pattern from test_project_memory_digest.py so
the internal HTTP calls can be driven without a real frontend.
"""

import contextlib
import io
import json
import logging
import urllib.error

import pytest

from agent.common import bff_http
from agent.knowledge import project_memory as pm


class _FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@contextlib.contextmanager
def _patched_opener(monkeypatch, *, body=None, error=None):
    captured = {}

    class _Opener:
        def open(self, request, timeout=None):  # noqa: ANN001
            captured["url"] = request.full_url
            captured["headers"] = request.headers
            captured["method"] = request.get_method()
            captured["payload"] = json.loads(request.data.decode("utf-8")) if request.data else None
            if error is not None:
                raise error
            return _FakeResponse(json.dumps(body).encode("utf-8"))

    monkeypatch.setattr(bff_http, "_opener", _Opener())
    yield captured


def _http_error(code, body=b""):
    """Build an HTTPError whose .read() yields ``body`` (JSON error envelope)."""
    fp = io.BytesIO(body)
    return urllib.error.HTTPError("http://frontend:3000/api/internal/memory", code, "err", {}, fp)


# ---------------------------------------------------------------------------
# insert_memory_item
# ---------------------------------------------------------------------------


def test_insert_returns_item_id(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    with _patched_opener(monkeypatch, body={"item": {"id": "item-1"}}) as captured:
        result = pm.insert_memory_item(
            scope="project", project_id="p1", organization_id=None, kind="derived_fact", content="x"
        )
    assert result == "item-1"
    assert captured["method"] == "POST"


def test_insert_sends_the_supersedes_quote(monkeypatch):
    """How the agent corrects memory instead of only appending to it: the entry
    being replaced is quoted verbatim and the frontend retires it."""
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    with _patched_opener(monkeypatch, body={"item": {"id": "item-2"}}) as captured:
        pm.insert_memory_item(
            scope="project",
            project_id="p1",
            organization_id=None,
            kind="derived_fact",
            content="OIB-RL 2.1 ist anwendbar.",
            supersedes_content="  OIB-RL 2.1 ist nicht anwendbar  ",
        )
    assert captured["payload"]["supersedesContent"] == "OIB-RL 2.1 ist nicht anwendbar"


def test_insert_omits_the_supersedes_quote_when_absent(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    with _patched_opener(monkeypatch, body={"item": {"id": "item-3"}}) as captured:
        pm.insert_memory_item(
            scope="project",
            project_id="p1",
            organization_id=None,
            kind="derived_fact",
            content="x",
            supersedes_content="   ",
        )
    assert "supersedesContent" not in captured["payload"]


def test_insert_sends_the_topic_trimmed(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    with _patched_opener(monkeypatch, body={"item": {"id": "item-4"}}) as captured:
        pm.insert_memory_item(
            scope="project", project_id="p1", organization_id=None, kind="decision", content="x", topic="  Brandschutz "
        )
    assert captured["payload"]["topic"] == "Brandschutz"


@pytest.mark.parametrize("topic", [None, "", "   ", "T" * 41])
def test_insert_omits_a_topic_that_is_absent_empty_or_too_long(monkeypatch, topic):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    with _patched_opener(monkeypatch, body={"item": {"id": "item-5"}}) as captured:
        result = pm.insert_memory_item(
            scope="project", project_id="p1", organization_id=None, kind="decision", content="x", topic=topic
        )
    assert result == "item-5"
    assert "topic" not in captured["payload"]


def test_insert_raises_without_token(monkeypatch):
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    with pytest.raises(RuntimeError):
        pm.insert_memory_item(scope="project", project_id="p1", organization_id=None, kind="derived_fact", content="x")


def test_org_memory_disabled_raises_typed_error(monkeypatch, caplog):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    body = json.dumps({"error": "Agent organization-scoped memory is disabled", "code": "ORG_MEMORY_DISABLED"}).encode()
    with _patched_opener(monkeypatch, error=_http_error(403, body)):
        # The default-deny is expected and handled by the caller (confirmation
        # card), so it is logged at INFO, not ERROR — capture from INFO up.
        with caplog.at_level(logging.INFO, logger=pm.logger.name):
            with pytest.raises(pm.OrgMemoryDisabledError):
                pm.insert_memory_item(
                    scope="organization",
                    project_id=None,
                    organization_id="o1",
                    kind="preference",
                    content="Prefer metric units.",
                )
    # The typed error is the contract; the log is informational, not an error.
    assert "ORG_MEMORY_DISABLED" in caplog.text
    org_deny_records = [r for r in caplog.records if "ORG_MEMORY_DISABLED" in r.getMessage()]
    assert org_deny_records and all(r.levelno <= logging.INFO for r in org_deny_records)


def test_bare_403_logs_token_mismatch_and_reraises(monkeypatch, caplog):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    # Bare 403 (token guard): body {"error":"Forbidden"} with no code.
    body = json.dumps({"error": "Forbidden"}).encode()
    with _patched_opener(monkeypatch, error=_http_error(403, body)):
        with caplog.at_level(logging.ERROR, logger=pm.logger.name):
            with pytest.raises(bff_http.BffRefusedError):
                pm.insert_memory_item(
                    scope="project", project_id="p1", organization_id=None, kind="derived_fact", content="x"
                )
    assert "INTERNAL_API_TOKEN" in caplog.text
    assert "mismatch" in caplog.text
    # Must NOT be mislabeled as the org-disabled case.
    assert not any(isinstance(r.exc_info, pm.OrgMemoryDisabledError) for r in caplog.records)


def test_forbidden_code_403_treated_as_token_mismatch(monkeypatch, caplog):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    body = json.dumps({"error": "Forbidden", "code": "FORBIDDEN"}).encode()
    with _patched_opener(monkeypatch, error=_http_error(403, body)):
        with caplog.at_level(logging.ERROR, logger=pm.logger.name):
            with pytest.raises(bff_http.BffRefusedError):
                pm.insert_memory_item(
                    scope="project", project_id="p1", organization_id=None, kind="derived_fact", content="x"
                )
    assert "mismatch" in caplog.text


def test_503_logs_disabled_and_reraises(monkeypatch, caplog):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    with _patched_opener(monkeypatch, error=_http_error(503, b'{"error":"Internal API disabled"}')):
        with caplog.at_level(logging.ERROR, logger=pm.logger.name):
            with pytest.raises(bff_http.BffRefusedError):
                pm.insert_memory_item(
                    scope="project", project_id="p1", organization_id=None, kind="derived_fact", content="x"
                )
    assert "503" in caplog.text


def test_404_returns_none(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    with _patched_opener(monkeypatch, error=_http_error(404, b'{"error":"Unknown project"}')):
        result = pm.insert_memory_item(
            scope="project", project_id="p-unknown", organization_id=None, kind="derived_fact", content="x"
        )
    assert result is None


# ---------------------------------------------------------------------------
# check_internal_api
# ---------------------------------------------------------------------------


def test_check_internal_api_ok(monkeypatch, caplog):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    with _patched_opener(monkeypatch, body={"ok": True}) as captured:
        with caplog.at_level(logging.INFO, logger=pm.logger.name):
            result = pm.check_internal_api()
    assert result is True
    assert "/api/internal/health" in captured["url"]
    assert "service token accepted" in caplog.text


def test_check_internal_api_no_token(monkeypatch, caplog):
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)
    with caplog.at_level(logging.ERROR, logger=pm.logger.name):
        result = pm.check_internal_api()
    assert result is False
    assert "INTERNAL_API_TOKEN" in caplog.text


def test_check_internal_api_403(monkeypatch, caplog):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    with _patched_opener(monkeypatch, error=_http_error(403, b'{"error":"Forbidden"}')):
        with caplog.at_level(logging.ERROR, logger=pm.logger.name):
            result = pm.check_internal_api()
    assert result is False
    assert "INTERNAL_API_TOKEN" in caplog.text


def test_check_internal_api_503(monkeypatch, caplog):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    with _patched_opener(monkeypatch, error=_http_error(503, b'{"error":"Internal API disabled"}')):
        with caplog.at_level(logging.ERROR, logger=pm.logger.name):
            result = pm.check_internal_api()
    assert result is False
    assert "503" in caplog.text


def test_check_internal_api_connection_error(monkeypatch, caplog):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    with _patched_opener(monkeypatch, error=urllib.error.URLError("connection refused")):
        with caplog.at_level(logging.WARNING, logger=pm.logger.name):
            result = pm.check_internal_api()
    assert result is False
    assert "may not be up yet" in caplog.text


def test_check_internal_api_never_raises_on_oserror(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    with _patched_opener(monkeypatch, error=OSError("boom")):
        # Must swallow the error and return False, never propagate.
        assert pm.check_internal_api() is False


def test_insert_sends_a_restriction_sorted_and_unique(monkeypatch):
    """ADR-0087: restricted memory names the restricted collections it depends on."""
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    with _patched_opener(monkeypatch, body={"item": {"id": "item-r"}}) as captured:
        pm.insert_memory_item(
            scope="project",
            project_id="p1",
            organization_id=None,
            kind="decision",
            content="x",
            restricted_collections=("proj_p1_rbbbbbbbbbbbb", "proj_p1_raaaaaaaaaaaa", "proj_p1_raaaaaaaaaaaa"),
        )
    assert captured["payload"]["restrictedCollections"] == ["proj_p1_raaaaaaaaaaaa", "proj_p1_rbbbbbbbbbbbb"]


def test_insert_sends_the_judge_verdict_for_the_audit_trail(monkeypatch):
    """AI Act: the BFF audits the judge's verdict with the item it was about."""
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    verdict = {"verdict": "none", "judgedCollections": ["proj_p1_raaaaaaaaaaaa"], "drawnCollections": []}
    with _patched_opener(monkeypatch, body={"item": {"id": "item-j"}}) as captured:
        pm.insert_memory_item(
            scope="project",
            project_id="p1",
            organization_id=None,
            kind="decision",
            content="x",
            restriction_judge=verdict,
        )
    assert captured["payload"]["restrictionJudge"] == verdict


def test_open_memory_sends_no_restriction(monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    with _patched_opener(monkeypatch, body={"item": {"id": "item-o"}}) as captured:
        pm.insert_memory_item(scope="project", project_id="p1", organization_id=None, kind="decision", content="x")
    assert "restrictedCollections" not in captured["payload"]
    assert "restrictionJudge" not in captured["payload"]


def test_a_restricted_write_is_logged_as_restricted_for_the_turn(monkeypatch):
    """The reflection stage and a later remember call treat it as restricted memory in the prompt."""
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    token = pm.begin_turn_memory_log("DIGEST")
    try:
        with _patched_opener(monkeypatch, body={"item": {"id": "item-r"}}):
            pm.insert_memory_item(
                scope="project",
                project_id="p1",
                organization_id=None,
                kind="decision",
                content="geheim",
                restricted_collections=("proj_p1_raaaaaaaaaaaa",),
            )
            pm.insert_memory_item(
                scope="project", project_id="p1", organization_id=None, kind="decision", content="offen"
            )
        assert pm.turn_memory_writes() == ("geheim", "offen")
        assert pm.turn_restricted_memory_writes() == ("geheim",)
        assert pm.turn_memory_digest() == "DIGEST"
    finally:
        pm.end_turn_memory_log(token)
    assert pm.turn_memory_digest() is None


def test_a_temporary_conversation_raises_its_own_error(monkeypatch):
    """ADR-0180: the BFF refuses the write (403 ``TEMPORARY_CONVERSATION``); it is not a token mismatch."""
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    body = json.dumps({"error": "The conversation is temporary", "code": "TEMPORARY_CONVERSATION"}).encode()
    with _patched_opener(monkeypatch, error=_http_error(403, body)):
        with pytest.raises(pm.TemporaryConversationError):
            pm.insert_memory_item(
                scope="project", project_id="p1", organization_id=None, kind="derived_fact", content="x"
            )


@pytest.mark.parametrize(
    ("content", "personal_data", "secret"),
    [
        ("Reachable at huber@example.com.", True, False),
        ("Call +43 660 1234567 before noon.", True, False),
        ("The portal password is hunter2.", True, True),
        ("IBAN AT611904300234573201 is the fee account.", True, True),
        ("Leads the permit phase and prefers short answers.", False, False),
        ("The permit deadline is 12/03/2027.", False, False),
    ],
)
def test_the_secret_shapes_are_the_part_of_the_denylist_personal_memory_keeps(content, personal_data, secret):
    assert pm.looks_like_personal_data(content) is personal_data
    assert pm.looks_like_secret(content) is secret


# ---------------------------------------------------------------------------
# The turn's ledger of created notes (what the answer's noted chip is told)
# ---------------------------------------------------------------------------


def _insert(monkeypatch, body, **overrides):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t")
    params = {
        "scope": "project",
        "project_id": "p1",
        "organization_id": "o1",
        "kind": "decision",
        "content": " Flat roof. ",
    }
    params.update(overrides)
    with _patched_opener(monkeypatch, body=body):
        return pm.insert_memory_item(**params)


def test_a_created_note_is_entered_in_the_turns_ledger_as_it_was_stored(monkeypatch):
    token = pm.begin_turn_memory_log()
    try:
        assert _insert(monkeypatch, {"item": {"id": "item-1"}, "supersededId": None, "created": True}) == "item-1"
        assert pm.turn_memory_notes() == (
            pm.TurnMemoryNote(id="item-1", kind="decision", content="Flat roof.", scope="project"),
        )
        assert pm.turn_memory_writes() == ("Flat roof.",)
    finally:
        pm.end_turn_memory_log(token)


def test_a_note_counts_as_replacing_one_only_when_the_route_retired_it(monkeypatch):
    token = pm.begin_turn_memory_log()
    try:
        _insert(monkeypatch, {"item": {"id": "a"}, "supersededId": "old"}, supersedes_content="Pitched roof.")
        _insert(monkeypatch, {"item": {"id": "b"}, "supersededId": None}, supersedes_content="No such note.")
        assert [note.supersedes for note in pm.turn_memory_notes()] == ["Pitched roof.", None]
    finally:
        pm.end_turn_memory_log(token)


def test_a_restated_note_the_route_only_refreshed_is_a_write_but_no_new_note(monkeypatch):
    """Reflection still reads it as recorded; the chip must not offer to remove a note this turn did not create."""
    token = pm.begin_turn_memory_log()
    try:
        assert _insert(monkeypatch, {"item": {"id": "old"}, "created": False}) == "old"
        assert pm.turn_memory_notes() == ()
        assert pm.turn_refreshed_memory_ids() == frozenset({"old"})
        assert pm.turn_memory_writes() == ("Flat roof.",)
    finally:
        pm.end_turn_memory_log(token)


def test_a_restricted_and_an_organization_note_say_so(monkeypatch):
    token = pm.begin_turn_memory_log()
    try:
        _insert(monkeypatch, {"item": {"id": "r"}}, restricted_collections=["proj_p1_r0123456789ab"])
        _insert(monkeypatch, {"item": {"id": "o"}}, scope="organization", project_id=None)
        restricted, office = pm.turn_memory_notes()
        assert (restricted.restricted, restricted.scope) == (True, "project")
        assert (office.restricted, office.scope) == (False, "organization")
        assert office.frame_item(in_turn=True) == {
            "id": "o",
            "kind": "decision",
            "content": "Flat roof.",
            "provenance": "agent",
            "scope": "organization",
        }
    finally:
        pm.end_turn_memory_log(token)


def test_outside_a_turn_a_write_enters_no_ledger(monkeypatch):
    assert _insert(monkeypatch, {"item": {"id": "item-1"}}) == "item-1"
    assert pm.turn_memory_notes() == ()
