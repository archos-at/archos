"""A grounding hit is a record; the text a tool returns is its rendering.

Every evidence tool answers in one grammar: a preamble, a run of
``--- Result N ---`` blocks, and a ``## Trace-Lanes`` object. Two packages used
to write that grammar by hand (``knowledge_layer.search.results.format_results`` and
``ris_adapter.lookup.render``) and a third read it back with eleven regexes on
every live turn. Three copies of one layout, in three repositories' worth of
review.

This module holds the layout once. A producer builds :class:`GroundingHit`
records and calls :func:`render_grounding_block`; the renderer emits the text
the model reads AND files the records under the hash of those exact bytes, so
the reader that later gets the text back can look the records up instead of
parsing them. The text is still the only thing that reaches the model, and it
is byte-for-byte what it was. See ADR-0061.

The lookup is per turn and per context: :func:`begin_grounding_capture` opens
it where the turn's other captures open (``turn_status.begin_lane_capture``),
and a miss is normal, not an error. A stored turn replayed from Postgres, a
cached registry and the job runner's callback all hold the text without the
records, so ``citations.text_parsers`` keeps its text parsers for them.
"""

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
    """The project a hit from ANOTHER project came from (ADR-0094).

    Only the cross-project lookup sets it: every other hit comes from the
    turn's own scope and names no project. Rendered as the ``Projekt:`` line,
    so the model can say where a passage is from and look the project up, and
    carried to the source chip, so the reader can see it and open the document
    in its own project.
    """

    model_config = ConfigDict(frozen=True)

    id: str
    name: str
    status: str
    federal_state_note: str | None = None


class GroundingHit(BaseModel):
    """One citable passage, as data, before anything renders it.

    Carries what a ``SourceEntry`` needs plus what the block's header lines
    need, and nothing else. Two fields are worth reading twice:

    ``shelf`` has NO default. ADR-0047 says a shelf is stated by the producer
    or is unknown, never re-derived from a collection id, and the ``Shelf:``
    line is omitted for an unknown one, so the reader sees the absence.

    ``doc_class`` is the RAW key (``gesetz``), never the ``key — label`` line
    the renderer builds from it. The label is German rendering; the key is what
    ``lane_for_hit`` reads first.
    """

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
        """``"agent"`` for an agent-authored document, ``None`` for everything else.

        Derived rather than stored so it cannot disagree with
        :attr:`provenance`. Fails CLOSED the way the text path does: unknown
        and human are the same value here, and only a parsed provenance buys a
        document its agent lane and its verdict ban.
        """
        return AGENT_AUTHOR if self.provenance is not None else None


class GroundingBlock(BaseModel):
    """A whole tool result: what the hits are, and what frames them."""

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
    """The block without its ``## Trace-Lanes`` line: what the MODEL reads.

    The lanes reach the Herleitung as the ``sources`` step the renderer emits,
    and the citation registry reads the records the renderer filed under the
    block's bytes before anything strips them. The model reads neither; it reads the passages and
    the ``Citation:`` keys. Yet the line travelled in every ``ToolMessage``, so
    a search with sixteen hits put ~1 000 tokens of ``{"lanes": …}`` into the
    transcript and re-sent them on every later call of the turn, and into the
    next turn's history. The passages, the keys and the trailer (``##
    Gliederung``) stay byte-for-byte; only the one line goes, and never a line
    a passage body spells inside its fence. Idempotent, and text with no marker
    is returned unchanged.
    """
    lanes = next(unfenced(_TRACE_LANES_RE, text), None)
    if lanes is None:
        return text
    stripped = f"{text[: lanes.start()]}\n\n{text[lanes.end() :]}"
    return stripped.rstrip("\n") + ("\n" if text.endswith("\n") else "")


def render_grounding_block(block: GroundingBlock) -> str:
    """The block as the text a model reads, filed under the hash of that text.

    The one place the grammar's line order and spacing live. Recording, the
    ``sources`` step and reporting the hits' collections to the restricted-use
    admission are done HERE rather than by the callers, so a producer cannot
    emit a block and forget to make it readable back, leave it out of the
    Herleitung, or return a restricted passage unadmitted. That step is one
    producer site for every evidence tool, and it is built from the records,
    never read back out of the text.
    """
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
    """The block's lanes as the ``sources`` step may show them: a document only once the model may be told of it.

    The step is emitted inside the tool, before the round's results are
    admitted, and a stored step is read by everyone the conversation is shared
    with later. So a document of a restricted folder this turn has not admitted
    (:func:`~agent.knowledge.restricted_use.may_name`) leaves the lane, and
    its hits leave the lane's count: listing is not use (ADR-0088). The rows of
    the same calls follow the same rule (``ActionOutcome.record``). A lane left
    with no document goes; the ``## Trace-Lanes`` line in the text is untouched,
    since the text itself is withheld by the admission.
    """
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
    """The ``## Trace-Lanes`` JSON in the spelling the model has always read.

    Deep research's model still reads this line (F2 in chat-wire-v2.md), so
    its keys stay what they were until that change runs the answer suite.
    """
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
    """One ``--- Result N ---`` block: header, blank line, the fenced body (``common/passage_fence.py``), blank line."""
    body = (hit.body + TRUNCATION_MARKER) if hit.body_truncated else hit.body
    anchor = anchor_of(hit.collection, hit.file_name, hit.page, len(body)) if hit.licence else None
    body = licensed_body(body, hit.licence, anchor=anchor)
    return [f"--- Result {index} ---", *_header_lines(hit), "", fence(body), ""]


def _header_lines(hit: GroundingHit) -> Iterator[str]:
    """The header, in order. An optional field with no value emits no line.

    The absence is the message: a reader must see that a hit stated no shelf,
    no Dokumentart and no folder, rather than read a default the pipeline
    picked. ``Relevance Score:`` is last because it delimits the body.

    Every string value is made one line: a header field is one line by
    definition, and some come from a document's own text. Free text (a title, a
    folder) goes through :func:`_line`; a key a tool takes back (``Path:``,
    ``Citation:``, the codes, the project id) through :func:`_key`, so it
    round-trips. Numbers and the ``Shelf`` enum cannot carry a newline.
    """
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
    """``Region: [x, y, w, h] „label“``: the box in the numbers ``look(region=...)`` takes.

    ``SourceRegion.box`` is ``(x0, y0, x1, y1)``; ``look`` wants origin and
    size, in the same frame (the page as shown, top left origin), so the
    conversion is the only thing this line does. Rounded to three places: a
    share of a sheet is a model's approximation, not a measurement.
    """
    x0, y0, x1, y1 = region.box
    numbers = ", ".join(f"{value:.3f}".rstrip("0").rstrip(".") for value in (x0, y0, x1 - x0, y1 - y0))
    label = f" „{_line(region.label)}“" if region.label else ""
    return f"Region: [{numbers}]{label}"


def _project_line(project: SourceProject) -> str:
    """``Name — abgeschlossen (project_id …)``: what the model reads, and the text reader parses back."""
    status = PROJECT_STATUS_LABELS.get(project.status, project.status)
    return f"{_line(project.name)} — {_line(status)} (project_id {_key(project.id)})"


MAX_SOURCE_TITLE_CHARS = 200

_MARKER_IN_VALUE_RE = re.compile(r"-{3,}(?=\s*Result\s+\d)", re.IGNORECASE)


def _capped(title: str) -> str:
    """``title``, cut to :data:`MAX_SOURCE_TITLE_CHARS` with an ellipsis when longer."""
    return title if len(title) <= MAX_SOURCE_TITLE_CHARS else f"{title[: MAX_SOURCE_TITLE_CHARS - 1].rstrip()}…"


def _key(value: str) -> str:
    """``value`` as ONE header line: every line break becomes a single space, nothing else changes.

    A header field states what the HIT says. A value that carries a newline
    would render as further header lines, and the text reader would then read a
    ``Shelf:`` or a ``Dokumentart:`` off a title the producer took out of a
    document. The structured reader copies fields and never sees this, so the
    collapse is what keeps the two readers on one answer. A value with no line
    break is returned unchanged: a path or a citation key a tool takes back
    must reach it byte for byte, and the byte-identity fixtures still hold.
    """
    return value.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")


def _line(value: str) -> str:
    """Free text (a title, a folder, a label) as ONE header line (:func:`_key`), read as the name it is.

    A fence tag it spells is escaped and a spelled ``--- Result N`` made one
    dash. Never for a key a tool takes back: that would break its round trip;
    mid-line, neither acts as grammar, since every reader anchors them.
    """
    return _MARKER_IN_VALUE_RE.sub("—", neutralise_tags(_key(value)))


def _source_format_label(source_format: str) -> str:
    """The label a format renders under: the mail lane's (``E-Mail``), or the token itself."""
    return MAIL_LANE_LABEL if source_format == MAIL_SOURCE_FORMAT else source_format


def _doc_class_label(doc_class: str) -> str:
    """The German label for a doc_class key, or the key when it has none.

    Imported here rather than at module scope: ``agent.knowledge`` pulls in
    the retriever factory, and this module is on the import path of the tool
    tier that must load without it.
    """
    from agent.knowledge.document_classification import DOCUMENT_CLASS_LABELS
    from agent.knowledge.document_classification import canonical_doc_class

    return DOCUMENT_CLASS_LABELS.get(canonical_doc_class(doc_class) or doc_class, doc_class)


_MAX_CAPTURED_BLOCKS = 64

_captured_blocks: ContextVar[OrderedDict[str, GroundingBlock] | None] = ContextVar(
    "captured_grounding_blocks", default=None
)


def begin_grounding_capture(*, licensed_text: bool = False) -> tuple[Token, Token]:
    """Start filing this turn's blocks and licensed passages; ``licensed_text`` is the ``licensed-seam`` flag."""
    return _captured_blocks.set(OrderedDict()), begin_licensed_capture(text_allowed=licensed_text)


def end_grounding_capture(token: tuple[Token, Token]) -> None:
    """Stop filing blocks, and drop the blocks and licensed passages this turn filed."""
    _captured_blocks.reset(token[0])
    end_licensed_capture(token[1])


def _fingerprint(rendered_text: str) -> str:
    """The key a block is filed and found under: a hash of its exact bytes."""
    return hashlib.sha256(rendered_text.encode("utf-8")).hexdigest()


def record_grounding_block(block: GroundingBlock, rendered_text: str) -> None:
    """File ``block`` under its rendering. No-op when nothing is capturing.

    Best-effort by contract, like the lane capture it is modelled on: a tool
    result must not fail because its records could not be filed. The reader
    falls back to parsing the text, which is what it did before this existed.
    """
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
    """The records behind this exact text, or ``None``.

    ``None`` is the ordinary answer outside a live turn, for a replayed message,
    a cached registry or the job runner, and for text a producer decorated after
    rendering. The caller parses the text in that case.
    """
    captured = _captured_blocks.get()
    if not captured:
        return None
    return captured.get(_fingerprint(rendered_text))
