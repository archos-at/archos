from __future__ import annotations

from typing import Any
from typing import Literal
from typing import get_args

from pydantic import BaseModel
from pydantic import Field
from pydantic import field_validator

ENVELOPE_VERSION = 1

ENVELOPE_FENCE = "answer_json"

VERDICT_VALUE_MAX_CHARS = 60

SUMMARY_MAX_CHARS = 320

TOPIC_MAX_CHARS = 90

CONTEXT_MAX_CHARS = 160

CALLOUT_MARKER = "[[callout]]"

TAKEAWAYS_MIN_PROSE_CHARS = 600

TAKEAWAYS_MAX_ITEMS = 5

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
