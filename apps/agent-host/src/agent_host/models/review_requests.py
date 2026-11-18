from typing import Literal

from pydantic import BaseModel
from pydantic import Field

MAX_DIGEST_SAMPLES = 60


class FeedbackDigestTopic(BaseModel):
    topic: str = Field(..., description="Conversation topic tag key (e.g. 'fire_safety')")
    up: int = Field(0, ge=0, description="Helpful votes on conversations carrying this tag")
    down: int = Field(0, ge=0, description="Unhelpful votes on conversations carrying this tag")


class FeedbackDigestOrgShare(BaseModel):
    up: int = Field(0, ge=0)
    down: int = Field(0, ge=0)


class FeedbackDigestSample(BaseModel):
    verdict: Literal["up", "down"] = Field(..., description="'up' or 'down'")
    reason: str | None = Field(None, description="Down-vote reason key, when the vote carried one")
    topics: list[str] = Field(default_factory=list, description="Topic tag keys of the conversation")
    question: str = Field(..., description="The user's question, truncated by the caller")
    comment: str | None = Field(
        None,
        max_length=400,
        description=(
            "The down-vote's free-text comment, truncated by the caller. Read only to label the vote's cause "
            "(ADR-0064, use 9) and quoted to the digest as data."
        ),
    )


class FeedbackDigestRequest(BaseModel):
    window_days: int = Field(30, ge=1, le=365, description="Days of history the aggregate covers")
    answers: int = Field(0, ge=0, description="Assistant answers produced in the window (the denominator)")
    up: int = Field(0, ge=0, description="Helpful votes")
    down: int = Field(0, ge=0, description="Unhelpful votes")
    voters: int = Field(0, ge=0, description="Distinct people who voted")
    down_voters: int = Field(0, ge=0, description="Distinct people behind the unhelpful votes")
    reasons: dict[str, int] = Field(
        default_factory=dict,
        description="Down-vote reason key → count",
    )
    topics: list[FeedbackDigestTopic] = Field(default_factory=list, description="Per-topic vote counts")
    organizations: list[FeedbackDigestOrgShare] = Field(
        default_factory=list,
        description="Per-organization vote counts, anonymised (see FeedbackDigestOrgShare)",
    )
    trend_delta_points: float | None = Field(
        None,
        description=(
            "Change in the helpful rate in percentage points, last third of the window "
            "against the first third. Positive = improving. None when too sparse to read."
        ),
    )
    samples: list[FeedbackDigestSample] = Field(
        default_factory=list,
        description="Bounded sample of rated questions, both directions",
        max_length=MAX_DIGEST_SAMPLES,
    )
    locale: str = Field("de", description="UI locale ('de' or 'en') — the language the digest is written in")


class FeedbackDigestResponse(BaseModel):
    headline: str = Field("", description="Two or three plain sentences summarising the window")
    strengths: list[str] = Field(default_factory=list, description="What the data says is working (0–3)")
    concerns: list[str] = Field(default_factory=list, description="What the data says needs attention (0–3)")
    recommendation: str | None = Field(
        None,
        description="One concrete next step, when the data supports one",
    )
    causes: dict[str, int] = Field(
        default_factory=dict,
        description=(
            "Sampled unhelpful votes by decided cause (feedback_causes.CAUSES keys), most frequent first; "
            "empty when no decision ran"
        ),
    )
    error: str | None = Field(
        default=None,
        description=(
            "Failure code when the digest could not be produced "
            "(llm_not_configured, llm_request_failed, llm_response_malformed); None on success"
        ),
    )


class ConsistencyCheckField(BaseModel):
    field: str = Field(..., description="Human-readable question label (echoed back in findings)")
    value: str = Field(..., description="Human-readable rendering of the user's answer")


class ConsistencyCheckRequest(BaseModel):
    free_text: list[ConsistencyCheckField] = Field(
        default_factory=list,
        description="Free-text answers to scrutinise (e.g. goal details, high-building details)",
    )
    structured: list[ConsistencyCheckField] = Field(
        default_factory=list,
        description="Structured answers as read-only context (never themselves flagged here)",
    )
    locale: str = Field(
        default="de",
        description="UI locale ('de' or 'en') — the language the user-facing explanations must be written in",
    )


class ConsistencyFinding(BaseModel):
    fields: list[str] = Field(
        default_factory=list,
        description="Labels of the answers involved in the contradiction (echoed from the request)",
    )
    severity: str = Field(..., description="'warning' (soft, worth a look) or 'inconsistency' (hard contradiction)")
    explanation: str = Field(..., description="User-facing explanation of the contradiction, in the request locale")


class ConsistencyCheckResponse(BaseModel):
    findings: list[ConsistencyFinding] | None = Field(
        default=None,
        description="Detected contradictions ([] = consistent); None when the check could not complete",
    )
    error: str | None = Field(
        default=None,
        description=(
            "Failure code when the check could not complete "
            "(llm_not_configured, llm_request_failed, llm_response_malformed); None on success"
        ),
    )


class SkillReviewRequest(BaseModel):
    name: str = Field(default="", description="Skill name as written in the SKILL.md frontmatter")
    description: str = Field(default="", description="Skill description (progressive-disclosure level 1)")
    body: str = Field(default="", description="Skill instruction markdown (progressive-disclosure level 2)")
    organization_id: str | None = Field(
        default=None,
        description=(
            "WorkOS organization id, so the review reaches the org's BYOK LLM credential. "
            "Falls back to the X-Grid-Organization-Id header when omitted."
        ),
    )


class SkillReviewFinding(BaseModel):
    severity: str = Field(..., description="'error' (breaks the skill), 'warning' (likely harmful), 'suggestion'")
    field: str = Field(..., description="Which part of the SKILL.md the finding is about: name, description or body")
    check: str = Field(
        default="",
        description="Rulebook check id this finding came from (e.g. '4.8-description-trigger-style'); '' if unknown",
    )
    message: str = Field(..., description="What is wrong, in the language of the skill being reviewed")
    fix: str = Field(..., description="Concrete rewrite/action that resolves the finding, in the same language")


class SkillReviewResponse(BaseModel):
    findings: list[SkillReviewFinding] | None = Field(
        default=None,
        description="Critiques ([] = the skill is good); None when the review could not complete",
    )
    error: str | None = Field(
        default=None,
        description=(
            "Failure code when the review could not complete "
            "(llm_not_configured, llm_request_failed, llm_response_malformed); None on success"
        ),
    )
