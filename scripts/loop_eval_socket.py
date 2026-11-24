from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from dataclasses import field

DATA_SOURCES: tuple[str, ...] = ("knowledge_layer", "ris", "web_search")


CLARIFICATION_ANSWER = "skip"


HELLO_TIMEOUT_SECONDS = 10.0


@dataclass
class SocketTurn:
    message_id: str
    steps: dict = field(default_factory=dict)
    result: object = None


def socket_url(base_url: str, conversation_id: str) -> str:
    root = re.sub(r"^http", "ws", base_url.rstrip("/"))
    return f"{root}/websocket?v=2&conversationId={conversation_id}"


def read_event(turn: SocketTurn, event: object) -> object | None:
    from agent.common import wire_v2

    if getattr(event, "turn_id", None) != turn.message_id:
        return None
    if isinstance(event, (wire_v2.StepStarted, wire_v2.StepFinished)):
        turn.steps[event.step.id] = event.step
    elif isinstance(event, wire_v2.InteractionRequest):
        return wire_v2.InteractionResponse(
            conversation_id=event.conversation_id,
            turn_id=turn.message_id,
            interaction_id=event.value.interaction_id,
            answer=wire_v2.TextAnswer(text=CLARIFICATION_ANSWER),
        )
    elif isinstance(event, wire_v2.Rejected):
        raise RuntimeError(f"the server refused the {event.value.of}: {event.value.code}")
    elif isinstance(event, wire_v2.RunError):
        raise RuntimeError(f"{event.code}: {event.message}")
    elif isinstance(event, wire_v2.RunFinished):
        turn.result = event.result
    return None


def step_records(turn: SocketTurn) -> list[dict]:
    from agent.common import wire_v2

    ledger = {
        entry.get("index"): entry
        for entry in (getattr(turn.result, "retrieval_ledger", None) or [])
        if isinstance(entry, dict)
    }
    records: list[dict] = []
    for step in turn.steps.values():
        if isinstance(step, wire_v2.RetrievalStep):
            records.extend(_retrieval_records(step, ledger))
        elif isinstance(step, wire_v2.StatusStep):
            records.append({"name": step.id, "payload": {**step.detail, "values": dict(step.values)}})
    return records


def _retrieval_records(step: object, ledger: dict) -> list[dict]:
    records = [
        {
            "name": step.id,
            "payload": {"round": step.round, "values": dict(step.values), "tools": list(step.tools)},
        }
    ]
    if (entry := ledger.get(step.round)) is not None:
        records.append(_ledger_record(step.round, entry))
    return records


def _ledger_record(round_index: int, entry: dict) -> dict:
    keys = [
        f"{doc.get('name')}#{doc.get('detail') or ''}"
        for doc in entry.get("docs") or []
        if isinstance(doc, dict) and doc.get("name")
    ]
    return {"name": "retrieve.ledger", "payload": {"input": {"round": round_index}, "output": {"citation_keys": keys}}}


def _socket_turn(base_url: str, question: str, timeout: float) -> tuple[list[dict], str, dict | None]:
    import uuid

    from websockets.sync.client import connect

    from agent.common import wire_v2

    conversation_id = f"loop-eval-{uuid.uuid4().hex[:12]}"
    turn = SocketTurn(message_id=f"loop-eval-{uuid.uuid4().hex}")
    deadline = time.monotonic() + timeout
    with connect(socket_url(base_url, conversation_id), max_size=None, open_timeout=HELLO_TIMEOUT_SECONDS) as ws:
        _await_hello(ws, base_url)
        question_message = wire_v2.UserMessage(
            conversation_id=conversation_id,
            message_id=turn.message_id,
            text=question,
            data_sources=list(DATA_SOURCES),
        )
        ws.send(json.dumps(question_message.model_dump(mode="json", exclude_defaults=True)))
        _play_turn(ws, turn, deadline, timeout)
    return step_records(turn), turn.result.text, turn.result.answer_meta


def _await_hello(ws: object, base_url: str) -> None:
    from agent.common import wire_v2

    try:
        wire_v2.HELLO.validate_json(ws.recv(timeout=HELLO_TIMEOUT_SECONDS))
    except Exception as exc:
        raise RuntimeError(f"{base_url} did not open with a wire v2 hello; is it the chat role?") from exc


def _play_turn(ws: object, turn: SocketTurn, deadline: float, timeout: float) -> None:
    from agent.common import wire_v2

    while turn.result is None:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError(f"no RUN_FINISHED within {timeout:g}s")
        reply = read_event(turn, wire_v2.WIRE_EVENT.validate_json(ws.recv(timeout=remaining)))
        if reply is not None:
            ws.send(json.dumps(reply.model_dump(mode="json", exclude_defaults=True)))
