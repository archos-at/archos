from typing import Annotated
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field
from pydantic import StringConstraints
from pydantic import field_validator

SenderTrust = Literal["member_verified", "member_unverified", "external_verified", "external_unverified", "not_checked"]
MailLocale = Literal["de", "en"]
_MailName = Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)]
_MailDomain = Annotated[str, StringConstraints(strip_whitespace=True, max_length=253)]


class MailThreadFacts(BaseModel):
    model_config = ConfigDict(extra="forbid")

    latest_sent_at: AwareDatetime = Field(
        ..., description="The newest message's send time, as the BFF clamped it to its receipt window."
    )
    message_count: int = Field(..., ge=1, le=200, description="How many messages this Fassung of the thread holds.")
    locale: MailLocale = Field("de", description="The locale the thread is rendered in, fixed at its creation.")


class MailOrigin(BaseModel):
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
        if value is not None and "@" in value:
            raise ValueError("a mail name must be a display name, never an address")
        return value
