from __future__ import annotations

import hashlib
import json
import logging
import re
import uuid
from collections import OrderedDict
from collections.abc import Iterator
from contextvars import ContextVar
from contextvars import Token

from pydantic import BaseModel
from pydantic import ConfigDict

from agent.common.action_rows import current_action_call
from agent.common.licensed_recall import anchor_of
from agent.common.licensed_text import LicenceTerms
from agent.common.licensed_text import begin_licensed_capture
from agent.common.licensed_text import end_licensed_capture
from agent.common.licensed_text import licence_line
from agent.common.licensed_text import licensed_body
from agent.common.passage_fence import DATA_NOTE
from agent.common.passage_fence import fence
from agent.common.passage_fence import neutralise_tags
from agent.common.passage_fence import unfenced
from agent.common.provenance import AGENT_AUTHOR
from agent.common.provenance import AgentProvenance
from agent.common.provenance import provenance_label
from agent.common.source_kinds import MAIL_LANE_LABEL
from agent.common.source_kinds import MAIL_SOURCE_FORMAT
from agent.common.source_kinds import Shelf
from agent.common.source_records import SourceRegion
from agent.common.source_records import SourceRevision
from agent.common.turn_status import current_retrieval_round
from agent.common.turn_status import emit_step
from agent.common.wire_v2 import SourcesStep
from agent.common.wire_v2 import TraceLane

logger = logging.getLogger(__name__)

TRUNCATION_MARKER = "... [truncated]"


PROJECT_STATUS_LABELS: dict[str, str] = {"active": "laufend", "paused": "ruhend", "closed": "abgeschlossen"}


class SourceProject(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    name: str
    status: str
    federal_state_note: str | None = None


class GroundingHit(BaseModel):
    model_config = ConfigDict(frozen=True)

    citation_key: str
    file_name: str
    page: int | None
    shelf: Shelf | None
    collection: str | None
    doc_class: str | None
    display_title: str
    folder_path: str | None
    clause: str | None
    score: float
    content_type: str
    provenance: AgentProvenance | None
    stored_image_index: int | None
    status_note: str | None
    body: str
    body_truncated: bool = False
    project: SourceProject | None = None
    regions: tuple[SourceRegion, ...] = ()
    page_end: int | None = None
    source_format: str | None = None
    path: str | None = None
    licence: LicenceTerms | None = None
    work_id: str | None = None
    edition_id: str | None = None
    public_url: str | None = None
    revision: SourceRevision | None = None

    @property
    def authored_by(self) -> str | None:
        return AGENT_AUTHOR if self.provenance is not None else None


class GroundingBlock(BaseModel):
    model_config = ConfigDict(frozen=True)

    preamble: str
    degraded_banner: str
    hits: tuple[GroundingHit, ...]
    lanes: tuple[TraceLane, ...]
    tool: str
    trailer: str = ""
    coverage_gap: str | None = None


COVERAGE_GAP_LABEL = "Coverage: insufficient —"

COVERAGE_GAP_NOTE = (
    "No passage here states what was asked: say so and what you searched. That is not „Nicht geregelt“; "
    "the rule may sit in a source this search does not cover."
)

AGENT_DOCUMENT_NOTE = "what the office decided, never a source for a normative value"

TRACE_LANES_MARKER = "## Trace-Lanes"

_TRACE_LANES_RE = re.compile(rf"\n*{re.escape(TRACE_LANES_MARKER)}\n[^\n]*\n*")


def strip_trace_lanes(text: str) -> str:
    lanes = next(unfenced(_TRACE_LANES_RE, text), None)
    if lanes is None:
        return text
    stripped = f"{text[: lanes.start()]}\n\n{text[lanes.end() :]}"
    return stripped.rstrip("\n") + ("\n" if text.endswith("\n") else "")


def render_grounding_block(block: GroundingBlock) -> str:
    lines: list[str] = block.preamble.split("\n") if block.preamble else []
    if block.coverage_gap:
        lines.append(f"{COVERAGE_GAP_LABEL} {_line(block.coverage_gap).rstrip('.')}. {COVERAGE_GAP_NOTE}")
    lines.extend([DATA_NOTE, ""] if block.hits else [""])
    for index, hit in enumerate(block.hits, 1):
        lines.extend(_hit_lines(index, hit))
    lines.append("## Trace-Lanes")
    lines.append(_lanes_line(block.lanes))
    lines.append("")
    if block.trailer:
        lines.append(block.trailer)
    rendered = block.degraded_banner + "\n".join(lines)
    record_grounding_block(block, rendered)
    from agent.knowledge.restricted_use import note_collections_read

    note_collections_read(hit.collection for hit in block.hits)
    lanes = _nameable_lanes(block)
    if lanes:
        round_index = current_retrieval_round()
        step_id = f"sources:{round_index}:{block.tool}:{uuid.uuid4().hex[:8]}"
        emit_step(
            SourcesStep(
                id=step_id,
                round=round_index,
                tool=block.tool,
                lanes=lanes,
                call_id=current_action_call(),
            )
        )
    return rendered


def _nameable_lanes(block: GroundingBlock) -> list[TraceLane]:
    from agent.knowledge.restricted_use import may_name

    withheld = [hit.file_name for hit in block.hits if not may_name(hit.collection)]
    if not withheld:
        return list(block.lanes)
    named = {hit.file_name for hit in block.hits if may_name(hit.collection)}
    unnamed = {name for name in withheld if name not in named}
    lanes: list[TraceLane] = []
    for lane in block.lanes:
        kept = [source for source in lane.sources if source.name not in unnamed]
        if not kept:
            continue
        names = {source.name for source in lane.sources}
        dropped = sum(1 for name in withheld if name in names)
        hit_count = max(len(kept), lane.hit_count - dropped)
        lanes.append(lane.model_copy(update={"sources": kept, "hit_count": hit_count}))
    return lanes


def _lanes_line(lanes: tuple[TraceLane, ...]) -> str:
    return json.dumps(
        {
            "lanes": [
                {
                    "key": lane.key,
                    "label": lane.label,
                    "kind": lane.kind,
                    "hitCount": lane.hit_count,
                    "sources": [source.model_dump(exclude_none=True) for source in lane.sources],
                }
                for lane in lanes
            ]
        },
        ensure_ascii=False,
    )


def _hit_lines(index: int, hit: GroundingHit) -> list[str]:
    body = (hit.body + TRUNCATION_MARKER) if hit.body_truncated else hit.body
    anchor = anchor_of(hit.collection, hit.file_name, hit.page, len(body)) if hit.licence else None
    body = licensed_body(body, hit.licence, anchor=anchor)
    return [f"--- Result {index} ---", *_header_lines(hit), "", fence(body), ""]


def _header_lines(hit: GroundingHit) -> Iterator[str]:
    yield f"Source: {_capped(_line(hit.display_title))}"
    if hit.project is not None:
        yield f"Projekt: {_project_line(hit.project)}"
        if hit.project.federal_state_note:
            yield f"Bundesland: {_line(hit.project.federal_state_note)}"
    if hit.path:
        yield f"Path: {_key(hit.path)}"
    if hit.collection:
        yield f"Collection: {_key(hit.collection)}"
    if hit.shelf is not None:
        yield f"Shelf: {hit.shelf}"
    if hit.folder_path:
        yield f"Ordner: {_line(hit.folder_path)}"
    if hit.doc_class:
        yield f"Dokumentart: {_key(hit.doc_class)} — {_line(_doc_class_label(hit.doc_class))}"
    if hit.provenance is not None:
        yield f"Herkunft: {_line(provenance_label(hit.provenance))} — {AGENT_DOCUMENT_NOTE}"
    if hit.source_format:
        yield f"Format: {_key(hit.source_format)} — {_line(_source_format_label(hit.source_format))}"
    if hit.page is not None:
        yield f"Page: {hit.page}–{hit.page_end}" if hit.page_end and hit.page_end > hit.page else f"Page: {hit.page}"
    for region in hit.regions[:MAX_RENDERED_REGIONS]:
        yield _region_line(region)
    if hit.clause:
        yield f"Punkt: {_line(hit.clause)}"
    if hit.status_note:
        yield f"Rechtlicher Hinweis: {_line(hit.status_note)}"
    if licence := licence_line(hit.licence):
        yield f"Licence: {licence}"
    yield f"Citation: {_key(hit.citation_key)}"
    yield f"Content Type: {_key(hit.content_type)}"
    if hit.stored_image_index is not None:
        yield f"Image: stored (look image_index={hit.stored_image_index})"
    yield f"Relevance Score: {hit.score:.2f}"


MAX_RENDERED_REGIONS = 3


def _region_line(region: SourceRegion) -> str:
    x0, y0, x1, y1 = region.box
    numbers = ", ".join(f"{value:.3f}".rstrip("0").rstrip(".") for value in (x0, y0, x1 - x0, y1 - y0))
    label = f" „{_line(region.label)}“" if region.label else ""
    return f"Region: [{numbers}]{label}"


def _project_line(project: SourceProject) -> str:
    status = PROJECT_STATUS_LABELS.get(project.status, project.status)
    return f"{_line(project.name)} — {_line(status)} (project_id {_key(project.id)})"


MAX_SOURCE_TITLE_CHARS = 200

_MARKER_IN_VALUE_RE = re.compile(r"-{3,}(?=\s*Result\s+\d)", re.IGNORECASE)


def _capped(title: str) -> str:
    return title if len(title) <= MAX_SOURCE_TITLE_CHARS else f"{title[: MAX_SOURCE_TITLE_CHARS - 1].rstrip()}…"


def _key(value: str) -> str:
    return value.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")


def _line(value: str) -> str:
    return _MARKER_IN_VALUE_RE.sub("—", neutralise_tags(_key(value)))


def _source_format_label(source_format: str) -> str:
    return MAIL_LANE_LABEL if source_format == MAIL_SOURCE_FORMAT else source_format


def _doc_class_label(doc_class: str) -> str:
    from agent.knowledge.document_classification import DOCUMENT_CLASS_LABELS
    from agent.knowledge.document_classification import canonical_doc_class

    return DOCUMENT_CLASS_LABELS.get(canonical_doc_class(doc_class) or doc_class, doc_class)


_MAX_CAPTURED_BLOCKS = 64

_captured_blocks: ContextVar[OrderedDict[str, GroundingBlock] | None] = ContextVar(
    "captured_grounding_blocks", default=None
)


def begin_grounding_capture(*, licensed_text: bool = False) -> tuple[Token, Token]:
    return _captured_blocks.set(OrderedDict()), begin_licensed_capture(text_allowed=licensed_text)


def end_grounding_capture(token: tuple[Token, Token]) -> None:
    _captured_blocks.reset(token[0])
    end_licensed_capture(token[1])


def _fingerprint(rendered_text: str) -> str:
    return hashlib.sha256(rendered_text.encode("utf-8")).hexdigest()


def record_grounding_block(block: GroundingBlock, rendered_text: str) -> None:
    try:
        captured = _captured_blocks.get()
        if captured is None:
            return
        captured[_fingerprint(rendered_text)] = block
        while len(captured) > _MAX_CAPTURED_BLOCKS:
            captured.popitem(last=False)
    except Exception:  # noqa: BLE001 (filing must never take a turn down)
        logger.debug("Grounding block not recorded", exc_info=True)


def get_grounding_block(rendered_text: str) -> GroundingBlock | None:
    captured = _captured_blocks.get()
    if not captured:
        return None
    return captured.get(_fingerprint(rendered_text))
