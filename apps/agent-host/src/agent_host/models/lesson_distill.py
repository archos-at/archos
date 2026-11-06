"""Request and response models of the lesson distiller (``routes/lesson_distill.py``)."""

from pydantic import BaseModel
from pydantic import Field

#: Ceiling on the live lesson register a distill request may carry. Mirrors the
#: BFF's MAX_DISTILL_REGISTER_SIZE (lib/platform-lessons/types.ts).
MAX_DISTILL_LESSONS = 60


class LessonRegisterEntry(BaseModel):
    """One live platform lesson the matcher compares a new report against."""

    id: str = Field(..., description="Lesson uuid (returned verbatim as match_lesson_id on a match)")
    content: str = Field(..., description="The lesson text (anonymized German corrective)")


class LessonDistillRequest(BaseModel):
    """Request body for distilling ONE negative feedback report into a lesson.

    Everything free-text here was already PII-scrubbed and truncated by the BFF
    (lib/text/redact-pii.ts); the route re-bounds it anyway — a route that
    trusts its caller's bounds is one refactor away from posting a transcript.
    Organization, user and conversation identifiers never arrive at all.
    """

    question: str | None = Field(None, description="The user's question, scrubbed + truncated")
    answer: str | None = Field(None, description="The rated answer's text, scrubbed + truncated")
    reason: str | None = Field(None, description="Down-vote reason key (inaccurate|too_slow|wrong_source|other)")
    comment: str | None = Field(None, description="The reporter's free-text comment, scrubbed + truncated")
    existing_lessons: list[LessonRegisterEntry] = Field(
        default_factory=list,
        description="The live lesson register the matcher deduplicates against",
        max_length=MAX_DISTILL_LESSONS,
    )


class LessonDistillResponse(BaseModel):
    """The distiller's verdict on one report.

    Exactly one of ``match_lesson_id`` / ``lesson`` is set on success; both are
    None when the report is not generalizable. ``audit_passed`` is a SECOND
    model's screening of the distilled text for identifying or manipulative
    content — the BFF holds a failed-audit lesson back as a candidate instead
    of activating it.
    """

    match_lesson_id: str | None = Field(
        None, description="Id of the existing lesson this report restates, when one matches"
    )
    lesson: str | None = Field(
        None, description="New lesson text (anonymized German corrective), when no existing lesson matches"
    )
    canonical_summary: str | None = Field(
        None, description="One anonymized sentence restating what went wrong in THIS report"
    )
    category: str = Field("other", description="inaccurate|too_slow|wrong_source|other")
    generalizable: bool = Field(
        False, description="False when the complaint is instance-specific and teaches the fleet nothing"
    )
    audit_passed: bool = Field(False, description="Whether the auditor model cleared the distilled text")
    error: str | None = Field(
        default=None,
        description=(
            "Failure code when distillation could not complete "
            "(llm_not_configured, llm_request_failed, llm_response_malformed); None on success"
        ),
    )
