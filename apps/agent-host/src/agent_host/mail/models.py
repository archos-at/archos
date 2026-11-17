"""What reading a mail gives: :class:`MailRead`, the body of ``POST /v1/mail/read``.

The BFF stages it as the held mail's ``read.json`` and, once a person files
the message, copies ``own_text``, ``quoted`` and ``calendar`` into the thread
entry (``mail_thread_entries``). Field names are this tier's snake_case; the
BFF's read client maps them onto its wire.

Text here is the sender's, unscreened and unredacted: the BFF redacts other
tenants' project addresses in ``own_text`` and in every ``quoted`` block,
header included, before it stages the read (DECISION B8).
"""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel
from pydantic import Field
from pydantic import computed_field

READER_VERSION = 1

BodySource = Literal["plain", "html", "rtf", "none"]


class UnreadableReason(StrEnum):
    """Why part of a message was not read. Any one makes the read ``unreadable``."""

    MESSAGE_TOO_LARGE = "message_too_large"
    HTML_TOO_LARGE = "html_too_large"
    RTF_TOO_LARGE = "rtf_too_large"
    CALENDAR_TOO_LARGE = "calendar_too_large"
    CALENDAR_MALFORMED = "calendar_malformed"
    TIMEOUT = "timeout"
    FAILED = "failed"


class QuotedBlock(BaseModel):
    """One earlier message the sender quoted below their own text, in the order it appeared."""

    header: str = Field(max_length=4096)
    text: str = Field(max_length=524_288)


class CalendarEvent(BaseModel):
    """One event of a calendar invitation the message carried."""

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
    """What one message says, as far as it could be read."""

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
        """Part of the message could not be read; a person should open the original."""
        return bool(self.unreadable_reasons)

    @classmethod
    def unread(cls, reason: UnreadableReason) -> MailRead:
        """A read that kept nothing, for ``reason``."""
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
