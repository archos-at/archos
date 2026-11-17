from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from dataclasses import dataclass
from types import UnionType
from typing import Any
from typing import Literal
from typing import Union
from typing import get_args
from typing import get_origin

from pydantic import BaseModel
from pydantic import Field
from pydantic import ValidationError
from pydantic import field_validator

from agent.common.provenance import normalize_document_name
from agent.common.turn_notices import VERDICT_DROP_AGENT_AUTHORED
from agent.common.turn_notices import VERDICT_DROP_UNREFERENCED_WITH_AGENT_SOURCE
from agent.common.turn_notices import emit_anatomy_dropped
from agent.common.turn_notices import emit_verdict_dropped

logger = logging.getLogger(__name__)

ENVELOPE_VERSION = 1

ENVELOPE_FENCE = "answer_json"

_ANSWER_JSON_OPEN_RE = re.compile(rf"```{ENVELOPE_FENCE}[ \t]*\n")
_ANSWER_JSON_FENCE_RE = re.compile(rf"```{ENVELOPE_FENCE}[ \t]*\n(.*?)\n?```", re.DOTALL)
_FENCE_CLOSE_RE = re.compile(r"[ \t]*\n?```")

VERDICT_VALUE_MAX_CHARS = 60

SUMMARY_MAX_CHARS = 320

TOPIC_MAX_CHARS = 90

CONTEXT_MAX_CHARS = 160

CALLOUT_MARKER = "[[callout]]"

_CALLOUT_LINE_RE = re.compile(r"^ {0,3}\[\[callout\]\][ \t]*$")
_CALLOUT_INLINE_RE = re.compile(r"\[\[callout\]\]")

TAKEAWAYS_MIN_PROSE_CHARS = 600

TAKEAWAYS_MAX_ITEMS = 5

_MIN_MATCHABLE_NAME_CHARS = 4

AnswerKind = Literal["direct", "walkthrough", "ruling", "handoff", "work"]

WORK_ITEMS_MAX = 6
WORK_TEXT_MAX_CHARS = 200
WORK_FIELD_MAX_CHARS = {"ref": 80, "who": 80, "due": 40}
WORK_SECTIONS = ("done", "proposed", "blocked", "next")
ANSWER_KINDS: tuple[str, ...] = get_args(AnswerKind)


class _EnvelopeModel(BaseModel):
    model_config = {"extra": "ignore"}


class AnswerMetaReference(_EnvelopeModel):
    document: str = Field(min_length=1, description="e.g. 'OIB-Richtlinie 2'")
    section: str | None = Field(default=None, description="e.g. 'Tabelle 1b'")
    edition: str | None = Field(default=None, description="e.g. 'Ausgabe Mai 2023'")


class AnswerMetaVerdict(_EnvelopeModel):
    value: str = Field(min_length=1, description="the copyable VALUE — a number, a class, 'Nicht geregelt'")
    subject: str = Field(min_length=1, description="what the verdict answers, e.g. 'Erforderliche Geländerhöhe'")
    reference: AnswerMetaReference | None = Field(
        default=None, description="only when one Fundstelle carries the verdict"
    )


class AnswerMetaTakeaway(_EnvelopeModel):
    text: str = Field(
        min_length=1,
        description=(
            "ONE standalone claim carrying its own value — the number, the class, the Frist, the ruling: "
            "'Tragende Bauteile in GK 4: mindestens REI 60' passes. A topic or an outline heading fails, "
            "and is the usual mistake: 'Rechtsgrundlage', 'Fazit', 'Anforderungen an tragende Bauteile' "
            "name what the row would be about instead of saying it. The reader who reads only these rows "
            "must leave with the answer, so a row with nothing to write down is a wasted row"
        ),
    )
    detail: str | None = Field(
        default=None,
        description=(
            "The footnote behind the claim, one to two FULL sentences, revealed only when the reader "
            "opens the row: where the value comes from (Richtlinie, Punkt, Tabelle, Ausgabe), how it was "
            "derived, or the one case in which the claim does not hold. It has to repay the click — a "
            "half-sentence, a pointer back at the prose, or `text` said again in other words is worse "
            "than none. Omit it where the claim needs no footnote; that is normal, and a row without one "
            "simply does not open"
        ),
    )


LEGACY_CALLOUT_KIND = {"hinweis": "note", "achtung": "warning", "frist": "deadline", "tipp": "tip"}


class AnswerMetaCallout(_EnvelopeModel):
    kind: Literal["note", "warning", "deadline", "tip"]

    @field_validator("kind", mode="before")
    @classmethod
    def _legacy_kind(cls, value: object) -> object:
        return LEGACY_CALLOUT_KIND.get(value, value) if isinstance(value, str) else value

    text: str = Field(min_length=1, description="the one sentence that changes what the reader DOES")
    title: str | None = Field(default=None, description="short headline; omit when text says it")
    detail: str | None = Field(default=None, description="background revealed on expand; omit rather than pad")


class AnswerMetaWorkItem(_EnvelopeModel):
    text: str = Field(min_length=1, description="one line, what was done, proposed, blocked or comes next")
    ref: str | None = Field(
        default=None, description="the id it is about: the proposal id for a proposal, else the object's id"
    )
    who: str | None = Field(
        default=None, description="who acts: the person or role a blocked step waits on, or who takes the next one"
    )
    due: str | None = Field(default=None, description="by when, in the answer's words; only when stated")


class AnswerMetaWork(_EnvelopeModel):
    done: list[AnswerMetaWorkItem] | None = Field(
        default=None, description="what this turn read or did that needed no one's yes"
    )
    proposed: list[AnswerMetaWorkItem] | None = Field(
        default=None,
        description="each write this turn proposed and the person still has to accept, with its proposal id as ref",
    )
    blocked: list[AnswerMetaWorkItem] | None = Field(
        default=None, description="what could not be done, why, and who is needed (who)"
    )
    next: list[AnswerMetaWorkItem] | None = Field(default=None, description="what comes next, who does it and by when")


class AnswerMetaConfidence(_EnvelopeModel):
    level: Literal["low", "medium", "high"]
    reason: str | None = Field(
        default=None, description="one short clause naming the decisive grounding fact, in the answer's language"
    )


class AnswerMeta(_EnvelopeModel):
    kind: AnswerKind | None = Field(
        default=None,
        description=(
            'exclusive answer shape: "direct" | "walkthrough" | "ruling" | "handoff" | "work"; verdict is only for '
            "kind=ruling, work only for kind=work"
        ),
    )
    summary: str | None = Field(
        default=None,
        description=(
            "omit unless the answer has a consequence for this reader that its opening does not state: "
            "what to do next or what it means for their project, 1-2 sentences, in the answer's language"
        ),
    )
    verdict: AnswerMetaVerdict | None = None
    topic: str | None = Field(
        default=None,
        description=(
            "nominal title for non-ruling answers, e.g. 'Brandschutz' — never a verdict verb; "
            "plain text in the answer's language, claiming nothing the prose didn't ground"
        ),
    )
    context: str | None = Field(
        default=None,
        description=("one-line scope, e.g. 'OIB-RL 2, Ausgabe Mai 2023 · Wien'; plain text in the answer's language"),
    )
    takeaways: list[AnswerMetaTakeaway] | None = None
    callout: AnswerMetaCallout | None = None
    work: AnswerMetaWork | None = None
    confidence: AnswerMetaConfidence | None = None
    escalate_to_deep: bool | None = Field(
        default=None,
        description=(
            "true when this question needs deep research: the user commissioned a report or document, "
            "the answer needs many sources read against each other, or what you retrieved cannot support "
            "an adequate answer"
        ),
    )
    escalation_reason: str | None = Field(
        default=None,
        description="with escalate_to_deep: one short clause saying why, in the answer's language",
    )
    skills_applied: list[str] | None = Field(
        default=None,
        description=(
            "the names of the skills from the prompt's Skills section whose method this answer followed; "
            "omit when none did"
        ),
    )
    cards: list[Any] | None = Field(
        default=None,
        description=(
            "the rich-UI cards this answer earns, as card objects (each with a `type` field), in the "
            "same message as the answer — the contract for them follows the field list"
        ),
        json_schema_extra={"strict_schema": "omit"},
    )

    @field_validator("kind", mode="before")
    @classmethod
    def _coerce_kind(cls, value: object) -> str | None:
        if not isinstance(value, str):
            return None
        kind = value.strip()
        if not kind:
            return None
        return kind if kind in ANSWER_KINDS else "walkthrough"

    @property
    def empty(self) -> bool:
        return (
            self.kind is None
            and self.summary is None
            and self.verdict is None
            and self.topic is None
            and self.context is None
            and not self.takeaways
            and self.callout is None
            and self.work is None
            and self.confidence is None
            and self.escalate_to_deep is None
            and not self.skills_applied
            and self.escalation_reason is None
            and not self.cards
        )


@dataclass(frozen=True)
class GateContext:
    prose_chars: int
    agent_authored_documents: frozenset[str] = frozenset()
    prose: str = ""
    record: bool = True

    def anatomy_dropped(self, *, field: str, reason: str) -> None:
        if self.record:
            emit_anatomy_dropped(field=field, reason=reason)

    def verdict_dropped(self, *, reason: str) -> None:
        if self.record:
            emit_verdict_dropped(reason=reason)


SUMMARY_RESTATES_OVERLAP = 0.4

_CONTENT_WORD = re.compile(r"[a-zäöüß0-9]{4,}")
_NOT_PROSE_BLOCK = ("|", "```", "[[", "#", "- ", "* ", "> ", "$$")


def _content_words(text: str) -> set[str]:
    plain = re.sub(r"\[\d+\]|\*\*|\[\[[^\]]*\]\]", " ", text.lower())
    return {word[:5] for word in _CONTENT_WORD.findall(plain)}


_ABBREVIATION = re.compile(
    r"\b(?:[A-Za-zÄÖÜäöü]\.\s?)+[A-Za-zÄÖÜäöü]\."
    r"|\b(?:gem|Pkt|Abs|Nr|lt|bzw|vgl|ca|inkl|bzgl|lit|Art|Ziff|Kap|Abb|Tab|Anm|mind|zzgl|ggf|evtl|sog|Bsp)\.",
    re.IGNORECASE,
)
_SENTENCE = re.compile(r"[^.!?]+[.!?](?:\s*\[\d+\])*(?=\s|$)")


def _sentence_count(text: str) -> int:
    return len(_SENTENCE.findall(_ABBREVIATION.sub(lambda m: m.group().replace(".", ""), text)))


def _prose_paragraphs(prose: str) -> list[str]:
    return [
        block.strip()
        for block in re.split(r"\n\s*\n", prose)
        if block.strip() and not block.lstrip().startswith(_NOT_PROSE_BLOCK)
    ]


def _summary_redundant(summary: str, prose: str) -> str | None:
    if not prose.strip():
        return None
    blocks = [block for block in re.split(r"\n\s*\n", prose) if block.strip()]
    paragraphs = _prose_paragraphs(prose)
    if paragraphs and len(paragraphs) == len(blocks):
        if _sentence_count(" ".join(paragraphs)) <= 2:
            return "short_answer"
    if not paragraphs:
        return None
    words = _content_words(summary)
    if words and len(words & _content_words(paragraphs[0])) / len(words) >= SUMMARY_RESTATES_OVERLAP:
        return "restates_lede"
    return None


def _gate_summary(meta: AnswerMeta, ctx: GateContext) -> str | None:
    if meta.summary is None:
        return None
    summary = meta.summary.strip()
    if not summary:
        return None
    if len(summary) > SUMMARY_MAX_CHARS:
        logger.info(
            "answer_meta summary gated out: %d chars exceeds %d — a paragraph, not a standfirst",
            len(summary),
            SUMMARY_MAX_CHARS,
        )
        ctx.anatomy_dropped(field="summary", reason="too_long")
        return None
    redundant = _summary_redundant(summary, ctx.prose)
    if redundant:
        logger.info("answer_meta summary gated out: %s — the prose already says it", redundant)
        ctx.anatomy_dropped(field="summary", reason=redundant)
        return None
    return summary


def _gate_topic(meta: AnswerMeta, ctx: GateContext) -> str | None:
    if meta.topic is None:
        return None
    topic = meta.topic.strip()
    if not topic:
        return None
    if len(topic) > TOPIC_MAX_CHARS:
        logger.info(
            "answer_meta topic gated out: %d chars exceeds %d — a heading, not a nominal title",
            len(topic),
            TOPIC_MAX_CHARS,
        )
        ctx.anatomy_dropped(field="topic", reason="too_long")
        return None
    return topic


def _gate_context(meta: AnswerMeta, ctx: GateContext) -> str | None:
    if meta.context is None:
        return None
    context = meta.context.strip()
    if not context:
        return None
    if len(context) > CONTEXT_MAX_CHARS:
        logger.info(
            "answer_meta context gated out: %d chars exceeds %d — a paragraph, not a scope line",
            len(context),
            CONTEXT_MAX_CHARS,
        )
        ctx.anatomy_dropped(field="context", reason="too_long")
        return None
    return context


def _gate_kind(meta: AnswerMeta, ctx: GateContext) -> str | None:
    return meta.kind


def _verdict_drop_reason(verdict: AnswerMetaVerdict, ctx: GateContext) -> str | None:
    if _names_agent_authored_document(verdict.reference, ctx):
        return VERDICT_DROP_AGENT_AUTHORED
    if verdict.reference is None and ctx.agent_authored_documents:
        return VERDICT_DROP_UNREFERENCED_WITH_AGENT_SOURCE
    return None


def _names_agent_authored_document(reference: AnswerMetaReference | None, ctx: GateContext) -> bool:
    if reference is None or not ctx.agent_authored_documents:
        return False
    named = normalize_document_name(reference.document)
    if len(named) < _MIN_MATCHABLE_NAME_CHARS:
        return False
    return any(name in named or named in name for name in ctx.agent_authored_documents)


def _gate_verdict(meta: AnswerMeta, ctx: GateContext) -> dict | None:
    if meta.verdict is None:
        return None
    if meta.kind is not None and meta.kind != "ruling":
        logger.info("answer_meta verdict gated out: kind %s is not ruling", meta.kind)
        return None
    value = meta.verdict.value.strip()
    subject = meta.verdict.subject.strip()
    if not value or not subject or len(value) > VERDICT_VALUE_MAX_CHARS:
        logger.info(
            "answer_meta verdict gated out: value length %d exceeds %d (or a field is blank)",
            len(value),
            VERDICT_VALUE_MAX_CHARS,
        )
        return None
    drop = _verdict_drop_reason(meta.verdict, ctx)
    if drop is not None:
        logger.info(
            "answer_meta verdict gated out (%s): Fundstelle %r against %d agent-authored document(s) — "
            "an approved office document is evidence of what the office decided, never of what the OIB requires",
            drop,
            meta.verdict.reference.document if meta.verdict.reference else None,
            len(ctx.agent_authored_documents),
        )
        ctx.verdict_dropped(reason=drop)
        return None
    verdict: dict = {"value": value, "subject": subject}
    if meta.verdict.reference is not None:
        verdict["reference"] = meta.verdict.reference.model_dump(exclude_none=True)
    return verdict


def _gate_callout(meta: AnswerMeta, ctx: GateContext) -> dict | None:
    if meta.callout is None or not meta.callout.text.strip():
        return None
    callout: dict = {"kind": meta.callout.kind, "text": meta.callout.text.strip()}
    if meta.callout.title and meta.callout.title.strip():
        callout["title"] = meta.callout.title.strip()
    if meta.callout.detail and meta.callout.detail.strip():
        callout["detail"] = meta.callout.detail.strip()
    return callout


def _takeaway_payload(item: AnswerMetaTakeaway) -> dict:
    text = item.text.strip()
    detail = (item.detail or "").strip()
    if not detail or detail.casefold() == text.casefold():
        return {"text": text}
    return {"text": text, "detail": detail}


def _gate_takeaways(meta: AnswerMeta, ctx: GateContext) -> list | None:
    takeaways = [t for t in (meta.takeaways or []) if t.text.strip()][:TAKEAWAYS_MAX_ITEMS]
    if not takeaways:
        return None
    if ctx.prose_chars < TAKEAWAYS_MIN_PROSE_CHARS:
        logger.info(
            "answer_meta takeaways gated out: prose %d chars is under the %d floor",
            ctx.prose_chars,
            TAKEAWAYS_MIN_PROSE_CHARS,
        )
        ctx.anatomy_dropped(field="takeaways", reason="prose_too_short")
        return None
    if len(takeaways) < 2:
        logger.info("answer_meta takeaways gated out: a single takeaway is a sentence, not a block")
        ctx.anatomy_dropped(field="takeaways", reason="single_item")
        return None
    return [_takeaway_payload(t) for t in takeaways]


def _work_item_payload(item: AnswerMetaWorkItem) -> dict | None:
    text = item.text.strip()
    if not text or len(text) > WORK_TEXT_MAX_CHARS:
        return None
    payload: dict = {"text": text}
    for name, limit in WORK_FIELD_MAX_CHARS.items():
        value = (getattr(item, name) or "").strip()
        if value and len(value) <= limit:
            payload[name] = value
    return payload


def _gate_work(meta: AnswerMeta, ctx: GateContext) -> dict | None:
    if meta.work is None:
        return None
    if meta.kind != "work":
        logger.info("answer_meta work gated out: kind %s is not work", meta.kind)
        ctx.anatomy_dropped(field="work", reason="not_work_kind")
        return None
    report: dict = {}
    dropped = 0
    for section in WORK_SECTIONS:
        items = getattr(meta.work, section) or []
        kept = [payload for item in items if (payload := _work_item_payload(item)) is not None]
        dropped += len(items) - len(kept)
        if len(kept) > WORK_ITEMS_MAX:
            dropped += len(kept) - WORK_ITEMS_MAX
            kept = kept[:WORK_ITEMS_MAX]
        if kept:
            report[section] = kept
    if dropped:
        ctx.anatomy_dropped(field="work", reason="lines_dropped")
    return report or None


def drop_unfiled_proposals(payload: dict | None, filed: frozenset[str]) -> tuple[dict | None, int]:
    work = (payload or {}).get("work")
    if not isinstance(work, dict) or not work.get("proposed"):
        return payload, 0
    proposed = work["proposed"]
    kept = [line for line in proposed if str(line.get("ref") or "").strip().lower() in filed]
    dropped = len(proposed) - len(kept)
    if not dropped:
        return payload, 0
    rest = {section: lines for section, lines in work.items() if section != "proposed"}
    if kept:
        rest["proposed"] = kept
    trimmed = {key: value for key, value in (payload or {}).items() if key != "work"}
    if rest:
        trimmed["work"] = {section: rest[section] for section in WORK_SECTIONS if section in rest}
    return trimmed, dropped


@dataclass(frozen=True)
class AnatomyField:
    name: str
    gate: Callable[[AnswerMeta, GateContext], object | None]


ANATOMY_FIELDS: tuple[AnatomyField, ...] = (
    AnatomyField("kind", _gate_kind),
    AnatomyField("summary", _gate_summary),
    AnatomyField("verdict", _gate_verdict),
    AnatomyField("topic", _gate_topic),
    AnatomyField("context", _gate_context),
    AnatomyField("callout", _gate_callout),
    AnatomyField("takeaways", _gate_takeaways),
    AnatomyField("work", _gate_work),
)


def _object_end(raw: str, start: int) -> int | None:
    depth = 0
    in_string = False
    escaped = False
    for i in range(start, len(raw)):
        char = raw[i]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return i + 1
    return None


def _envelope_blocks(content: str) -> list[tuple[int, int, str]]:
    blocks: list[tuple[int, int, str]] = []
    position = 0
    while opening := _ANSWER_JSON_OPEN_RE.search(content, position):
        body_start = opening.end()
        brace = content.find("{", body_start)
        if brace != -1 and content[body_start:brace].strip():
            brace = -1
        end = _object_end(content, brace) if brace != -1 else None
        if end is None:
            lazy = _ANSWER_JSON_FENCE_RE.match(content, opening.start())
            if lazy is None:
                break
            blocks.append((lazy.start(), lazy.end(), lazy.group(1)))
            position = lazy.end()
            continue
        close = _FENCE_CLOSE_RE.match(content, end)
        block_end = close.end() if close else end
        blocks.append((opening.start(), block_end, content[body_start:end]))
        position = block_end
    return blocks


def _without_blocks(content: str, blocks: list[tuple[int, int, str]]) -> str:
    kept: list[str] = []
    position = 0
    for start, end, _ in blocks:
        kept.append(content[position:start])
        position = end
    kept.append(content[position:])
    return "".join(kept)


def _parse_object(raw: str) -> dict | None:
    try:
        payload = json.loads(raw, strict=False)
        return payload if isinstance(payload, dict) else None
    except json.JSONDecodeError, TypeError:
        pass
    start = raw.find("{")
    if start == -1:
        return None
    end = _object_end(raw, start)
    if end is None:
        return None
    try:
        payload = json.loads(raw[start:end], strict=False)
    except json.JSONDecodeError, TypeError:
        return None
    return payload if isinstance(payload, dict) else None


def _validated_meta(payload: dict) -> AnswerMeta | None:
    try:
        meta = AnswerMeta.model_validate(payload)
    except ValidationError as exc:
        logger.warning("answer envelope anatomy failed validation, dropped: %s", exc)
        return None
    return None if meta.empty else meta


_ANSWER_KEY_RE = re.compile(r'"answer"\s*:\s*(?=")')


def _recover_answer_string(raw: str) -> str | None:
    match = _ANSWER_KEY_RE.search(raw)
    if match is None:
        return None
    try:
        value, _end = json.JSONDecoder(strict=False).raw_decode(raw, match.end())
    except json.JSONDecodeError:
        return None
    return value.strip() if isinstance(value, str) and value.strip() else None


_PROSE_OUTSIDE_WARN_CHARS = 200


def extract_answer_envelope(content: object) -> tuple[object, AnswerMeta | None]:
    if not isinstance(content, str):
        return content, None

    blocks = _envelope_blocks(content)
    if blocks:
        payload = _parse_object(blocks[-1][2])
        if payload is None:
            answer = _recover_answer_string(blocks[-1][2])
            if answer:
                logger.warning(
                    "answer_json envelope is not parseable JSON; recovered its answer string, dropped the rest"
                )
                return answer, None
            logger.warning("answer_json envelope is not parseable JSON; leaving the reply untouched")
            return content, None
        answer = payload.get("answer")
        if isinstance(answer, str) and answer.strip():
            outside = _without_blocks(content, blocks).strip()
            if len(outside) > _PROSE_OUTSIDE_WARN_CHARS:
                logger.warning(
                    "answer_prose_outside_envelope: %d chars of prose outside the answer_json fence discarded",
                    len(outside),
                )
            return answer.strip(), _validated_meta(payload)
        stripped = _without_blocks(content, blocks).strip()
        if stripped:
            return stripped, _validated_meta(payload)
        logger.warning("answer_json envelope has no usable answer field; leaving the reply untouched")
        return content, None

    bare = content.strip()
    if bare.startswith("{") and bare.endswith("}"):
        payload = _parse_object(bare)
        if payload is not None:
            answer = payload.get("answer")
            if isinstance(answer, str) and answer.strip():
                return answer.strip(), _validated_meta(payload)

    headless = _salvage_headless(content)
    if headless is not None:
        return headless

    return content, None


_HEADLESS_TAIL_KEYS = frozenset(AnswerMeta.model_fields)

_HEADLESS_TAIL_RE = re.compile(r'"\s*,\s*(?="(?:' + "|".join(sorted(map(re.escape, _HEADLESS_TAIL_KEYS))) + r')"\s*:)')


def _salvage_headless(content: str) -> tuple[str, AnswerMeta | None] | None:
    head = content.lstrip()
    if head.startswith("{") or head.startswith(f"```{ENVELOPE_FENCE}"):
        return None
    body = re.sub(r"\n?```\s*$", "", content.rstrip()).rstrip()
    if not body.endswith("}"):
        return None
    split = _HEADLESS_TAIL_RE.search(body)
    payload = _headless_tail(body[split.end() :]) if split is not None else None
    if split is None or payload is None:
        return None
    prose = body[: split.start()].strip()
    if not prose or prose.count("{") > prose.count("}"):
        return None
    logger.warning(
        "answer_envelope_headless: salvaged an envelope whose opening was missing (%d chars of prose)", len(prose)
    )
    return prose, _validated_meta({**payload, "answer": prose})


def _headless_tail(tail: str) -> dict | None:
    try:
        payload, end = json.JSONDecoder(strict=False).raw_decode("{" + tail)
    except json.JSONDecodeError:
        return None
    if end != len(tail) + 1 or not isinstance(payload, dict) or not payload:
        return None
    if not payload.keys() <= _HEADLESS_TAIL_KEYS:
        return None
    if "kind" in payload and payload["kind"] not in ANSWER_KINDS:
        return None
    return payload


def gate_answer_meta(
    meta: AnswerMeta,
    *,
    prose_chars: int,
    agent_authored_documents: frozenset[str] = frozenset(),
    prose: str = "",
    record: bool = True,
) -> dict | None:
    ctx = GateContext(
        prose_chars=prose_chars, agent_authored_documents=agent_authored_documents, prose=prose, record=record
    )
    payload: dict = {}
    for field in ANATOMY_FIELDS:
        survived = field.gate(meta, ctx)
        if survived is not None:
            payload[field.name] = survived
    if not payload:
        return None
    return {"v": ENVELOPE_VERSION, **payload}


def resolve_callout_marker(prose: str, *, has_callout: bool) -> str:
    if CALLOUT_MARKER not in prose:
        return prose

    kept = False
    lines: list[str] = []
    for line in prose.split("\n"):
        if _CALLOUT_LINE_RE.match(line):
            if has_callout and not kept:
                kept = True
                lines.append(line)
            continue
        lines.append(_CALLOUT_INLINE_RE.sub("", line))
    return "\n".join(lines)


def _shape(model_cls: type[BaseModel]) -> str:
    parts: list[str] = []
    for name, info in model_cls.model_fields.items():
        annotation = info.annotation
        origin = getattr(annotation, "__args__", None)
        if annotation is str or (origin and str in origin):
            type_str = "string"
        elif getattr(annotation, "__origin__", None) is Literal or "Literal" in str(annotation):
            type_str = " | ".join(json.dumps(a) for a in annotation.__args__)  # type: ignore[union-attr]
        elif isinstance(annotation, type) and issubclass(annotation, BaseModel):
            type_str = _shape(annotation)
        elif origin:
            inner = next((a for a in origin if a is not type(None)), str)
            if isinstance(inner, type) and issubclass(inner, BaseModel):
                type_str = _shape(inner)
            else:
                type_str = "string"
        else:
            type_str = "string"
        req = "*" if info.is_required() else ""
        desc = f" ({info.description})" if info.description else ""
        parts.append(f"{name}{req}: {type_str}{desc}")
    return "{ " + ", ".join(parts) + " }"


def _strict_property(annotation: object, *, required: bool) -> dict:
    origin = get_origin(annotation)
    if origin is Union or origin is UnionType:
        members = [a for a in get_args(annotation) if a is not type(None)]
        nullable = len(members) < len(get_args(annotation)) or not required
        core: object = members[0]
    else:
        nullable = not required
        core = annotation

    schema: dict
    if core is str:
        schema = {"type": "string"}
    elif core is bool:
        schema = {"type": "boolean"}
    elif get_origin(core) is Literal:
        schema = {"type": "string", "enum": list(get_args(core))}
    elif isinstance(core, type) and issubclass(core, BaseModel):
        schema = _strict_object(core)
    elif get_origin(core) is list:
        (item,) = get_args(core)
        schema = {"type": "array", "items": _strict_property(item, required=True)}
    else:
        raise TypeError(f"envelope field type {annotation!r} has no strict-schema rendering")

    if not nullable:
        return schema
    if isinstance(schema.get("type"), str) and schema["type"] != "object" and "enum" not in schema:
        return {**schema, "type": [schema["type"], "null"]}
    return {"anyOf": [schema, {"type": "null"}]}


def _strict_object(model_cls: type[BaseModel]) -> dict:
    properties: dict[str, dict] = {}
    for name, info in model_cls.model_fields.items():
        extra = info.json_schema_extra if isinstance(info.json_schema_extra, dict) else {}
        if extra.get("strict_schema") == "omit":
            continue
        prop = _strict_property(info.annotation, required=info.is_required())
        if info.description:
            prop = {**prop, "description": info.description}
        properties[name] = prop
    return {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }


MASTHEAD_FIELDS = ("kind", "topic", "context", "verdict", "summary")


def _masthead_first(properties: dict) -> dict:
    head = {name: properties[name] for name in MASTHEAD_FIELDS if name in properties}
    answer = {"answer": properties["answer"]} if "answer" in properties else {}
    rest = {name: value for name, value in properties.items() if name not in head and name != "answer"}
    return {**head, **answer, **rest}


def render_envelope_response_format() -> dict:
    schema = _strict_object(AnswerMeta)
    schema["properties"] = _masthead_first(
        {
            "answer": {
                "type": "string",
                "description": "the full written answer: markdown prose with [N] citations and the sources section",
            },
            **schema["properties"],
        }
    )
    schema["required"] = list(schema["properties"])
    return {
        "type": "json_schema",
        "json_schema": {"name": "answer_envelope", "strict": True, "schema": schema},
    }


def _masthead_lines_first(lines: list[str]) -> list[str]:
    named = {line.split(":", 1)[0].rstrip("*"): line for line in lines}
    order = [*MASTHEAD_FIELDS, "answer"]
    head = [named[name] for name in order if name in named]
    return head + [line for line in lines if line not in head]


def render_envelope_schema() -> str:
    lines = [
        "answer*: string (the full written answer: markdown prose with [N] citations and the sources section)",
        f"confidence: {_shape(AnswerMetaConfidence)}",
        "escalate_to_deep: boolean (true when the question needs deep research: a commissioned report "
        "(never a document: a document is drafted, not researched), many sources to read against each "
        "other, or retrieved sources that cannot support an adequate answer)",
        "escalation_reason: string (with escalate_to_deep: one short clause saying why, in the answer's language)",
        f"skills_applied: [string] ({AnswerMeta.model_fields['skills_applied'].description})",
    ]
    field_models: dict[str, type[BaseModel] | None] = {
        "verdict": AnswerMetaVerdict,
        "callout": AnswerMetaCallout,
    }
    for field in ANATOMY_FIELDS:
        if field.name == "kind":
            kinds = " | ".join(json.dumps(k) for k in ANSWER_KINDS)
            lines.append(f"kind: {kinds}")
            continue
        if field.name == "takeaways":
            lines.append(f"takeaways: [{_shape(AnswerMetaTakeaway)}] (2-{TAKEAWAYS_MAX_ITEMS} items)")
            continue
        if field.name == "work":
            sections = ", ".join(
                f"{name}: [item] ({AnswerMetaWork.model_fields[name].description})" for name in WORK_SECTIONS
            )
            lines.append(
                f"work: {{ {sections} }} (only for kind=work; up to {WORK_ITEMS_MAX} lines each; "
                f"item = {_shape(AnswerMetaWorkItem)})"
            )
            continue
        model_cls = field_models.get(field.name)
        if model_cls is not None:
            suffix = " (only for kind=ruling)" if field.name == "verdict" else ""
            lines.append(f"{field.name}: {_shape(model_cls)}{suffix}")
            continue
        if field.name in AnswerMeta.model_fields:
            description = AnswerMeta.model_fields[field.name].description
            lines.append(f"{field.name}: string ({description})")
    cards_description = AnswerMeta.model_fields["cards"].description
    lines.append(f"cards: [ {{ type*: string, …the fields of that type }} ] ({cards_description})")
    lines = _masthead_lines_first(lines)
    rendered = "\n".join(f"  {line}" for line in lines)
    from agent.cards.envelope import render_envelope_cards_contract

    return rendered + "\n\nCARDS (the `cards` field):\n" + render_envelope_cards_contract()
