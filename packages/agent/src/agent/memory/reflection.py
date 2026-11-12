"""The memory-reflection pass itself: prompt, sanitisation, and the writes.

The in-turn ``remember`` tool captures findings while the agent is still
answering, but a busy answer often ends before the agent pauses to consolidate
what the exchange actually established. This module reads the just-finished
exchange and the project's EXISTING memory digest (the ``x-grid-project-memory``
the BFF injects), asks a small LLM whether the turn established any NEW durable
finding the in-turn tool missed, and writes each qualifying item through the same
token-guarded internal endpoint the ``remember`` tool uses (``app`` stays
single-writer).

**Scheduling does not live here.** Reflection is a *post-answer stage*, and how a
stage is gated, bounded, made concurrent and recorded is the primitive's job, not
this module's — see ``agent/stages/memory_reflection.py`` for the
declaration and ``agent/stages/runner.py`` for the timeout, the shared
semaphore, the pending cap and the outcome span. This module is the body of the
handler and nothing else.

Design guarantees kept here:
- **Never crashes the turn on a finding.** A write that fails is logged and
  dropped; the worst outcome is that no memory is recorded. A provider fault on
  the one LLM call propagates to the stage runner, which owns the timeout and
  the failure span — swallowing it here would only hide the outage.
- **Context-free execution.** All request-scoped values (ids, digest, text) are
  passed in explicitly, so the pass is safe to run after the request context has
  been torn down.

See docs/architecture/project-memory-design.md and
docs/architecture/post-answer-stages.md.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any
from typing import Literal

from langchain_core.messages import HumanMessage
from langchain_core.messages import SystemMessage
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import ValidationError
from pydantic import model_validator

from agent.common.bff_http import SignedEnvelope
from agent.common.json_utils import extract_json
from agent.common.structured_reply import structured_reply
from agent.knowledge.personal_memory import VALID_PERSONAL_KINDS
from agent.knowledge.personal_memory import forget_personal_memory_item
from agent.knowledge.personal_memory import insert_personal_memory_item
from agent.knowledge.project_memory import VALID_CONFIDENCES
from agent.knowledge.project_memory import insert_memory_item
from agent.knowledge.project_memory import looks_like_personal_data
from agent.knowledge.project_memory import looks_like_secret
from agent.memory.reflection_prompt import MAX_NEW_ITEMS
from agent.memory.reflection_prompt import REFLECTION_SYSTEM_PROMPT
from agent.memory.restriction import RestrictionDecision
from agent.memory.restriction import RestrictionEvidence
from agent.memory.restriction import restriction_decisions

logger = logging.getLogger(__name__)

_MAX_CONTENT_CHARS = 500
_MAX_ANSWER_CHARS = 4000
_MAX_QUERY_CHARS = 2000
# The existing memory digest grows as project memory accumulates; every other
# input to this prompt is already sliced, so cap the digest too — otherwise the
# background reflection LLM call's token cost grows unbounded with memory size.
# Head-sliced to match the query/answer slices above (the digest's ordering is
# owned by the BFF, so we don't assume newest-first/last).
_MAX_DIGEST_CHARS = 6000
#: The personal block is at most 1,500 characters on the wire (ADR-0180).
_MAX_PERSONAL_CHARS = 1600
#: The rating a finding gets when the model did not supply a usable one. The
#: recall scorer weighs salience at 2 of 5.5 total, so the midpoint leaves the
#: finding neutral rather than wrong.
_NEUTRAL_IMPORTANCE = 5


def _lowered(value: Any) -> Any:
    """A trimmed, lowercased copy of a string; anything else untouched."""
    return value.strip().lower() if isinstance(value, str) else value


def _one_of(value: Any, allowed: set[str], fallback: str) -> str:
    """``value`` folded into ``allowed``, or ``fallback`` when it is not in it."""
    text = _lowered(value)
    return text if text in allowed else fallback


#: The kinds that say on their own that a finding is about the project. A
#: ``preference`` does not: it may be the team's or one person's.
_PROJECT_ONLY_KINDS = frozenset({"decision", "constraint", "open_question", "derived_fact"})


def _about(value: Any, kind: Any) -> str | None:
    """Whose shelf a finding belongs on: ``project``, ``person``, or None when nothing says.

    The model's ``about`` decides when it is readable. When it is not, the kind
    may: the four project kinds are the project's, and ``profile`` exists only
    in personal memory. A ``preference`` with no usable ``about`` gets None and
    is dropped (ADR-0180): a personal note on the team's shelf is the harm, a
    lost note is not.
    """
    about = _lowered(value)
    if about in ("project", "person"):
        return about
    if kind in _PROJECT_ONLY_KINDS:
        return "project"
    return "person" if kind == "profile" else None


def _clamped_importance(value: Any) -> int:
    """``value`` as an importance rating in 1..10, defaulting when unreadable."""
    try:
        importance = int(value)
    except TypeError, ValueError:
        return _NEUTRAL_IMPORTANCE
    return min(10, max(1, importance))


class _ReflectionFinding(BaseModel):
    """One durable finding proposed by the reflection stage, about the project or about the person."""

    # ``forbid`` is what makes the generated json_schema carry
    # ``additionalProperties: false``, which OpenRouter's strict mode requires.
    # Parsing stays forgiving via the validator below, so the strict wire
    # contract never costs a usable finding on the plain-call fallback.
    model_config = ConfigDict(extra="forbid")

    about: Literal["project", "person"] = Field(
        description=(
            "Whom the finding is about. 'person': the person asking (how they want the assistant to work, "
            "their role, responsibilities, recurring topics, anything said in confidence); kept where only "
            "they read it. 'project': the project itself; read by every member of the project."
        )
    )
    kind: Literal["decision", "constraint", "open_question", "derived_fact", "preference", "profile"] = Field(
        description=(
            "Finding category. About the person: 'preference' or 'profile'. About the project: 'decision', "
            "'constraint', 'open_question', 'derived_fact', or 'preference' for how the team wants the "
            "assistant to work on this project."
        )
    )
    content: str = Field(
        description="One concise, self-contained sentence. Empty only to remove the personal note named in supersedes."
    )
    confidence: Literal["low", "medium", "high"] = Field(description="Confidence in the finding.")
    importance: int = Field(
        ge=1,
        le=10,
        description=(
            "How much future answers depend on this finding, 1-10. 1-3: incidental detail "
            "(a preference about wording). 4-6: useful context. 7-8: shapes answers "
            "(a chosen construction method, a binding constraint). 9-10: getting this wrong "
            "invalidates answers (the Bundesland, the building class, a legal deadline)."
        ),
    )
    supersedes: str = Field(
        description=(
            "When this finding CORRECTS an entry in the existing memory shown to you, the "
            "verbatim content of that entry, copied exactly. Empty string when the finding "
            "adds something new instead of replacing anything."
        )
    )

    @model_validator(mode="before")
    @classmethod
    def _tolerate_a_loose_reply(cls, data: Any) -> Any:
        """Read forgivingly what the wire schema declares strictly.

        A reply that came back through native structured output already fits.
        The fallback path (no ``response_format``) does not: a model writes
        ``"High"``, omits ``importance``, or adds a key the prompt never asked
        for, and each of those used to be handled by 40 lines of imperative
        coercion downstream. Folded here, one validated model is the only shape
        the rest of this module handles. Only ``kind`` has no safe default — a
        guessed category mislabels the row — so an unreadable one still fails.
        """
        if not isinstance(data, dict):
            return data
        known = {key: value for key, value in data.items() if key in cls.model_fields}
        known["kind"] = _lowered(known.get("kind"))
        # Unreadable and undecidable stays None and fails validation: dropped.
        known["about"] = _about(known.get("about"), known["kind"])
        if known["about"] == "person" and known["kind"] not in VALID_PERSONAL_KINDS:
            # Personal memory has two kinds; whatever else was named is a fact about the person.
            known["kind"] = "profile"
        known["content"] = str(known.get("content") or "").strip()[:_MAX_CONTENT_CHARS]
        known["confidence"] = _one_of(known.get("confidence"), VALID_CONFIDENCES, "medium")
        # Importance, elicited at write time the way Generative Agents rates
        # poignancy: one integer from the SAME structured call, so it costs
        # nothing extra. Stored as salience in [0,1].
        known["importance"] = _clamped_importance(known.get("importance"))
        known["supersedes"] = str(known.get("supersedes") or "").strip()
        return known


class ReflectionOutput(BaseModel):
    """Strict structured-output contract for the memory-reflection stage.

    Strict-valid (all fields required, no extras) so it can drive OpenRouter
    native json_schema structured output. ``findings`` is an empty list when the
    turn established nothing durable — the common, correct outcome.
    """

    model_config = ConfigDict(extra="forbid")

    findings: list[_ReflectionFinding] = Field(description="Durable findings; empty list if none.")


def _build_user_prompt(query: str, answer: str, memory_digest: str | None, personal_memory: str | None = None) -> str:
    """Assemble the reflection prompt from the turn and the existing memory."""
    existing = memory_digest.strip() if memory_digest else "(no project memory recorded yet)"
    if len(existing) > _MAX_DIGEST_CHARS:
        existing = existing[:_MAX_DIGEST_CHARS] + "\n… (project memory truncated)"
    # Bounded by the BFF and again at intake (``turn/context_client.py``); cut here for any other caller.
    personal = (personal_memory or "").strip()[:_MAX_PERSONAL_CHARS] or "(no personal memory recorded yet)"
    return (
        "## Existing project memory\n"
        f"{existing}\n\n"
        "## Existing personal memory of the person asking\n"
        f"{personal}\n\n"
        "## User question\n"
        f"{query.strip()[:_MAX_QUERY_CHARS]}\n\n"
        "## Assistant answer\n"
        f"{answer.strip()[:_MAX_ANSWER_CHARS]}"
    )


def _normalize(text: str) -> str:
    """Lowercase + collapse whitespace + drop non-alphanumerics, for cheap dedup."""
    return re.sub(r"[^a-z0-9äöüß]+", " ", text.lower()).strip()


#: One rendered digest line: ``- [kind | confidence | verification] "content"``
#: (the BFF's ``formatDigestLines``). The content group is the whole quoted body.
_DIGEST_ENTRY_RE = re.compile(r'^\s*-\s*\[[^\]]*\]\s*"(.*)"\s*$')


def _digest_entry_contents(memory_digest: str | None) -> frozenset[str]:
    """Normalized contents of the COMPLETE entries displayed in the digest.

    A supersede quote must name one whole entry: a substring check would accept
    a truncated quote ("Client chose a flat" for "Client chose a flat roof"),
    which the frontend's fuzzy resolver would then happily resolve — retiring an
    entry the model never actually quoted.

    No unescaping needed: ``_normalize`` drops the backslashes and quotes
    ``formatDigestLines`` adds.
    """
    matches = (_DIGEST_ENTRY_RE.match(line) for line in (memory_digest or "").splitlines())
    return frozenset(filter(None, (_normalize(match.group(1)) for match in matches if match)))


def _content_in_digest(content: str, normalized_digest: str) -> bool:
    """True when a finding is already (near-)present in the digest it was shown.

    A cheap normalized-substring guard so the stage cannot re-store an item that
    was literally in front of the LLM. It does NOT catch semantic paraphrase or
    items outside the bounded digest — full de-duplication is the write-time
    consolidation gate (design §3.2), still a follow-up.

    ``normalized_digest`` is ``_normalize``d once by the caller: the digest runs
    to ~6 kB and every finding in a batch asks the same question of it.
    """
    normalized_content = _normalize(content)
    return bool(normalized_content) and normalized_content in normalized_digest


def _person_finding(
    finding: _ReflectionFinding,
    *,
    normalized_personal: str,
    can_write_personal: bool,
    personal_entries: frozenset[str] = frozenset(),
) -> _ReflectionFinding | None:
    """A finding about the person as it may be written to their personal memory, or None."""
    if not can_write_personal:
        # No signed envelope names the person (a worker run, an eval): there is
        # no personal memory to write to, and the project's is not a fallback.
        logger.info("Memory reflection: dropped a personal finding; no envelope names its owner")
        return None
    # A quote retires a personal note only when it names one whole note the
    # model was shown; anything else is dropped from the finding, as for project memory.
    if finding.supersedes and _normalize(finding.supersedes) not in personal_entries:
        logger.info("Memory reflection: ignoring a supersedes quote that is not a shown personal note")
        finding = finding.model_copy(update={"supersedes": ""})
    if not finding.content:
        # A removal alone: the person asked to drop a note. Nothing left to drop is nothing to do.
        return finding if finding.supersedes else None
    if _content_in_digest(finding.content, normalized_personal):
        return None
    # A note about the person is the point, so the contact shapes pass; a secret never does.
    if looks_like_secret(finding.content):
        logger.warning("Memory reflection: dropped a personal %s finding matching a secret pattern", finding.kind)
        return None
    return finding


def _finding_from_entry(
    entry: Any,
    *,
    normalized_digest: str,
    digest_entries: frozenset[str],
    normalized_personal: str = "",
    can_write_personal: bool = False,
    personal_entries: frozenset[str] = frozenset(),
) -> _ReflectionFinding | None:
    """One insertable finding from a proposed entry, or None when it does not qualify.

    Drops anything malformed, out-of-vocabulary, empty, already present in the
    digest, without a usable ``about``, or matching a PII/secret shape (audit
    finding S4). The guard runs HERE and not only at the write endpoint so a
    dropped finding never counts against ``MAX_NEW_ITEMS``.
    """
    try:
        finding = _ReflectionFinding.model_validate(entry)
    except ValidationError:
        return None
    if finding.about == "person":
        # Before the digest check: a removal has no content to find there.
        if finding.content and _content_in_digest(finding.content, normalized_digest):
            return None
        return _person_finding(
            finding,
            normalized_personal=normalized_personal,
            can_write_personal=can_write_personal,
            personal_entries=personal_entries,
        )
    if not finding.content:
        return None
    # Never re-store something already sitting in the digest we showed the LLM
    # (its `this turn` lines hold what the tool wrote to either memory).
    if _content_in_digest(finding.content, normalized_digest):
        return None
    if finding.kind == "profile":
        # Contradicts itself: `profile` is a personal kind. Not guessed either way.
        return None
    if looks_like_personal_data(finding.content):
        logger.warning("Memory reflection: dropped a %s finding matching a PII/secret pattern", finding.kind)
        return None
    # A supersede quote retires an existing entry, so it is only honoured when it
    # names one COMPLETE entry of the digest the model was shown. A hallucinated,
    # paraphrased or truncated quote is dropped (the finding is still recorded)
    # rather than sent on to be fuzzy-matched against a real item — the ≥0.7
    # Jaccard resolver would resolve a partial quote too.
    if not finding.supersedes or _normalize(finding.supersedes) in digest_entries:
        return finding
    logger.info("Memory reflection: ignoring a supersedes quote that is not a shown digest entry")
    return finding.model_copy(update={"supersedes": ""})


def _sanitize_findings(
    raw: Any,
    *,
    has_project: bool,
    memory_digest: str | None = None,
    personal_memory: str | None = None,
    can_write_personal: bool = False,
) -> list[_ReflectionFinding]:
    """Validate LLM-proposed findings into insertable project or personal items.

    The autonomous reflection stage never writes ``organization`` scope.
    Firm-wide memory poisons every project in the tenant and there is no
    write-time authorization gate or human review, so org-wide writes stay a
    deliberate, human-driven action (audit finding S1). A finding about the
    person is kept only when ``can_write_personal`` (ADR-0180).

    The cap applies to what SURVIVES the filters, not to what the model
    proposed: a dropped finding must not cost a real one its slot.
    """
    if not isinstance(raw, list) or not has_project:
        return []
    checks = {
        "normalized_digest": _normalize(memory_digest or ""),
        "digest_entries": _digest_entry_contents(memory_digest),
        "normalized_personal": _normalize(personal_memory or ""),
        "can_write_personal": can_write_personal,
        "personal_entries": _digest_entry_contents(personal_memory),
    }
    proposed = (_finding_from_entry(entry, **checks) for entry in raw)
    return [finding for finding in proposed if finding is not None][:MAX_NEW_ITEMS]


async def _write_personal_finding(
    finding: _ReflectionFinding, *, envelope: SignedEnvelope | None, conversation_id: str | None
) -> dict[str, str] | None:
    """Record one finding about the person in their personal memory, never the project's (ADR-0180).

    A finding that names a note in ``supersedes`` removes it first, and is
    written only once it is gone: a correction never stands beside the note it
    contradicts. A finding with no content is that removal alone.
    """
    if envelope is None:
        return None
    if finding.supersedes:
        forgot = await asyncio.to_thread(forget_personal_memory_item, envelope=envelope, content=finding.supersedes)
        if forgot.removed_id is None:
            logger.info("Memory reflection: a personal correction was not written; its note was %s", forgot.refused)
            return None
        logger.info("Memory reflection: removed personal note %s", forgot.removed_id)
    if not finding.content:
        return None
    written = await asyncio.to_thread(
        insert_personal_memory_item,
        envelope=envelope,
        kind=finding.kind,
        content=finding.content,
        conversation_id=conversation_id,
        provenance_type="distillation",
    )
    if written is None:
        return None
    return {"id": written.id, "kind": finding.kind, "content": finding.content, "about": "person"}


async def _write_finding(
    finding: _ReflectionFinding,
    *,
    project_id: str | None,
    organization_id: str | None,
    conversation_id: str | None,
    decision: RestrictionDecision | None = None,
    envelope: SignedEnvelope | None = None,
) -> dict[str, str] | None:
    """Record one finding, returning the row it became, or None if it did not land."""
    if finding.about == "person":
        return await _write_personal_finding(finding, envelope=envelope, conversation_id=conversation_id)
    decision = decision or RestrictionDecision(None)
    item_id = await asyncio.to_thread(
        insert_memory_item,
        # Always project scope — org-wide writes are excluded (audit S1).
        scope="project",
        project_id=project_id,
        organization_id=organization_id,
        kind=finding.kind,
        content=finding.content,
        confidence=finding.confidence,
        conversation_id=conversation_id,
        # Tag reflection writes so the UI can distinguish them from a
        # deliberate in-turn `remember` ('agent') call.
        provenance_type="distillation",
        salience=round(finding.importance / 10.0, 2),
        # Retires the entry this finding corrects (frontend resolves the quote;
        # unresolvable or human-curated targets are left alone).
        supersedes_content=finding.supersedes or None,
        # ADR-0087: a finding from a turn that could read restricted folders
        # is served only to people cleared for the ones it draws on.
        restricted_collections=decision.restriction,
        # The judge's verdict, audited by the BFF with the item (AI Act).
        restriction_judge=decision.judge.as_payload() if decision.judge else None,
    )
    if not item_id:
        return None
    if finding.supersedes:
        logger.info("Memory reflection: recorded %s item %s as a correction", finding.kind, item_id)
    return {"id": item_id, "kind": finding.kind, "content": finding.content, "about": "project"}


async def _record_findings(
    findings: list[_ReflectionFinding],
    *,
    project_id: str | None,
    organization_id: str | None,
    conversation_id: str | None,
    decisions: list[RestrictionDecision] | None = None,
    envelope: SignedEnvelope | None = None,
) -> list[dict[str, str]]:
    """Write every finding concurrently, keeping the rows that landed, in order.

    The writes are independent HTTP round trips against one endpoint, so they
    are gathered rather than walked: five sequential 5s-timeout calls inside a
    45s stage budget is the whole batch riding on the slowest link. Order is
    preserved, which the frame's "in write order" contract depends on. Two
    near-duplicate findings in one batch now race the BFF's dedup; the partial
    UNIQUE indexes make the loser an error that is logged and dropped, the same
    outcome the sequential second write reached by merging.
    """
    decisions = decisions if decisions is not None else [RestrictionDecision(None)] * len(findings)
    results = await asyncio.gather(
        *(
            _write_finding(
                finding,
                project_id=project_id,
                organization_id=organization_id,
                conversation_id=conversation_id,
                decision=decision,
                envelope=envelope,
            )
            for finding, decision in zip(findings, decisions, strict=True)
        ),
        return_exceptions=True,
    )
    recorded: list[dict[str, str]] = []
    for finding, result in zip(findings, results, strict=True):
        if isinstance(result, BaseException):
            logger.warning("Memory reflection: failed to record a %s finding (%r)", finding.kind, result)
        elif result is not None:
            recorded.append(result)
    return recorded


async def _project_restrictions(
    findings: list[_ReflectionFinding], restriction: RestrictionEvidence | None, llm: Any
) -> list[RestrictionDecision]:
    """One restriction decision per finding, in order: judged for the project's, open for the person's.

    A personal note is read by the one person who was in the turn, so it is
    never restricted-folder memory and never costs a judge call (ADR-0180).
    """
    project = [finding for finding in findings if finding.about == "project"]
    judged = iter(
        await restriction_decisions(
            [finding.content for finding in project], restriction or RestrictionEvidence(), llm=llm
        )
        if project
        else []
    )
    return [next(judged) if finding.about == "project" else RestrictionDecision(None) for finding in findings]


async def run_memory_reflection(
    *,
    llm: Any,
    query: str,
    answer: str,
    project_id: str | None,
    organization_id: str | None,
    conversation_id: str | None,
    memory_digest: str | None,
    restriction: RestrictionEvidence | None = None,
    personal_memory: str | None = None,
    envelope: SignedEnvelope | None = None,
) -> list[dict[str, str]]:
    """Run one reflection pass and record any qualifying findings.

    Returns the memory items written, ``id``, ``kind``, ``content`` and
    ``about`` (which memory it went to) each; empty when nothing qualified or
    every write failed. The words ride along because the stage puts the
    project's rows on the wire for the "noted this" chip
    (``docs/architecture/post-answer-stages.md`` §5.1). A fault on the LLM call
    propagates to the stage runner, which owns the timeout and the failure span.

    ``restriction`` is what the turn could have taken from restricted folders
    (ADR-0087): a project finding that depends on it is written as restricted
    memory, never dropped. ``envelope`` and ``personal_memory`` are the asker's
    (ADR-0180): a finding about the person goes to their personal memory with
    the envelope, is dropped without one, and never reaches project memory.
    """
    messages = [
        SystemMessage(content=REFLECTION_SYSTEM_PROMPT),
        HumanMessage(content=_build_user_prompt(query, answer, memory_digest, personal_memory)),
    ]
    parsed = extract_json(await structured_reply(llm, messages, ReflectionOutput))
    findings = _sanitize_findings(
        parsed.get("findings") if isinstance(parsed, dict) else None,
        has_project=bool(project_id),
        memory_digest=memory_digest,
        personal_memory=personal_memory,
        can_write_personal=envelope is not None,
    )
    if not findings:
        logger.info("Memory reflection: no new durable findings for this turn")
        return []

    recorded = await _record_findings(
        findings,
        project_id=project_id,
        organization_id=organization_id,
        conversation_id=conversation_id,
        decisions=await _project_restrictions(findings, restriction, llm),
        envelope=envelope,
    )
    if recorded:
        logger.info("Memory reflection recorded %d new memory item(s)", len(recorded))
    return recorded
