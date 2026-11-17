#!/usr/bin/env python3

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
from collections.abc import Iterable
from collections.abc import Sequence
from dataclasses import asdict
from dataclasses import dataclass
from dataclasses import field
from dataclasses import fields as dataclass_fields
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_QUESTIONS = REPO_ROOT / "tests" / "fixtures" / "derivation" / "loop_eval_questions.yaml"

BASE_URL_ENV = "LOOP_EVAL_URL"

DEFAULT_TIMEOUT_SECONDS = 240.0

_CLAUSE_NUMBER_RE = re.compile(r"\b(?:Pkt\.?|Punkt)\s*(\d+(?:\.\d+)*)")

_ROUND_STEP_RE = re.compile(r"^status:retrieval:(\d+)$")
_CHECKPOINT_STEP_RE = re.compile(r"^status:checkpoint:(\d+)$")
_COVERAGE_STEP_RE = re.compile(r"^status:coverage:(.+)$")
_BUDGET_STEP = "status:budget"


@dataclass(frozen=True)
class Question:
    id: str
    question: str
    family: str | None
    clause: str | None
    kind: str
    paragraph: str | None = None


@dataclass
class Observation:
    id: str = ""
    expected_family: str = ""
    expected_clause: str = ""
    expected_kind: str = ""
    kind: str = ""
    verdict: str = ""
    rounds: str = ""
    read_passage: str = ""
    clause_match: str = ""
    truncated: str = ""
    checkpoint_sources: str = ""
    family_coverage: str = ""
    repeat_query: str = ""
    locator_eligible: str = ""
    cap_retry: str = ""
    repair_fetch: str = ""
    cross_turn: str = ""
    family_overlap: str = ""
    ris_calls: str = ""
    paragraph_match: str = ""
    ris_citation_resolved: str = ""
    error: str = ""


FIELDS: tuple[str, ...] = tuple(f.name for f in dataclass_fields(Observation))

_DOUBLE_FETCH_FIELDS: tuple[str, ...] = (
    "repeat_query",
    "locator_eligible",
    "cap_retry",
    "repair_fetch",
    "cross_turn",
    "family_overlap",
)

_RIS_FIELDS: tuple[str, ...] = ("ris_calls", "paragraph_match", "ris_citation_resolved")

_BOOLEAN_FIELDS = ("verdict", "read_passage", "truncated", *_DOUBLE_FETCH_FIELDS, "ris_citation_resolved")


def _yes_no(value: bool) -> str:
    return "yes" if value else "no"


def _question_clause(row: dict) -> str | None:
    value = row.get("clause", row.get("punkt"))
    return None if value is None else str(value)


def load_questions(path: Path) -> list[Question]:
    import yaml

    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    rows = raw.get("questions") or []
    return [
        Question(
            id=str(row["id"]),
            question=str(row["question"]).strip(),
            family=row.get("family"),
            clause=_question_clause(row),
            kind=str(row["kind"]),
            paragraph=None if row.get("paragraph") is None else str(row["paragraph"]),
        )
        for row in rows
    ]


def _status_payloads(steps: Iterable[dict]) -> list[tuple[str, dict]]:
    out: list[tuple[str, dict]] = []
    for step in steps:
        name = str(step.get("name") or step.get("functionName") or "")
        body = step.get("payload")
        if isinstance(body, str):
            try:
                body = json.loads(body)
            except json.JSONDecodeError:
                continue
        if name and isinstance(body, dict):
            out.append((name, body))
    return out


def cited_clauses(answer: str) -> list[str]:
    return [match.group(1) for match in _CLAUSE_NUMBER_RE.finditer(answer or "")]


def clause_matches(expected: str | None, cited: Sequence[str]) -> str:
    if not expected:
        return ""
    for number in cited:
        if number == expected or number.startswith(f"{expected}."):
            return "yes"
    return "no"


def _normalise_query(text: object) -> str:
    try:
        return re.sub(r"\s+", " ", str(text or "")).strip().casefold()
    except Exception:
        return ""


_LOCATOR_ELIGIBLE_RE = re.compile(
    r"oib[-\s_]*rl|richtlinie\s*\d|\brl\s*\d|\bpkt\.?\b|\bpunkt\b|§|\bseite\b|\bpage\b|\btabelle\b|\.pdf\b|oib-rl_|oib-richtlinie_",
    re.IGNORECASE,
)

_CAP_STEP_NAMES = frozenset({"status:budget", "status:budget:input"})

_WIDTH_CAP_STEP_PREFIX = "status:width:"

_REPAIR_STEP_NAME = "status:repair"


def _retrieval_queries(payloads: Sequence[tuple[str, dict]]) -> list[str]:
    queries: list[str] = []
    for name, body in payloads:
        if _ROUND_STEP_RE.match(name):
            values = body.get("values") or {}
            query = values.get("query") or body.get("query")
            normalised = _normalise_query(query)
            if normalised:
                queries.append(normalised)
            continue
        if name.startswith("retrieve."):
            raw = body.get("input") or body.get("output") or body
            if isinstance(raw, str):
                try:
                    raw = json.loads(raw)
                except json.JSONDecodeError:
                    raw = {}
            if isinstance(raw, dict):
                for key in ("normalized_query", "query", "retrieval_query"):
                    normalised = _normalise_query(raw.get(key))
                    if normalised:
                        queries.append(normalised)
                        break
    return queries


def flag_repeat_query(payloads: Sequence[tuple[str, dict]]) -> str:
    seen: set[str] = set()
    for query in _retrieval_queries(payloads):
        if query in seen:
            return "yes"
        seen.add(query)
    return "no"


def flag_locator_eligible(question: Question, payloads: Sequence[tuple[str, dict]], tools: Sequence[str]) -> str:
    if "read_passage" in list(tools or []):
        return "no"
    candidates = [question.question, *(_retrieval_queries(payloads))]
    if any(isinstance(text, str) and _LOCATOR_ELIGIBLE_RE.search(text) for text in candidates if text):
        return "yes"
    return "no"


def _as_payload_dict(value: object) -> dict:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value if isinstance(value, dict) else {}


def flag_cap_retry(payloads: Sequence[tuple[str, dict]]) -> str:
    capped_at: int | None = None
    for index, (name, body) in enumerate(payloads):
        capped = name in _CAP_STEP_NAMES or name.startswith(_WIDTH_CAP_STEP_PREFIX)
        if capped or (name.startswith("retrieve.") and _dropped_by_cap(body)):
            capped_at = index
            continue
        if capped_at is not None and (name.startswith("retrieve.") or _ROUND_STEP_RE.match(name)):
            return "yes"
    return "no"


def _dropped_by_cap(body: dict) -> bool:
    raw = _as_payload_dict(body.get("input"))
    return bool(raw.get("dropped_by_cap") or 0)


def flag_repair_fetch(payloads: Sequence[tuple[str, dict]]) -> str:
    return "yes" if any(name == _REPAIR_STEP_NAME for name, _ in payloads) else "no"


def _citation_keys_by_round(payloads: Sequence[tuple[str, dict]]) -> dict[int | None, set[str]]:
    by_round: dict[int | None, set[str]] = {}
    for name, body in payloads:
        if not name.startswith("retrieve."):
            continue
        out = _as_payload_dict(body.get("output"))
        inp = _as_payload_dict(body.get("input"))
        keys = out.get("citation_keys") or out.get("picked") or []
        if isinstance(keys, list) and keys and isinstance(keys[0], dict):
            keys = [str(item.get("citation_key") or item.get("file") or "") for item in keys]
        keys = {str(key).strip().casefold() for key in keys if str(key).strip()}
        if not keys:
            continue
        try:
            round_index: int | None = int(inp.get("round")) if inp.get("round") is not None else None
        except TypeError, ValueError:
            round_index = None
        by_round.setdefault(round_index, set()).update(keys)
    return by_round


def flag_cross_turn(payloads: Sequence[tuple[str, dict]]) -> str:
    by_round = _citation_keys_by_round(payloads)
    if len(by_round) < 2:
        return "no"
    seen: set[str] = set()
    for keys in by_round.values():
        if seen & keys:
            return "yes"
        seen.update(keys)
    return "no"


_RIS_TOOL_PREFIXES = ("ris", "law_lookup")

_PARAGRAPH_RE = re.compile(
    r"(§|Art(?:ikel)?\.?)\s*(\d+)([a-z](?![a-z]))?(?:\s*Abs\.?\s*(\d+[a-z]?))?",
    re.IGNORECASE,
)


def count_ris_calls(tools: Sequence[str]) -> int:
    return sum(1 for tool in tools if str(tool).lower().startswith(_RIS_TOOL_PREFIXES))


def _paragraph_keys(text: object) -> list[str]:
    keys = []
    for match in _PARAGRAPH_RE.finditer(str(text or "")):
        kind = "art" if match.group(1).lower().startswith("art") else "§"
        suffix = (match.group(3) or "").lower()
        absatz = f"abs{match.group(4).lower()}" if match.group(4) else ""
        keys.append(f"{kind}{match.group(2)}{suffix}{absatz}")
    return keys


def _same_paragraph(cited: str, expected: str) -> bool:
    return cited.startswith(expected) or expected.startswith(cited)


def _retrieved_paragraphs(payloads: Sequence[tuple[str, dict]]) -> set[str]:
    found: set[str] = set()
    for name, body in payloads:
        if not name.startswith(tuple(f"retrieve.{p}" for p in _RIS_TOOL_PREFIXES)):
            continue
        out = _as_payload_dict(body.get("output"))
        for value in out.get("clause_ids") or out.get("punkt_ids") or []:
            found.update(_paragraph_keys(value))
    return found


def paragraph_matches(question: Question, answer: str, payloads: Sequence[tuple[str, dict]]) -> str:
    expected = set(_paragraph_keys(question.paragraph)) or _retrieved_paragraphs(payloads)
    if not expected:
        return ""
    cited = set(_paragraph_keys(answer))
    if not cited:
        return "no"
    return _yes_no(any(_same_paragraph(one, other) for one in cited for other in expected))


def flag_ris_citation_resolved(answer: str, payloads: Sequence[tuple[str, dict]]) -> str:
    keys = [
        str(key).strip()
        for name, body in payloads
        if name.startswith(tuple(f"retrieve.{p}" for p in _RIS_TOOL_PREFIXES))
        for key in (_as_payload_dict(body.get("output")).get("citation_keys") or [])
        if str(key).strip()
    ]
    if not keys:
        return ""
    lowered = (answer or "").casefold()
    return _yes_no(any(key.casefold() in lowered for key in keys))


def _expected_family_number(family: str | None) -> str | None:
    if not family:
        return None
    match = re.search(r"OIB-RL\s*(\d+)", str(family), re.IGNORECASE)
    return match.group(1) if match else None


def flag_family_overlap(expected_family: str | None, family_cell: str) -> str:
    touched = [family for family, _o, _l in family_coverage(family_cell)]
    if len(touched) > 1:
        return "yes"
    expected = _expected_family_number(expected_family)
    if expected and touched and expected not in touched:
        return "yes"
    return "no"


def observe(question: Question, steps: Sequence[dict], answer: str, envelope: dict | None) -> Observation:
    payloads = _status_payloads(steps)
    rounds = {int(m.group(1)) for name, _ in payloads if (m := _ROUND_STEP_RE.match(name))}
    for name, body in payloads:
        if name.startswith("retrieve."):
            raw = body.get("input") or {}
            if isinstance(raw, str):
                try:
                    raw = json.loads(raw)
                except json.JSONDecodeError:
                    continue
            if isinstance(raw, dict) and raw.get("round") is not None:
                try:
                    rounds.add(int(raw["round"]))
                except TypeError, ValueError:
                    pass
    checkpoints = {
        int(m.group(1)): str(body.get("source") or "none")
        for name, body in payloads
        if (m := _CHECKPOINT_STEP_RE.match(name))
    }
    tools = [tool for _, body in payloads for tool in (body.get("tools") or [])]
    coverage = {
        str(body.get("family") or m.group(1)): (int(body.get("opened") or 0), int(body.get("listed") or 0))
        for name, body in payloads
        if (m := _COVERAGE_STEP_RE.match(name))
    }
    truncated = any(name == _BUDGET_STEP and body.get("truncated") for name, body in payloads)
    envelope = envelope or {}
    family_cell = " ".join(f"{family} {opened}/{listed}" for family, (opened, listed) in sorted(coverage.items()))
    return Observation(
        id=question.id,
        expected_family=question.family or "",
        expected_clause=question.clause or "",
        expected_kind=question.kind,
        kind=str(envelope.get("kind") or ""),
        verdict=_yes_no(bool(envelope.get("verdict"))),
        rounds=str(len(rounds)),
        read_passage=_yes_no("read_passage" in tools),
        clause_match=clause_matches(question.clause, cited_clauses(answer)),
        truncated=_yes_no(truncated),
        checkpoint_sources=">".join(checkpoints[index] for index in sorted(checkpoints)),
        family_coverage=family_cell,
        repeat_query=flag_repeat_query(payloads),
        locator_eligible=flag_locator_eligible(question, payloads, tools),
        cap_retry=flag_cap_retry(payloads),
        repair_fetch=flag_repair_fetch(payloads),
        cross_turn=flag_cross_turn(payloads),
        family_overlap=flag_family_overlap(question.family, family_cell),
        ris_calls=str(count_ris_calls(tools)),
        paragraph_match=paragraph_matches(question, answer, payloads),
        ris_citation_resolved=flag_ris_citation_resolved(answer, payloads),
    )


def write_csv(path: Path, rows: Sequence[Observation]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(FIELDS))
        writer.writeheader()
        for row in rows:
            writer.writerow(asdict(row))


_LEGACY_COLUMNS = {"expected_punkt": "expected_clause", "punkt_match": "clause_match"}


def read_csv(path: Path) -> list[Observation]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        header = tuple(_LEGACY_COLUMNS.get(name, name) for name in reader.fieldnames or ())
        reader.fieldnames = list(header)
        if header != FIELDS:
            missing = [name for name in FIELDS if name not in header]
            extra = [name for name in header if name not in FIELDS]
            added = {*_DOUBLE_FETCH_FIELDS, *_RIS_FIELDS}
            legacy_missing = [name for name in missing if name not in added]
            legacy_extra = [name for name in extra]
            if set(missing) <= added and not legacy_extra and not legacy_missing:
                return [Observation(**{name: str(row.get(name) or "") for name in FIELDS}) for row in reader]
            raise ValueError(
                f"{path} does not carry this script's columns "
                f"(missing={missing or '-'}, unexpected={extra or '-'}). Re-run the eval to produce it."
            )
        return [Observation(**{name: str(row.get(name) or "") for name in FIELDS}) for row in reader]


@dataclass(frozen=True)
class Summary:
    answered: int = 0
    rounds_total: int = 0
    kind_as_expected: int = 0
    clause_measured: int = 0
    clause_matched: int = 0
    paragraph_measured: int = 0
    paragraph_matched: int = 0
    ris_calls: int = 0
    booleans: dict[str, int] = field(default_factory=dict)
    checkpoint_sources: dict[str, int] = field(default_factory=dict)
    families_touched: int = 0
    families_complete: int = 0
    errors: int = 0


def family_coverage(cell: str) -> list[tuple[str, int, int]]:
    out: list[tuple[str, int, int]] = []
    tokens = (cell or "").split()
    for family, ratio in zip(tokens[::2], tokens[1::2], strict=False):
        opened, _, listed = ratio.partition("/")
        if opened.isdigit() and listed.isdigit():
            out.append((family, int(opened), int(listed)))
    return out


def summarise(rows: Sequence[Observation]) -> Summary:
    booleans = {name: sum(1 for row in rows if getattr(row, name) == "yes") for name in _BOOLEAN_FIELDS}
    sources: dict[str, int] = {}
    for row in rows:
        for token in filter(None, row.checkpoint_sources.split(">")):
            sources[token] = sources.get(token, 0) + 1
    touched = [pair for row in rows for pair in family_coverage(row.family_coverage)]
    return Summary(
        answered=sum(1 for row in rows if not row.error),
        rounds_total=sum(int(row.rounds or 0) for row in rows),
        kind_as_expected=sum(1 for row in rows if row.kind and row.kind == row.expected_kind),
        clause_measured=sum(1 for row in rows if row.clause_match),
        clause_matched=sum(1 for row in rows if row.clause_match == "yes"),
        paragraph_measured=sum(1 for row in rows if row.paragraph_match),
        paragraph_matched=sum(1 for row in rows if row.paragraph_match == "yes"),
        ris_calls=sum(int(row.ris_calls or 0) for row in rows),
        booleans=booleans,
        checkpoint_sources=sources,
        families_touched=len(touched),
        families_complete=sum(1 for _family, opened, listed in touched if listed and opened == listed),
        errors=sum(1 for row in rows if row.error),
    )


_COMPARED_FIELDS = (
    "kind",
    "verdict",
    "rounds",
    "read_passage",
    "clause_match",
    "truncated",
    "checkpoint_sources",
    "family_coverage",
    *_DOUBLE_FETCH_FIELDS,
    *_RIS_FIELDS,
)


def changed_rows(before: Sequence[Observation], after: Sequence[Observation]) -> list[tuple[str, str, str, str]]:
    left = {row.id: row for row in before}
    right = {row.id: row for row in after}
    out: list[tuple[str, str, str, str]] = []
    for question_id in sorted(left.keys() | right.keys()):
        old, new = left.get(question_id), right.get(question_id)
        for name in _COMPARED_FIELDS:
            was = getattr(old, name) if old else "—"
            now = getattr(new, name) if new else "—"
            if was != now:
                out.append((question_id, name, was, now))
    return out


def _delta(was: int, now: int) -> str:
    return f"{was} → {now} ({now - was:+d})"


def format_comparison(before: Sequence[Observation], after: Sequence[Observation]) -> str:
    old, new = summarise(before), summarise(after)
    lines = [
        f"questions: {_delta(len(before), len(after))}",
        f"answered without error: {_delta(old.answered, new.answered)}",
        f"kind as expected: {_delta(old.kind_as_expected, new.kind_as_expected)}",
        f"retrieval rounds, total: {_delta(old.rounds_total, new.rounds_total)}",
        f"cited Punkt matched: {_delta(old.clause_matched, new.clause_matched)}"
        f" of {_delta(old.clause_measured, new.clause_measured)} measured",
        f"cited § matched: {_delta(old.paragraph_matched, new.paragraph_matched)}"
        f" of {_delta(old.paragraph_measured, new.paragraph_measured)} measured",
        f"RIS tool calls, total: {_delta(old.ris_calls, new.ris_calls)}",
    ]
    lines += [f"{name}: {_delta(old.booleans.get(name, 0), new.booleans.get(name, 0))}" for name in _BOOLEAN_FIELDS]
    lines.append(
        f"families read completely: {_delta(old.families_complete, new.families_complete)}"
        f" of {_delta(old.families_touched, new.families_touched)} touched"
    )
    for token in sorted(old.checkpoint_sources.keys() | new.checkpoint_sources.keys()):
        lines.append(
            f"checkpoint source {token}: "
            f"{_delta(old.checkpoint_sources.get(token, 0), new.checkpoint_sources.get(token, 0))}"
        )
    changes = changed_rows(before, after)
    lines.append("")
    lines.append(f"per question ({len(changes)} cell(s) moved):" if changes else "per question: nothing moved")
    lines += [f"  {question_id:34} {name:20} {was} → {now}" for question_id, name, was, now in changes]
    return "\n".join(lines)


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
            records.append(
                {
                    "name": step.id,
                    "payload": {"round": step.round, "values": dict(step.values), "tools": list(step.tools)},
                }
            )
            if (entry := ledger.get(step.round)) is not None:
                records.append(_ledger_record(step.round, entry))
        elif isinstance(step, wire_v2.StatusStep):
            records.append({"name": step.id, "payload": {**step.detail, "values": dict(step.values)}})
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
        try:
            wire_v2.HELLO.validate_json(ws.recv(timeout=HELLO_TIMEOUT_SECONDS))
        except Exception as exc:
            raise RuntimeError(f"{base_url} did not open with a wire v2 hello; is it the chat role?") from exc
        question_message = wire_v2.UserMessage(
            conversation_id=conversation_id,
            message_id=turn.message_id,
            text=question,
            data_sources=list(DATA_SOURCES),
        )
        ws.send(json.dumps(question_message.model_dump(mode="json", exclude_defaults=True)))
        while turn.result is None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"no RUN_FINISHED within {timeout:g}s")
            reply = read_event(turn, wire_v2.WIRE_EVENT.validate_json(ws.recv(timeout=remaining)))
            if reply is not None:
                ws.send(json.dumps(reply.model_dump(mode="json", exclude_defaults=True)))
    return step_records(turn), turn.result.text, turn.result.answer_meta


def run(questions: Sequence[Question], base_url: str, timeout: float) -> list[Observation]:
    rows: list[Observation] = []
    for index, question in enumerate(questions, 1):
        print(f"[{index}/{len(questions)}] {question.id}", file=sys.stderr, flush=True)
        try:
            steps, answer, envelope = _socket_turn(base_url, question.question, timeout)
        except Exception as exc:  # noqa: BLE001 — one dead turn must not lose the other nineteen
            rows.append(
                Observation(
                    id=question.id,
                    expected_family=question.family or "",
                    expected_clause=question.clause or "",
                    expected_kind=question.kind,
                    error=f"{type(exc).__name__}: {exc}"[:200],
                )
            )
            continue
        rows.append(observe(question, steps, answer, envelope))
    return rows


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Loop eval: what the agentic-loop changes did to the SHAPE of a turn.")
    parser.add_argument("--questions", type=Path, default=DEFAULT_QUESTIONS)
    parser.add_argument("--out", type=Path, help="Where to write this run's CSV.")
    parser.add_argument("--compare", nargs=2, type=Path, metavar=("BEFORE", "AFTER"))
    parser.add_argument("--base-url", default=os.environ.get(BASE_URL_ENV, ""))
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS)
    args = parser.parse_args(argv)

    if args.compare:
        print(format_comparison(read_csv(args.compare[0]), read_csv(args.compare[1])))
        return 0
    if not args.out:
        parser.error("--out is required unless --compare is given")
    if not args.base_url:
        parser.error(
            f"no backend to measure: pass --base-url or set {BASE_URL_ENV}. "
            "This eval needs a running backend with the OIB corpus ingested; it cannot run in CI."
        )
    rows = run(load_questions(args.questions), args.base_url, args.timeout)
    write_csv(args.out, rows)
    print(format_comparison([], rows))
    failed = sum(1 for row in rows if row.error)
    print(f"\nwrote {args.out} ({len(rows)} row(s), {failed} error(s))", file=sys.stderr)
    return 0


if __name__ == "__main__":  # pragma: no cover - CLI
    raise SystemExit(main())
