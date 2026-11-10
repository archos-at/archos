"""The licensed seam, end to end through a real LangChain chat model on a mock wire (``common/licensed_text.py``).

A licensed passage is planted with a shingle no other text holds. The tests follow it
from the grounding block a tool renders, through the chat-request contract, to the
wire and back, and fail if any recorder other than the wire saw more of it than the
quote cap allows: LangChain's callbacks (which is what Langfuse and the agent runtime's
spans are built from), the messages a checkpoint would store, the citation registry,
the direct-trace payloads and the log. Every leak assertion has its positive control:
the same passage UNMARKED must be seen by the same recorder, or the recorder is blind
and the assertion proves nothing.
"""

from __future__ import annotations

import json
import logging

import httpx
import pytest
from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.load import dumpd
from langchain_core.messages import AIMessage
from langchain_core.messages import HumanMessage
from langchain_core.messages import SystemMessage
from langchain_core.messages import ToolMessage

from agent.common import licensed_text
from agent.common.grounding_block import GroundingBlock
from agent.common.grounding_block import GroundingHit
from agent.common.grounding_block import begin_grounding_capture
from agent.common.grounding_block import end_grounding_capture
from agent.common.grounding_block import render_grounding_block
from agent.common.licensed_reply import ChunkCap
from agent.common.licensed_text import DEFAULT_QUOTE_MAX_CHARS
from agent.common.licensed_text import LicenceTerms
from agent.common.licensed_text import QuoteCap
from agent.common.licensed_text import licence_from_metadata
from agent.common.licensed_text import licensed_ingest
from agent.common.licensed_text import trace_payload
from agent.common.llm_factory import enforce_chat_request_contract

CAP = 120

#: A norm-like passage with a table; every row is distinct so any 24-character window is unique to it.
LICENSED = "\n".join(
    [
        "4.3 Brüstungen und Geländer. Die Höhe von Absturzsicherungen ist von der Standfläche zu messen.",
        "Tabelle 7 – Mindesthöhen von Absturzsicherungen nach Absturzhöhe:",
        *(
            f"| Zeile {row:02d} | Absturzhöhe bis {row * 3 + 2},{row % 10} m | Mindesthöhe {90 + row * 3} cm "
            f"| Öffnungsweite höchstens {11 + row % 4} cm | Anmerkung {chr(65 + row)}{row * 7} |"
            for row in range(1, 25)
        ),
        "4.4 Handläufe sind beidseitig anzuordnen, wenn die Laufbreite 1,20 m überschreitet.",
    ]
)
#: The planted shingle: deep inside the passage, far past any quote cap.
SHINGLE = LICENSED[1500:1560]

TERMS = LicenceTerms(licence_class="licensed", quote_max_chars=CAP, ai_processing=True)
#: The office's own copy, marked licensed, its licence NOT attested for AI processing: no model may read it.
UNATTESTED = LicenceTerms(licence_class="licensed", quote_max_chars=CAP)


def _hit(*, licence: LicenceTerms | None = TERMS) -> GroundingHit:
    return GroundingHit(
        citation_key="oenorm_b_1600.pdf, p.12",
        file_name="oenorm_b_1600.pdf",
        page=12,
        shelf="office_shelf",
        collection="office-org-a",
        doc_class=None,
        display_title="ÖNORM B 1600",
        folder_path=None,
        clause="4.3",
        score=0.91,
        content_type="text",
        provenance=None,
        stored_image_index=None,
        status_note=None,
        body=LICENSED,
        licence=licence,
    )


def _block(hit: GroundingHit) -> str:
    return render_grounding_block(
        GroundingBlock(preamble="Found 1 result.", degraded_banner="", hits=(hit,), lanes=(), tool="knowledge_search")
    )


def _norm(text: str) -> str:
    return " ".join(text.split()).lower()


def longest_licensed_run(text: str, licensed: str = LICENSED) -> int:
    """The longest stretch of ``text`` that is also in ``licensed`` (whitespace and case normalised)."""
    a, b = _norm(text), _norm(licensed)
    best = 0
    previous = [0] * (len(b) + 1)
    for i in range(1, len(a) + 1):
        current = [0] * (len(b) + 1)
        for j in range(1, len(b) + 1):
            if a[i - 1] == b[j - 1]:
                current[j] = previous[j - 1] + 1
                best = max(best, current[j])
        previous = current
    return best


# ---------------------------------------------------------------------------
# The wire: a mock OpenRouter that records what it was sent and quotes it back
# ---------------------------------------------------------------------------


class Wire:
    """Records each request body; answers by quoting 900 characters of the licensed text, when it was sent any."""

    def __init__(self) -> None:
        self.bodies: list[str] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        body = request.content.decode("utf-8")
        self.bodies.append(body)
        quote = LICENSED[300:1200] if LICENSED[300:340] in _all_text(body) else "nichts"
        if json.loads(body).get("stream"):
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=_sse(quote))
        return httpx.Response(200, json=_completion(quote))


def _all_text(body: str) -> str:
    """Every message's text in a request body, decoded from JSON."""
    payload = json.loads(body)
    return "\n".join(str(message.get("content")) for message in payload.get("messages", []))


def _delta(delta: dict) -> str:
    chunk = {
        "id": "gen-1",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "test/model",
        "choices": [{"index": 0, "delta": delta, "finish_reason": None}],
    }
    return f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"


def _sse(quote: str) -> bytes:
    events = [_delta({"role": "assistant", "content": ""})]
    answer = f"Laut Norm: „{quote}“ [1]"
    events += [_delta({"content": answer[i : i + 17]}) for i in range(0, len(answer), 17)]
    arguments = json.dumps({"note": quote}, ensure_ascii=False)
    events.append(
        _delta(
            {
                "tool_calls": [
                    {"index": 0, "id": "call_1", "type": "function", "function": {"name": "note", "arguments": ""}}
                ]
            }
        )
    )
    events += [
        _delta({"tool_calls": [{"index": 0, "function": {"arguments": arguments[i : i + 13]}}]})
        for i in range(0, len(arguments), 13)
    ]
    events.append("data: [DONE]\n\n")
    return "".join(events).encode("utf-8")


def _completion(quote: str) -> dict:
    return {
        "id": "gen-1",
        "object": "chat.completion",
        "created": 0,
        "model": "test/model",
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {
                    "role": "assistant",
                    "content": f"Laut Norm: „{quote}“ [1]",
                    "tool_calls": [
                        {
                            "id": "call_1",
                            "type": "function",
                            "function": {"name": "note", "arguments": json.dumps({"note": quote}, ensure_ascii=False)},
                        }
                    ],
                },
            }
        ],
        "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
    }


def _strings(value) -> list[str]:
    """Every string leaf of a serialised LangChain object, decoded: what a trace exporter writes out."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [text for item in value.values() for text in _strings(item)]
    if isinstance(value, list | tuple):
        return [text for item in value for text in _strings(item)]
    return []


def _serialised(value) -> str:
    return "\n".join(_strings(dumpd(value)))


class Recorder(AsyncCallbackHandler):
    """Everything a callback handler (Langfuse's, the agent runtime's) is told about the call."""

    def __init__(self) -> None:
        self.seen: list[str] = []

    async def on_chat_model_start(self, serialized, messages, **kwargs):
        self.seen.append(_serialised(messages))

    async def on_llm_new_token(self, token, **kwargs):
        chunk = kwargs.get("chunk")
        self.seen.append(token + ("\n" + _serialised(chunk) if chunk is not None else ""))

    async def on_llm_end(self, response, **kwargs):
        self.seen.append(_serialised(response.generations))

    @property
    def text(self) -> str:
        return "\n".join(self.seen)


def _model(wire: Wire, *, streaming: bool):
    from langchain_openai import ChatOpenAI

    llm = ChatOpenAI(
        model="test/model",
        api_key="test-key",  # pragma: allowlist secret
        base_url="https://openrouter.ai/api/v1",
        streaming=streaming,
        http_async_client=httpx.AsyncClient(transport=httpx.MockTransport(wire.handle)),
        max_retries=0,
    )
    return enforce_chat_request_contract(llm)


def _turn_messages(block: str) -> list:
    return [
        SystemMessage(content="Du bist eine Kollegin im Planungsbüro."),
        HumanMessage(content="Welche Mindesthöhe gilt bei 20 m Absturzhöhe?"),
        AIMessage(content="", tool_calls=[{"name": "knowledge_search", "args": {"query": "Brüstung"}, "id": "t1"}]),
        ToolMessage(content=block, tool_call_id="t1"),
    ]


async def _turn(*, licence: LicenceTerms | None, allowed: bool = True, streaming: bool = True):
    """One turn: render the hit, call the model, return the wire, the recorder, the messages and the reply."""
    wire, recorder = Wire(), Recorder()
    token = begin_grounding_capture(licensed_text=allowed)
    try:
        messages = _turn_messages(_block(_hit(licence=licence)))
        reply = await _model(wire, streaming=streaming).ainvoke(messages, config={"callbacks": [recorder]})
    finally:
        end_grounding_capture(token)
    return wire, recorder, messages, reply


# ---------------------------------------------------------------------------
# The seam
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("streaming", [True, False])
async def test_licensed_text_reaches_only_the_wire_and_every_reply_is_capped(streaming, caplog):
    caplog.set_level(logging.DEBUG)
    wire, recorder, messages, reply = await _turn(licence=TERMS, streaming=streaming)

    assert SHINGLE in _all_text(wire.bodies[0]), "the provider must read the passage inside the call"
    assert SHINGLE not in recorder.text, "a callback (Langfuse, the runtime's spans) saw the licensed text"
    assert SHINGLE not in _serialised(messages), "the checkpointed messages hold the text"
    assert SHINGLE not in caplog.text
    assert longest_licensed_run(recorder.text) <= CAP
    assert longest_licensed_run(str(reply.content)) <= CAP
    assert licensed_text.CAP_MARKER in reply.content
    (call,) = reply.tool_calls
    assert longest_licensed_run(call["args"]["note"]) <= CAP, "a tool call's arguments carry the quote uncapped"
    assert not reply.invalid_tool_calls, "capping broke the arguments' JSON"


async def test_positive_control_an_unmarked_passage_is_seen_by_the_same_recorders():
    wire, recorder, messages, reply = await _turn(licence=None)

    assert SHINGLE in recorder.text
    assert SHINGLE in _serialised(messages)
    assert longest_licensed_run(str(reply.content)) > CAP


async def test_ordering_the_trace_logs_the_reference_and_only_the_request_holds_the_text():
    wire, recorder, messages, _ = await _turn(licence=TERMS)

    started = recorder.seen[0]
    assert "⟦licensed:lp_" in started, "the callback must be told the reference, before expansion"
    assert "⟦licensed:" not in _all_text(wire.bodies[0]), "the reference must be expanded before the request leaves"
    assert "Licence: licensed" in _all_text(wire.bodies[0])


async def test_with_the_flag_off_the_passage_is_listed_and_no_text_is_sent():
    wire, recorder, _, _ = await _turn(licence=TERMS, allowed=False)

    sent = _all_text(wire.bodies[0])
    assert longest_licensed_run(sent) < licensed_text.SHINGLE_CHARS
    assert licensed_text.WITHHELD_NOTE in sent
    assert "Page: 12" in sent and "Punkt: 4.3" in sent


async def test_a_reference_from_an_earlier_turn_is_not_expanded():
    token = begin_grounding_capture(licensed_text=True)
    try:
        block = _block(_hit())
    finally:
        end_grounding_capture(token)
    wire, recorder = Wire(), Recorder()
    later = begin_grounding_capture(licensed_text=True)
    try:
        await _model(wire, streaming=False).ainvoke(_turn_messages(block), config={"callbacks": [recorder]})
    finally:
        end_grounding_capture(later)

    sent = _all_text(wire.bodies[0])
    assert licensed_text.EXPIRED_NOTE in sent
    assert longest_licensed_run(sent) < licensed_text.SHINGLE_CHARS


async def test_a_call_without_licensed_text_sends_and_reports_exactly_what_it_did_before():
    wire, recorder = Wire(), Recorder()
    messages = [SystemMessage(content="Du bist eine Kollegin im Planungsbüro."), HumanMessage(content="Hallo")]
    reply = await _model(wire, streaming=True).ainvoke(messages, config={"callbacks": [recorder]})

    assert reply.content == "Laut Norm: „nichts“ [1]"
    assert any(seen.startswith("Laut") for seen in recorder.seen), "tokens are reported by LangChain itself"


# ---------------------------------------------------------------------------
# The pieces
# ---------------------------------------------------------------------------


def test_the_cap_lets_a_short_quote_through_and_cuts_a_long_one():
    cap = QuoteCap([(LICENSED, CAP)])
    short = LICENSED[400:480]
    assert cap.cap_text(f"Zitat: {short}.") == f"Zitat: {short}."
    capped = cap.cap_text(f"Zitat: {LICENSED[400:1000]}.")
    assert longest_licensed_run(capped) <= CAP
    assert capped.endswith(f"{licensed_text.CAP_MARKER}.")
    assert cap.capped_runs == 1


def test_the_cap_matches_across_chunks_and_whitespace_changes():
    cap = ChunkCap(QuoteCap([(LICENSED, CAP)]))
    quote = " ".join(LICENSED[200:900].split())  # the model reflowed the lines
    out = "".join(cap._feed("content", quote[i : i + 5]) for i in range(0, len(quote), 5))
    assert longest_licensed_run(out) <= CAP


def test_json_escapes_are_never_cut():
    text = json.dumps({"q": LICENSED[100:900]}, ensure_ascii=False)
    capped = QuoteCap([(LICENSED, CAP)]).cap_text(text, json_raw=True)
    assert longest_licensed_run(json.loads(capped)["q"]) <= CAP


def test_reasoning_and_raw_tool_deltas_in_additional_kwargs_are_capped():
    message = AIMessage(
        content="",
        additional_kwargs={
            "reasoning_content": LICENSED[0:800],
            "tool_calls": [{"index": 0, "function": {"arguments": json.dumps({"x": LICENSED[0:800]})}}],
        },
    )
    capped = ChunkCap(QuoteCap([(LICENSED, CAP)])).message(message)
    assert longest_licensed_run(capped.additional_kwargs["reasoning_content"]) <= CAP
    raw = capped.additional_kwargs["tool_calls"][0]["function"]["arguments"]
    assert longest_licensed_run(json.loads(raw)["x"]) <= CAP


def test_the_mark_fails_closed():
    assert licence_from_metadata({}) is None
    assert licence_from_metadata({"licence_class": "public_open"}).licensed is False
    assert licence_from_metadata({"licence_class": "licensed"}).quote_max_chars == DEFAULT_QUOTE_MAX_CHARS
    assert licence_from_metadata({"licence_class": "some-future-class"}).licensed is True
    assert licence_from_metadata({"licence_class": "licensed", "quote_max_chars": "300"}).quote_max_chars == 300
    assert licence_from_metadata({"licence_class": "licensed", "quote_max_chars": -1}).quote_max_chars == 500


def test_an_unmarked_hit_renders_byte_for_byte_as_before():
    token = begin_grounding_capture(licensed_text=True)
    try:
        public = _block(_hit(licence=LicenceTerms(licence_class="public_open")))
        unmarked = _block(_hit(licence=None))
    finally:
        end_grounding_capture(token)
    assert public == unmarked
    assert "Licence:" not in unmarked


def test_a_direct_trace_records_the_turns_licensed_text_capped():
    token = begin_grounding_capture(licensed_text=True)
    try:
        _block(_hit())
        payload = trace_payload(json.dumps([{"role": "user", "content": LICENSED}], ensure_ascii=False))
    finally:
        end_grounding_capture(token)
    assert SHINGLE not in payload
    assert longest_licensed_run(json.loads(payload)[0]["content"]) <= CAP


def test_a_licensed_ingest_traces_metadata_only_and_the_public_control_its_text():
    with licensed_ingest(TERMS):
        redacted = trace_payload(LICENSED)
    assert SHINGLE not in redacted
    assert json.loads(redacted)["chars"] == len(LICENSED)
    with licensed_ingest(None):
        assert trace_payload(LICENSED) == LICENSED


def test_the_vision_generation_of_a_licensed_page_records_no_text(monkeypatch):
    """``vision_calls._observed_vlm_call`` inside a licensed ingest: the model is kept, the text is not."""
    from agent.observability import direct_trace

    starts = direct_trace.generation_start_attributes("ingest-vision", model="m", messages=[{"content": LICENSED}])
    traced = json.loads(starts[direct_trace.INPUT_ATTRIBUTE])[0]["content"]
    assert SHINGLE in traced, "positive control: outside the scope the text is traced"
    with licensed_ingest(TERMS):
        starts = direct_trace.generation_start_attributes("ingest-vision", model="m", messages=[{"content": LICENSED}])
        result = direct_trace.generation_result_attributes(
            {"choices": [{"message": {"content": LICENSED}}], "model": "m"}
        )
    traced = " ".join(str(value) for value in {**starts, **result}.values())
    assert longest_licensed_run(traced) < licensed_text.SHINGLE_CHARS
    assert starts[direct_trace.GEN_AI_REQUEST_MODEL] == "m"


def test_the_citation_registry_keeps_only_a_quote_of_a_licensed_hit():
    from agent.citations.extraction import _entry_from_hit_fields

    assert len(_entry_from_hit_fields(_hit(), "knowledge_search").chunk_text) == CAP
    assert _entry_from_hit_fields(_hit(licence=None), "knowledge_search").chunk_text == LICENSED.strip()


# ---------------------------------------------------------------------------
# A licence not attested for AI processing: usable by no model call
# ---------------------------------------------------------------------------


async def test_an_unattested_licensed_passage_reaches_no_model_even_with_the_flag_on():
    wire, recorder, messages, _ = await _turn(licence=UNATTESTED, allowed=True)

    sent = _all_text(wire.bodies[0])
    assert longest_licensed_run(sent) < licensed_text.SHINGLE_CHARS
    assert licensed_text.UNATTESTED_NOTE in sent
    assert "Page: 12" in sent and "Punkt: 4.3" in sent, "the reference to the place stays"
    assert longest_licensed_run(recorder.text) < licensed_text.SHINGLE_CHARS


def test_an_unattested_licensed_passage_is_not_quoted_in_the_registry():
    from agent.citations.extraction import _entry_from_hit_fields

    assert _entry_from_hit_fields(_hit(licence=UNATTESTED), "knowledge_search").chunk_text is None


def test_the_attestation_counts_only_when_it_is_true():
    assert licence_from_metadata({"licence_class": "licensed"}).ai_processing is False
    assert licence_from_metadata({"licence_class": "licensed", "ai_processing_attested": "true"}).ai_processing is False
    assert licence_from_metadata({"licence_class": "licensed", "ai_processing_attested": True}).model_readable
    assert licence_from_metadata({"licence_class": "public_open"}).model_readable


def _openrouter_call() -> httpx.Response:
    from agent.common.openrouter import PLATFORM_FIXED
    from agent.common.openrouter import _PinningTransport

    transport = _PinningTransport(PLATFORM_FIXED, inner=httpx.MockTransport(lambda request: httpx.Response(200)))
    with httpx.Client(transport=transport) as client:
        return client.post("https://openrouter.ai/api/v1/embeddings", json={"model": "m", "input": LICENSED})


def test_the_ingest_of_an_unattested_licensed_document_calls_no_model():
    with licensed_ingest(UNATTESTED), pytest.raises(licensed_text.UnattestedLicensedText):
        _openrouter_call()
    with licensed_ingest(TERMS):
        assert _openrouter_call().status_code == 200, "an attested copy is read, and traced as metadata only"
    assert _openrouter_call().status_code == 200, "positive control: outside the scope nothing is refused"
