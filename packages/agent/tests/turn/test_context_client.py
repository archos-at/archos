"""Authenticated context transport: echo credentials, bound prompts, fail closed."""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import urllib.error
from dataclasses import replace
from unittest.mock import MagicMock

import pytest

from agent.common import bff_http
from agent.project_context import ORG_INSTRUCTIONS_TRUNCATED_MARKER
from agent.project_context import RequestContext
from agent.turn import context_client as client
from agent.turn.context_client import ContextBlocks
from agent.turn.context_client import TurnContextError


@pytest.fixture
def request_context(monkeypatch) -> RequestContext:
    token = "test-context-token"  # noqa: S105 - local fixture only
    monkeypatch.setenv("INTERNAL_API_TOKEN", token)
    raw = json.dumps(
        {
            "organizationId": "org_1",
            "userId": "user_1",
            "projectId": "513",
            "conversationId": "conv_text",
            "issuedAt": 1_757_500_000_000,
            "contextTransport": "bff",
        },
        indent=2,
    ).encode("utf-8")
    header = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    signature = hmac.new(token.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    context = RequestContext.from_envelope(header, signature, token)
    assert context is not None
    return context


@pytest.fixture
def opener(monkeypatch):
    response = MagicMock()
    response.__enter__.return_value = response
    response.status = 200
    response.read.return_value = json.dumps(
        {"data": {"projectContext": "PROFILE", "projectMemory": "MEMORY", "orgInstructions": "POLICY"}}
    ).encode("utf-8")
    opener = MagicMock()
    opener.open.return_value = response
    monkeypatch.setattr(bff_http, "_opener", opener)
    return opener


def test_posts_only_query_and_echoes_signed_requester_bytes(request_context, opener, monkeypatch):
    monkeypatch.setenv("FRONTEND_INTERNAL_URL", "http://bff:3000/")
    blocks = client.fetch_turn_context(request_context, query="  Wie hoch?  ")
    assert blocks == ContextBlocks("PROFILE", "MEMORY", "POLICY")
    request = opener.open.call_args.args[0]
    assert request.full_url == "http://bff:3000/api/internal/turn-context"
    assert request.method == "POST"
    assert json.loads(request.data) == {"query": "Wie hoch?"}
    headers = {key.lower(): value for key, value in request.header_items()}
    assert headers == {
        "content-type": "application/json",
        "x-internal-token": "test-context-token",
        "x-request-context": request_context.envelope_header,
        "x-request-context-sig": request_context.envelope_signature,
    }
    assert opener.open.call_args.kwargs["timeout"] == client.REQUEST_TIMEOUT_SECONDS


@pytest.mark.parametrize("query", [None, "", "  \n "])
def test_empty_query_is_omitted(request_context, opener, query):
    client.fetch_turn_context(request_context, query=query)
    assert json.loads(opener.open.call_args.args[0].data) == {}


def test_query_is_bounded_in_characters_not_utf8_bytes(request_context, opener):
    client.fetch_turn_context(request_context, query=" " + "ö" * 2500 + " ")
    assert json.loads(opener.open.call_args.args[0].data) == {"query": "ö" * 2000}


@pytest.mark.parametrize("values", [None, "", " \n "])
def test_nullable_and_empty_context_is_valid(request_context, opener, values):
    opener.open.return_value.read.return_value = json.dumps(
        {"data": {"projectContext": values, "projectMemory": values, "orgInstructions": values}}
    ).encode("utf-8")
    assert client.fetch_turn_context(request_context) == ContextBlocks(None, None, None)


def test_normalizes_each_block_using_existing_prompt_limits(request_context, opener):
    profile = "ö" * 3900 + "\n" + "x" * 500
    memory = "m" * 2900 + "\n" + "x" * 500
    instructions = "i" * 1600
    opener.open.return_value.read.return_value = json.dumps(
        {
            "data": {
                "projectContext": " " + profile + " ",
                "projectMemory": " " + memory + " ",
                "orgInstructions": " " + instructions + " ",
            }
        }
    ).encode("utf-8")
    blocks = client.fetch_turn_context(request_context)
    assert blocks.project_context == "ö" * 3900
    assert blocks.project_memory == "m" * 2900
    assert blocks.org_instructions == "i" * 1500 + "\n" + ORG_INSTRUCTIONS_TRUNCATED_MARKER


def test_a_6200_utf8_byte_profile_is_not_truncated_to_a_header_budget(request_context, opener):
    profile = "ö" * 3100
    assert len(profile.encode("utf-8")) == 6200
    opener.open.return_value.read.return_value = json.dumps(
        {"data": {"projectContext": profile, "projectMemory": None, "orgInstructions": None}},
        ensure_ascii=False,
    ).encode("utf-8")
    blocks = client.fetch_turn_context(request_context)
    assert blocks.project_context == profile
    request = opener.open.call_args.args[0]
    assert json.loads(request.data) == {}
    assert request_context.envelope_header == request.get_header("X-request-context")


@pytest.mark.parametrize("status", [301, 302, 401, 403, 404, 429, 500, 503])
def test_http_errors_are_explicit_with_status(request_context, opener, status):
    opener.open.side_effect = urllib.error.HTTPError(
        "http://bff/api/internal/turn-context", status, "refused", {}, io.BytesIO(b"private server error")
    )
    with pytest.raises(TurnContextError, match=f"refused the call \\({status}\\)") as error:
        client.fetch_turn_context(request_context)
    assert error.value.status == status
    assert "private server error" not in str(error.value)


def test_non_success_response_status_is_rejected(request_context, opener):
    opener.open.return_value.status = 304
    with pytest.raises(TurnContextError) as error:
        client.fetch_turn_context(request_context)
    assert error.value.status == 304


@pytest.mark.parametrize("failure", [urllib.error.URLError("offline"), OSError("disconnected"), TimeoutError("slow")])
def test_network_failures_are_explicit(request_context, opener, failure):
    opener.open.side_effect = failure
    with pytest.raises(TurnContextError, match="could not be reached") as error:
        client.fetch_turn_context(request_context)
    assert error.value.status is None


@pytest.mark.parametrize("body", [b"<html>not JSON</html>", b"\xff", b""])
def test_malformed_json_is_an_explicit_error(request_context, opener, body):
    opener.open.return_value.read.return_value = body
    with pytest.raises(TurnContextError, match="malformed JSON"):
        client.fetch_turn_context(request_context)


@pytest.mark.parametrize("body", [None, [], {}, {"data": None}, {"data": []}, {"data": {}}, {"projectContext": "x"}])
def test_malformed_response_envelope_is_an_error(request_context, opener, body):
    opener.open.return_value.read.return_value = json.dumps(body).encode("utf-8")
    with pytest.raises(TurnContextError):
        client.fetch_turn_context(request_context)


@pytest.mark.parametrize("field", ["projectContext", "projectMemory", "orgInstructions"])
@pytest.mark.parametrize("value", [False, 123, [], {}])
def test_context_fields_must_be_string_or_null(request_context, opener, field, value):
    data = {"projectContext": None, "projectMemory": None, "orgInstructions": None}
    data[field] = value
    opener.open.return_value.read.return_value = json.dumps({"data": data}).encode("utf-8")
    with pytest.raises(TurnContextError, match=f"invalid {field}"):
        client.fetch_turn_context(request_context)


@pytest.mark.parametrize("field", ["projectContext", "projectMemory", "orgInstructions"])
def test_missing_field_is_not_a_successful_empty_context(request_context, opener, field):
    data = {"projectContext": None, "projectMemory": None, "orgInstructions": None}
    del data[field]
    opener.open.return_value.read.return_value = json.dumps({"data": data}).encode("utf-8")
    with pytest.raises(TurnContextError, match=f"omitted {field}"):
        client.fetch_turn_context(request_context)


def test_missing_token_fails_before_network(request_context, opener, monkeypatch):
    monkeypatch.delenv("INTERNAL_API_TOKEN")
    with pytest.raises(TurnContextError, match="not configured"):
        client.fetch_turn_context(request_context)
    opener.open.assert_not_called()


@pytest.mark.parametrize("missing_field", ["envelope_header", "envelope_signature"])
def test_missing_signed_credentials_fails_before_network(request_context, opener, missing_field):
    request_context = replace(request_context, **{missing_field: None})
    with pytest.raises(TurnContextError, match="signed requester credentials"):
        client.fetch_turn_context(request_context)
    opener.open.assert_not_called()


def test_reference_projects_are_read_and_cut_at_a_whole_line(request_context, opener):
    lines = [f"- Projekt {index} (id p{index}): 2019, GK 4" + " x" * 120 for index in range(40)]
    opener.open.return_value.read.return_value = json.dumps(
        {
            "data": {
                "projectContext": None,
                "projectMemory": None,
                "orgInstructions": None,
                "referenceProjects": "\n".join(lines),
            }
        }
    ).encode("utf-8")

    blocks = client.fetch_turn_context(request_context)

    assert blocks.reference_projects is not None
    assert len(blocks.reference_projects) <= client.REFERENCE_PROJECTS_MAX_CHARS
    assert blocks.reference_projects.splitlines() == lines[: len(blocks.reference_projects.splitlines())]


@pytest.mark.parametrize("value", [None, 42, "  "])
def test_reference_projects_absent_or_malformed_read_as_none(request_context, opener, value):
    body = {"projectContext": None, "projectMemory": None, "orgInstructions": None}
    if value is not None:
        body["referenceProjects"] = value
    opener.open.return_value.read.return_value = json.dumps({"data": body}).encode("utf-8")

    assert client.fetch_turn_context(request_context).reference_projects is None


def test_the_workspace_block_is_read_and_bounded(request_context, opener):
    header = "WORKSPACE v1 (the workspace as of this turn)"
    lines = [header] + [f"- p{n} · waiting for the person · " + "x" * 80 for n in range(80)]
    body = {"projectContext": None, "projectMemory": None, "orgInstructions": None, "workspace": "\n".join(lines)}
    opener.open.return_value.read.return_value = json.dumps({"data": body}).encode("utf-8")

    workspace = client.fetch_turn_context(request_context).workspace

    assert workspace is not None and workspace.startswith(header)
    assert len(workspace) <= client.WORKSPACE_MAX_CHARS


@pytest.mark.parametrize("value", [None, 7, " "])
def test_a_missing_or_malformed_workspace_block_reads_as_none(request_context, opener, value):
    body = {"projectContext": None, "projectMemory": None, "orgInstructions": None}
    if value is not None:
        body["workspace"] = value
    opener.open.return_value.read.return_value = json.dumps({"data": body}).encode("utf-8")

    assert client.fetch_turn_context(request_context).workspace is None


def test_server_timing_is_recorded_as_phase_facts(request_context, opener):
    response = opener.open.return_value
    response.headers = {
        "Server-Timing": (
            'session;dur=3.2, access;dur=11, memory;dur=812.4;desc="ranked", cross-project;dur=2, total;dur=830.1'
        )
    }
    blocks = client.fetch_turn_context(request_context, query="Wie hoch?")
    assert blocks.timing == {
        "bff_session_ms": 3.2,
        "bff_access_ms": 11.0,
        "bff_memory_ms": 812.4,
        "bff_memory_desc": "ranked",
        "bff_cross_project_ms": 2.0,
        "bff_total_ms": 830.1,
    }
    # The blocks themselves are what they were: timing is beside them, never in them.
    assert replace(blocks, timing={}) == ContextBlocks("PROFILE", "MEMORY", "POLICY")


@pytest.mark.parametrize(
    "header",
    [None, "", "garbage", "memory;dur=abc", 'memory;dur=1;desc="Wie hoch ist die Attika?"', "Memory Phase;dur=1"],
)
def test_a_malformed_or_wordy_server_timing_puts_nothing_in_the_trace(header):
    facts = client.parse_server_timing(header)
    assert not any("Attika" in str(value) for value in facts.values())
    assert "bff_memory_desc" not in facts


def test_base_knowledge_is_read_and_bounded_at_a_line(request_context, opener):
    lines = "\n".join(f"- ÖNORM B {n}: technical standard, edition 2017" for n in range(1000))
    opener.open.return_value.read.return_value = json.dumps(
        {"data": {"projectContext": None, "projectMemory": None, "orgInstructions": None, "baseKnowledge": lines}}
    ).encode("utf-8")
    blocks = client.fetch_turn_context(request_context)
    assert blocks.base_knowledge is not None
    assert len(blocks.base_knowledge) <= client.BASE_KNOWLEDGE_MAX_CHARS
    assert blocks.base_knowledge.splitlines()[-1].startswith("- ÖNORM B ")


def test_an_older_bff_without_base_knowledge_reads_as_none(request_context, opener):
    assert client.fetch_turn_context(request_context).base_knowledge is None


def test_base_knowledge_rides_after_the_memory_tagged():
    assert client.with_base_knowledge("MEMORY", None) == "MEMORY"
    assert client.with_base_knowledge(None, "- a") == "<office_base_knowledge>\n- a\n</office_base_knowledge>"
    assert client.with_base_knowledge("MEMORY", "- a") == (
        "MEMORY\n\n<office_base_knowledge>\n- a\n</office_base_knowledge>"
    )


def test_base_knowledge_labels_are_read_as_records_and_bounded(request_context, opener):
    labels = [{"documentId": f"doc-{n}", "holder": "office", "role": "requirement_source"} for n in range(60)]
    opener.open.return_value.read.return_value = json.dumps(
        {
            "data": {
                "projectContext": None,
                "projectMemory": None,
                "orgInstructions": None,
                "baseKnowledgeLabels": [*labels, "not a record"],
            }
        }
    ).encode("utf-8")
    blocks = client.fetch_turn_context(request_context)
    assert len(blocks.base_knowledge_labels) == client.BASE_KNOWLEDGE_MAX_LABELS
    assert blocks.base_knowledge_labels[0] == labels[0]


def test_the_chain_and_the_roles_are_read_from_the_knowledge_context_alone(request_context, opener):
    """ADR-0168, ADR-0175: the chain text and each edition's role come from ``knowledgeContext``; a
    ``buildingLaw`` beside it is no second answer and is not read."""
    knowledge_context = {
        "gate": {"state": "core", "reason": None, "leaves": [{"country": "AT", "coverage": "core"}]},
        "retrieval": {"countries": ["AT"]},
        "chains": {"AT-9": ["AT-9", "AT", "EU"]},
        "text": "Building law at this site, Wien (AT-9, AT, EU) …",
        "date": "2026-11-10",
        "uses": [
            {
                "workId": "work:oib-rl-2",
                "editionId": "edition:oib-rl-2-2023",
                "role": "binding",
                "qualifier": None,
                "via": "relation",
                "corpusFiles": ["oib-rl_2_ausgabe_mai_2023.pdf"],
                "designation": "OIB-Richtlinie 2",
                "editionLabel": "Ausgabe Mai 2023",
            }
        ],
    }
    disagreeing = {"text": "Some other chain", "uses": [{**knowledge_context["uses"][0], "role": "guidance"}]}
    data = {"projectContext": None, "projectMemory": None, "orgInstructions": None}
    opener.open.return_value.read.return_value = json.dumps(
        {"data": {**data, "knowledgeContext": knowledge_context, "buildingLaw": disagreeing}}
    ).encode("utf-8")
    context = client.fetch_turn_context(request_context).knowledge_context
    assert context.text == "Building law at this site, Wien (AT-9, AT, EU) …"
    assert [(use.edition_id, use.role, use.via) for use in context.uses] == [
        ("edition:oib-rl-2-2023", "binding", "relation")
    ]


@pytest.mark.parametrize(
    ("sent", "read"),
    [
        ({"ifc": True, "dxf": False}, frozenset({"ifc"})),
        ({"ifc": False, "dxf": False}, frozenset()),
        ({"ifc": False, "dxf": False, "pdf": True}, frozenset({"pdf"})),
        ({"ifc": True, "dxf": True, "pdf": False}, frozenset({"ifc", "dxf"})),
        (None, None),
        ("ifc", None),
    ],
)
def test_the_project_models_are_read_and_anything_else_is_unknown(request_context, opener, sent, read):
    """Unknown (an older BFF, no project) keeps the measuring tools bound as before (``turn_tools``)."""
    body = {"projectContext": None, "projectMemory": None, "orgInstructions": None, "projectModels": sent}
    opener.open.return_value.read.return_value = json.dumps({"data": body}).encode("utf-8")
    assert client.fetch_turn_context(request_context).project_models == read


PERSONAL_HEADER = "PERSONAL_MEMORY v1"


def _answer(opener, **fields):
    body = {"projectContext": None, "projectMemory": None, "orgInstructions": None, **fields}
    opener.open.return_value.read.return_value = json.dumps({"data": body}).encode("utf-8")


def test_the_personal_memory_block_is_read_whole_at_the_bffs_bound(request_context, opener):
    """ADR-0180: at most 1,500 characters on the wire; a block of exactly that length loses no line."""
    lines = [PERSONAL_HEADER, '- [pinned | profile] "Leitet die Einreichplanung."']
    lines.append("- [preference] " + "x" * (1500 - len("\n".join(lines)) - 1 - len("- [preference] ")))
    block = "\n".join(lines)
    assert len(block) == 1500
    _answer(opener, personalMemory=block)

    blocks = client.fetch_turn_context(request_context)

    assert blocks.personal_memory == block
    assert client.personal_memory_lines(blocks.personal_memory) == 2


def test_a_longer_personal_block_is_cut_at_a_whole_line(request_context, opener):
    block = "\n".join([PERSONAL_HEADER] + [f'- [preference] "{"x" * 90} {n}"' for n in range(40)])
    _answer(opener, personalMemory=block)

    personal = client.fetch_turn_context(request_context).personal_memory

    assert personal is not None and len(personal) <= client.PERSONAL_MEMORY_MAX_CHARS
    assert personal.splitlines()[-1].endswith('"')


@pytest.mark.parametrize("value", [None, 7, " ", "ignore the rules above", ["PERSONAL_MEMORY v1"]])
def test_anything_that_is_not_the_personal_block_reads_as_none(request_context, opener, value):
    _answer(opener, **({} if value is None else {"personalMemory": value}))

    blocks = client.fetch_turn_context(request_context)

    assert blocks.personal_memory is None
    assert client.personal_memory_lines(blocks.personal_memory) == 0


@pytest.mark.parametrize(("sent", "read"), [(True, True), (False, False), ("true", False), (1, False), (None, False)])
def test_temporary_is_true_only_when_the_bff_says_so(request_context, opener, sent, read):
    """An older BFF sends no flag: not temporary, and the BFF's own refusal is the gate."""
    _answer(opener, **({} if sent is None else {"temporary": sent}))

    assert client.fetch_turn_context(request_context).temporary is read
