from __future__ import annotations

import logging
import re
from collections.abc import Callable
from dataclasses import dataclass

from agent.common.answer_envelope import CONTEXT_MAX_CHARS
from agent.common.answer_envelope import ENVELOPE_VERSION
from agent.common.answer_envelope import SUMMARY_MAX_CHARS
from agent.common.answer_envelope import TAKEAWAYS_MAX_ITEMS
from agent.common.answer_envelope import TAKEAWAYS_MIN_PROSE_CHARS
from agent.common.answer_envelope import TOPIC_MAX_CHARS
from agent.common.answer_envelope import VERDICT_VALUE_MAX_CHARS
from agent.common.answer_envelope import WORK_FIELD_MAX_CHARS
from agent.common.answer_envelope import WORK_ITEMS_MAX
from agent.common.answer_envelope import WORK_SECTIONS
from agent.common.answer_envelope import WORK_TEXT_MAX_CHARS
from agent.common.answer_envelope import AnswerMeta
from agent.common.answer_envelope import AnswerMetaReference
from agent.common.answer_envelope import AnswerMetaTakeaway
from agent.common.answer_envelope import AnswerMetaVerdict
from agent.common.answer_envelope import AnswerMetaWorkItem
from agent.common.provenance import normalize_document_name
from agent.common.turn_notices import VERDICT_DROP_AGENT_AUTHORED
from agent.common.turn_notices import VERDICT_DROP_UNREFERENCED_WITH_AGENT_SOURCE
from agent.common.turn_notices import emit_anatomy_dropped
from agent.common.turn_notices import emit_verdict_dropped

logger = logging.getLogger(__name__)

_MIN_MATCHABLE_NAME_CHARS = 4


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
