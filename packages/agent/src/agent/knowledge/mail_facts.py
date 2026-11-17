from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

SENDER_TRUSTS: tuple[str, ...] = (
    "member_verified",
    "member_unverified",
    "external_verified",
    "external_unverified",
    "not_checked",
)
VERIFIED_SENDER_TRUSTS: frozenset[str] = frozenset({"member_verified", "external_verified"})

MAIL_LOCALES: tuple[str, ...] = ("de", "en")

_OFFICE_TIME_ZONE = ZoneInfo("Europe/Vienna")
_MAX_NAME_CHARS = 80
_MAX_MESSAGE_COUNT = 200
_BRACKETS = re.compile(r"[()<>\[\]{}]")
_NOT_DOMAIN = re.compile(r"[^\w.-]")
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")


@dataclass(frozen=True)
class MailCopy:

    unverified_domain: str
    from_archive: str
    unknown_sender: str
    came_with: str
    forwarded_by: str
    thread: str
    latest: str
    one_message: str
    messages: str
    date_time_format: str
    date_format: str


MAIL_COPY: dict[str, MailCopy] = {
    "de": MailCopy(
        unverified_domain="Domain nicht bestätigt",
        from_archive="aus dem Outlook-Archiv",
        unknown_sender="Unbekannt",
        came_with="kam mit der E-Mail vom {when} von {who} ({authority})",
        forwarded_by="Weitergeleitet von",
        thread="E-Mail-Verlauf",
        latest="zuletzt {day}",
        one_message="1 E-Mail",
        messages="{count} E-Mails",
        date_time_format="%d.%m.%Y %H:%M",
        date_format="%d.%m.%Y",
    ),
    "en": MailCopy(
        unverified_domain="domain not verified",
        from_archive="from the Outlook archive",
        unknown_sender="Unknown",
        came_with="came with the mail of {when} from {who} ({authority})",
        forwarded_by="Forwarded by",
        thread="Mail thread",
        latest="latest {day}",
        one_message="1 mail",
        messages="{count} mails",
        date_time_format="%Y-%m-%d %H:%M",
        date_format="%Y-%m-%d",
    ),
}


def _moment(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        moment = value
    elif isinstance(value, str) and value.strip():
        try:
            moment = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            return None
    else:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC)


def _stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _one_line(value: Any) -> str:
    return " ".join(str(value).split()) if isinstance(value, str) else ""


def clean_name(value: Any) -> str | None:
    name = _one_line(_BRACKETS.sub(" ", value) if isinstance(value, str) else "")
    if not name or "@" in name:
        return None
    return " ".join(name[:_MAX_NAME_CHARS].split()) or None


def clean_domain(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    domain = _NOT_DOMAIN.sub("", value.strip().lower().rstrip("."))[:253]
    return domain or None


def _locale(value: Any) -> str:
    return value if value in MAIL_LOCALES else MAIL_LOCALES[0]


def normalise_mail_thread(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, Mapping):
        return None
    latest = _moment(raw.get("latest_sent_at"))
    if latest is None:
        return None
    record: dict[str, Any] = {"latest_sent_at": _stamp(latest), "locale": _locale(raw.get("locale"))}
    count = raw.get("message_count")
    if isinstance(count, int) and not isinstance(count, bool) and 1 <= count <= _MAX_MESSAGE_COUNT:
        record["message_count"] = count
    return record


def normalise_mail_origin(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, Mapping):
        return None
    sent_at = _moment(raw.get("sent_at"))
    trust = raw.get("sender_trust")
    if sent_at is None or trust not in SENDER_TRUSTS:
        return None
    record: dict[str, Any] = {"sent_at": _stamp(sent_at), "sender_trust": trust}
    if (received_at := _moment(raw.get("received_at"))) is not None:
        record["received_at"] = _stamp(received_at)
    if (name := clean_name(raw.get("from_name"))) is not None:
        record["from_name"] = name
    for key in ("from_domain", "signer_domain", "forwarded_by_domain"):
        if (domain := clean_domain(raw.get(key))) is not None:
            record[key] = domain
    if (forwarder := clean_name(raw.get("forwarded_by_name"))) is not None:
        record["forwarded_by_name"] = forwarder
    if (forwarded_at := _moment(raw.get("forwarded_at"))) is not None:
        record["forwarded_at"] = _stamp(forwarded_at)
    thread = raw.get("thread_document_id")
    if isinstance(thread, str) and _UUID.match(thread.strip()):
        record["thread_document_id"] = thread.strip().lower()
    record["locale"] = _locale(raw.get("locale"))
    return record


def sender_authority(origin: Mapping[str, Any], copy: MailCopy) -> str:
    from_domain = origin.get("from_domain")
    if is_forward(origin):
        return ", ".join(part for part in (from_domain, copy.unverified_domain) if part)
    if origin.get("sender_trust") == "not_checked":
        return ", ".join(part for part in (from_domain, copy.from_archive) if part)
    signer = origin.get("signer_domain")
    if origin.get("sender_trust") in VERIFIED_SENDER_TRUSTS and signer:
        return str(signer)
    return ", ".join(part for part in (from_domain, copy.unverified_domain) if part)


_FORWARD_KEYS: tuple[str, ...] = ("forwarded_by_name", "forwarded_by_domain", "forwarded_at")


def is_forward(origin: Mapping[str, Any]) -> bool:
    return any(origin.get(key) for key in _FORWARD_KEYS)


def forwarder_label(origin: Mapping[str, Any], copy: MailCopy) -> str:
    forwarder = {
        "from_domain": origin.get("forwarded_by_domain"),
        "signer_domain": origin.get("signer_domain"),
        "sender_trust": origin.get("sender_trust"),
    }
    who = origin.get("forwarded_by_name") or copy.unknown_sender
    return f"{copy.forwarded_by} {who} ({sender_authority(forwarder, copy)})"


def mail_origin_label(origin: Mapping[str, Any] | None) -> str | None:
    record = normalise_mail_origin(origin) if origin is not None else None
    if record is None:
        return None
    copy = MAIL_COPY[record["locale"]]
    when = datetime.fromisoformat(record["sent_at"].replace("Z", "+00:00")).astimezone(_OFFICE_TIME_ZONE)
    line = copy.came_with.format(
        when=when.strftime(copy.date_time_format),
        who=record.get("from_name") or copy.unknown_sender,
        authority=sender_authority(record, copy),
    )
    return f"{line} · {forwarder_label(record, copy)}" if is_forward(record) else line


def mail_thread_label(thread: Mapping[str, Any] | None) -> str | None:
    record = normalise_mail_thread(thread) if thread is not None else None
    if record is None:
        return None
    copy = MAIL_COPY[record["locale"]]
    latest = datetime.fromisoformat(record["latest_sent_at"].replace("Z", "+00:00")).astimezone(_OFFICE_TIME_ZONE)
    newest = copy.latest.format(day=latest.strftime(copy.date_format))
    count = record.get("message_count")
    if not count:
        return f"{copy.thread} · {newest}"
    counted = copy.one_message if count == 1 else copy.messages.format(count=count)
    return f"{copy.thread} · {counted}, {newest}"


def mail_thread_date(thread: Mapping[str, Any] | None) -> str | None:
    record = normalise_mail_thread(thread) if thread is not None else None
    return record["latest_sent_at"] if record else None
