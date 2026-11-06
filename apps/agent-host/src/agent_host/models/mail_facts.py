"""What an ingest request says about a mail: the filed thread, or the message an attachment came with (ADR-0137).

Kept apart from ``requests.py`` so the mail vocabulary reads in one place; ``IngestRequest``
carries both models as optional fields.
"""

from typing import Annotated
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import StringConstraints
from pydantic import field_validator

#: Who a mail is from, as far as the bytes and DNS could tell (``agent.knowledge.mail_facts.SENDER_TRUSTS``,
#: the BFF's ``SENDER_TRUSTS``). Spelled out because a ``Literal`` must be; a test pins it to the tuple.
SenderTrust = Literal["member_verified", "member_unverified", "external_verified", "external_unverified", "not_checked"]
#: The locales a mail thread is rendered in (``agent.knowledge.mail_facts.MAIL_LOCALES``).
MailLocale = Literal["de", "en"]
_MailName = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
_MailDomain = Annotated[str, StringConstraints(strip_whitespace=True, max_length=253)]


class MailThreadFacts(BaseModel):
    """The document is a filed E-Mail-Verlauf (ADR-0137): one Markdown section per message.

    Its chunks are stamped ``source_format: mail`` (the lane ``project_mail``), and the
    record lands on the metadata row, where the newest message's date becomes the
    document's own date. No address and no text: what a heading says is in the bytes.
    """

    model_config = ConfigDict(extra="forbid")

    latest_sent_at: AwareDatetime = Field(
        ..., description="The newest message's send time, as the BFF clamped it to its receipt window."
    )
    message_count: int = Field(..., ge=1, le=200, description="How many messages this Fassung of the thread holds.")
    locale: MailLocale = Field("de", description="The locale the thread is rendered in, fixed at its creation.")


class MailOrigin(BaseModel):
    """The message a filed attachment came with, as the receive step established it (ADR-0137).

    Stored on the attachment's metadata row and printed by ``list_files`` and
    ``read_passage``: the signing domain when the sender was verified, and
    otherwise the From domain with „Domain nicht bestätigt“. A forwarded message
    names its author in ``from_*`` and ``sent_at`` (never confirmed) and its
    forwarder in ``forwarded_by_*`` and ``forwarded_at``; the signature and the
    trust are the forward's. Display names and domains only; any other key, an
    address included, is refused.
    """

    model_config = ConfigDict(extra="forbid")

    sent_at: AwareDatetime = Field(..., description="The message's send time, clamped by the BFF.")
    received_at: AwareDatetime | None = Field(None, description="When the message reached the office.")
    from_name: _MailName | None = Field(None, description="The sender's display name, never an address.")
    from_domain: _MailDomain | None = Field(None, description="The From address's domain.")
    signer_domain: _MailDomain | None = Field(
        None, description="The domain of the aligned passing DKIM signature, when there is one."
    )
    sender_trust: SenderTrust = Field(..., description="`inbound_mails.sender_trust`; `not_checked` for an archive.")
    forwarded_by_name: _MailName | None = Field(
        None, description="A forwarded message's forwarder, by display name; the `from_*` fields are then its author."
    )
    forwarded_by_domain: _MailDomain | None = Field(None, description="The forwarder's From domain.")
    forwarded_at: AwareDatetime | None = Field(
        None, description="When the forward was sent, clamped; `sent_at` is then when the author wrote it."
    )
    thread_document_id: UUID | None = Field(None, description="The E-Mail-Verlauf the message was filed into.")
    locale: MailLocale = Field("de", description="The locale of that thread, which the printed line is written in.")

    @field_validator("from_name", "forwarded_by_name")
    @classmethod
    def _no_address(cls, value: str | None) -> str | None:
        """A name that is an address would print one: refused, the BFF sends the name or nothing."""
        if value is not None and "@" in value:
            raise ValueError("a mail name must be a display name, never an address")
        return value
