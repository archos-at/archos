from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel
from pydantic import Field
from pydantic import computed_field

READER_VERSION = 1

BodySource = Literal["plain", "html", "rtf", "none"]


class UnreadableReason(StrEnum):
    MESSAGE_TOO_LARGE = "message_too_large"
    HTML_TOO_LARGE = "html_too_large"
    RTF_TOO_LARGE = "rtf_too_large"
    CALENDAR_TOO_LARGE = "calendar_too_large"
    CALENDAR_MALFORMED = "calendar_malformed"
    TIMEOUT = "timeout"
    FAILED = "failed"


class QuotedBlock(BaseModel):
    header: str = Field(max_length=4096)
    text: str = Field(max_length=524_288)


class CalendarEvent(BaseModel):
    method: str | None = Field(max_length=40)
    summary: str | None = Field(max_length=500)
    start: str | None
    end: str | None
    all_day: bool
    location: str | None = Field(max_length=500)
    status: str | None = Field(max_length=40)
    organizer_name: str | None = Field(max_length=300)
    uid: str | None = Field(max_length=500)
    sequence: int | None
    recurring: bool


class MailRead(BaseModel):
    reader_version: int = READER_VERSION
    body_source: BodySource
    own_text: str
    own_text_truncated: bool
    split: bool
    signature_removed: bool
    quoted: list[QuotedBlock]
    quoted_truncated: bool
    calendar: list[CalendarEvent]
    calendar_truncated: bool
    encrypted: bool
    unreadable_reasons: list[UnreadableReason]

    @computed_field
    @property
    def unreadable(self) -> bool:
        return bool(self.unreadable_reasons)

    @classmethod
    def unread(cls, reason: UnreadableReason) -> MailRead:
        return cls(
            body_source="none",
            own_text="",
            own_text_truncated=False,
            split=False,
            signature_removed=False,
            quoted=[],
            quoted_truncated=False,
            calendar=[],
            calendar_truncated=False,
            encrypted=False,
            unreadable_reasons=[reason],
        )
