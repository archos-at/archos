from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Any

from . import client
from .read_log import NOT_FOUND
from .read_log import current_read_log
from .reading import citation_parts
from .session import IntakeSession
from .tool_inputs import MAX_QUOTE_CHARS
from .tool_inputs import RecordedValue

logger = logging.getLogger(__name__)

MAX_RENDERED_OPENED = 30

SELECT_TYPES = frozenset({"single_select", "multi_select"})
NUMBER_TYPES = frozenset({"number", "number_tri"})

_OUTCOME_TEXT = {
    "suggested": "suggested — a person will check it",
    "corroborated": "corroborated — the profile already holds this value; your evidence was added",
    "contradiction": "contradiction — differs from the value already on the profile; kept beside it for a person",
}
_REFUSAL_TEXT = {
    "vocabulary": (
        "refused: not a value this question takes (select: its option tokens exactly; number: a plain number in "
        "the question's unit; yes/no: true or false)"
    ),
    "unknown-key": (
        "refused: no question of the intake writes this key, or not with this @bldgN/@bldgN@use suffix, or the "
        "Bauwerk is not on the profile"
    ),
    "dismissed": "refused: a person dismissed this value before; do not record it again",
    "unreadable-file": "refused: this file may not feed the profile; take the value from another document",
}
_CLASS_REFUSAL = (
    "refused: the building class is derived from the inputs you record, never recorded; record the inputs the "
    "document gives"
)


_GROUPED_THOUSANDS = re.compile(r"^-?\d{1,3}(\.\d{3})+$")


def _number(text: str) -> int | float | None:
    text = text.strip().replace("\u00a0", "").replace(" ", "")
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    elif _GROUPED_THOUSANDS.match(text):
        text = text.replace(".", "")
    try:
        number = float(text)
    except ValueError:
        return None
    return int(number) if number.is_integer() else number


def _coerce(value: Any, need: dict[str, Any] | None) -> Any:
    kind = (need or {}).get("type")
    if kind in NUMBER_TYPES and isinstance(value, str):
        number = _number(value)
        return value if number is None else number
    if kind == "boolean" and isinstance(value, str) and value.strip().casefold() in {"true", "false", "ja", "nein"}:
        return value.strip().casefold() in {"true", "ja"}
    if kind == "multi_select" and isinstance(value, str):
        return [value]
    if kind == "single_select" and isinstance(value, list) and len(value) == 1:
        return value[0]
    return value


def _outside_options(value: Any, need: dict[str, Any] | None) -> list[str]:
    if not need or need.get("type") not in SELECT_TYPES or not need.get("options"):
        return []
    tokens = {str(option.get("token")) for option in need["options"] if isinstance(option, dict)}
    given = value if isinstance(value, list) else [value]
    return [str(token) for token in given if str(token) not in tokens]


@dataclass
class _Candidate:
    index: int
    key: str
    value: Any
    file_name: str
    page: int | None
    quote: str
    need: dict[str, Any] | None

    def wire(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "value": self.value,
            "evidence": {"fileName": self.file_name, "page": self.page, "quote": self.quote},
        }


@dataclass(frozen=True)
class _NotSent:
    code: str
    text: str


def _checked(index: int, item: RecordedValue, session: IntakeSession) -> _Candidate | _NotSent:
    log = current_read_log()
    quote = " ".join((item.quote or "").split())[:MAX_QUOTE_CHARS].strip()
    if log is None:
        return _NotSent("no-read-log", "not sent: nothing was read in this run, so no quote can be checked")
    if item.value is None or item.value in ("", []):
        return _NotSent("empty", "not sent: an empty value records nothing; leave the need open instead")
    if not quote:
        return _NotSent("no-quote", "not sent: a value needs the quote that states it")
    named, cited_page = _where(item)
    if not named:
        return _NotSent("no-file", "not sent: say where the quote stands, as citation or file_name")
    asked_page = item.page if item.page is not None else cited_page
    file_name = log.canonical_name(named)
    if file_name is None or not log.has_text(file_name):
        return _NotSent(
            "not-read",
            f"not sent: you have not read „{named}“ in this run; read the page with read_document first",
        )
    found = log.contains(file_name, quote, asked_page)
    if found is NOT_FOUND:
        return _NotSent("quote-not-read", _not_read_text(log, file_name, quote, asked_page))
    need = session.needs.get(item.key)
    value = _coerce(item.value, need)
    outside = _outside_options(value, need)
    if outside:
        tokens = ", ".join(str(option.get("token")) for option in (need or {}).get("options") or [])
        listed = ", ".join(outside)
        return _NotSent(
            "not-an-option", f"not sent: {listed} is not an option of this question; the tokens are: {tokens}"
        )
    page = found if isinstance(found, int) else (asked_page if asked_page and asked_page >= 1 else None)
    return _Candidate(index, item.key, value, file_name, page, quote, need)


def _where(item: RecordedValue) -> tuple[str, int | None]:
    if item.file_name and item.file_name.strip():
        name = item.file_name.strip()
        parsed, page = citation_parts(name)
        return (name, None) if page is None else (parsed, page)
    if item.citation and item.citation.strip():
        return citation_parts(item.citation)
    return "", None


def _not_read_text(log: Any, file_name: str, quote: str, page: int | None) -> str:
    text = f"not sent: the quote does not stand in what you read of „{file_name}“."
    closest = log.closest(file_name, quote, page)
    if closest is None:
        return f"{text} Read the page with read_document and copy the document's exact words."
    where = f" on page {closest.page}" if closest.page else ""
    return (
        f"{text} Closest passage you read{where}: „{closest.text}“. If it states the value, quote it exactly; "
        "otherwise read the page that does."
    )


def _verify_selects(candidates: list[_Candidate], session: IntakeSession) -> dict[int, str]:
    from agent.knowledge.fingerprint_verify import verify_fingerprint
    from agent.knowledge.project_experience import Evidence
    from agent.knowledge.project_experience import FingerprintValue
    from agent.knowledge.project_experience import VocabularyEntry
    from agent.knowledge.project_experience import VocabularyOption

    selects = [c for c in candidates if c.need and c.need.get("type") in SELECT_TYPES]
    if not selects:
        return {}
    vocabulary: dict[str, VocabularyEntry] = {}
    labels: dict[str, str] = {}
    values: list[FingerprintValue] = []
    for candidate in selects:
        need = candidate.need or {}
        base = str(need.get("baseKey") or candidate.key)
        options = [o for o in need.get("options") or [] if isinstance(o, dict) and o.get("token") and o.get("label")]
        vocabulary[base] = VocabularyEntry(
            multiple=need.get("type") == "multi_select",
            options=[VocabularyOption(token=str(o["token"]), label=str(o["label"])) for o in options],
        )
        labels[base] = str(need.get("label") or base)
        page = str(candidate.page) if candidate.page else None
        evidence = Evidence(fileName=candidate.file_name, page=page, quote=candidate.quote)
        values.append(FingerprintValue(key=base, value=candidate.value, evidence=[evidence]))
    kept = verify_fingerprint(values, vocabulary, organization_id=session.organization_id, fact_labels=labels)
    refused: dict[int, str] = {}
    position = 0
    for candidate, value in zip(selects, values, strict=True):
        match = kept[position] if position < len(kept) else None
        if _kept_as(candidate, value, match):
            position += 1
            continue
        refused[candidate.index] = (
            "not sent: read as not stating this value (the quote does not say it for this project); "
            "find a passage that states it, or leave the need open"
        )
    return refused


def _kept_as(candidate: _Candidate, value: Any, match: Any) -> bool:
    if not (match is not None and match.key == value.key and match.evidence == value.evidence):
        return False
    if match.value != value.value:
        candidate.value = match.value
    return True


def _outcome_line(key: str, result: dict[str, Any], session: IntakeSession) -> tuple[str, str]:
    outcome = str(result.get("outcome") or "")
    if outcome == "refused":
        reason = str(result.get("reason") or "")
        if reason == "unknown-key" and key.split("@", maxsplit=1)[0] in {"building_class", "gebaeudeklasse"}:
            return "refused:unknown-key", _CLASS_REFUSAL
        text = _REFUSAL_TEXT.get(reason, f"refused ({reason or 'no reason given'})")
        close = session.closest_keys(key) if reason == "unknown-key" else []
        if close:
            text = f"{text}; closest keys intake_needs listed: {', '.join(close)}"
        return f"refused:{reason or 'unknown'}", text
    return outcome, _OUTCOME_TEXT.get(outcome, outcome or "no outcome")


def render_opened(opened: Any) -> str:
    items = [item for item in opened or [] if isinstance(item, dict) and item.get("key")]
    if not items:
        return ""
    shown = ", ".join(
        f"{item['key']}{' [decisive]' if item.get('decisive') else ''}" for item in items[:MAX_RENDERED_OPENED]
    )
    more = f", … {len(items) - MAX_RENDERED_OPENED} more" if len(items) > MAX_RENDERED_OPENED else ""
    return f"opened: {shown}{more} (now needs; intake_needs lists them with their options)"


async def record_values(session: IntakeSession, values: list[RecordedValue]) -> str:
    if session.stale:
        return "Not sent: this reading is no longer the project's current one. Call finish_intake and stop."
    if session.finished:
        return "Not sent: the intake is already finished."
    batch = list(values or [])[: client.MAX_RECORD_VALUES]
    overflow = len(values or []) - len(batch)
    lines: dict[int, str] = {}
    candidates: list[_Candidate] = []
    for index, item in enumerate(batch):
        checked = _checked(index, item, session)
        if isinstance(checked, _NotSent):
            session.refusals[f"local:{checked.code}"] += 1
            lines[index] = f"- {item.key}: {checked.text}"
        else:
            candidates.append(checked)
    try:
        refused = await asyncio.to_thread(_verify_selects, candidates, session)
    except Exception:  # noqa: BLE001 — verification is a filter; when it fails, the values go as they are
        logger.warning("Intake: select verification failed; sending unverified", exc_info=True)
        refused = {}
    for index, reason in refused.items():
        session.refusals["local:not-stated"] += 1
        lines[index] = f"- {batch[index].key}: {reason}"
    to_send = [candidate for candidate in candidates if candidate.index not in refused]
    opened = ""
    if to_send:
        reply = await client.call_intake("record", client.record_request(session.job_id, [c.wire() for c in to_send]))
        session.stale = session.stale or reply.stale
        _record_results(session, to_send, reply, lines)
        opened = render_opened(reply.body.get("opened")) if reply.ok else ""
    out = [lines[index] for index in sorted(lines)]
    if overflow > 0:
        out.append(f"[{overflow} more value(s) not sent: at most {client.MAX_RECORD_VALUES} per call.]")
    if opened:
        out.append(opened)
    return "\n".join(out) if out else "Nothing to record."


def _record_results(
    session: IntakeSession, sent: list[_Candidate], reply: client.IntakeReply, lines: dict[int, str]
) -> None:
    results = reply.body.get("results") if reply.ok else None
    for position, candidate in enumerate(sent):
        result = results[position] if isinstance(results, list) and position < len(results) else None
        if not isinstance(result, dict):
            lines[candidate.index] = f"- {candidate.key}: not recorded — {reply.refusal or 'no result returned'}"
            continue
        counted, text = _outcome_line(candidate.key, result, session)
        (session.refusals if counted.startswith("refused") else session.outcomes)[counted] += 1
        lines[candidate.index] = f"- {candidate.key} = {candidate.value!r}: {text}"
