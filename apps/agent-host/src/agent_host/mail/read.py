from __future__ import annotations

import asyncio
import codecs
import logging
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser

from pydantic import ValidationError

from . import limits
from .body_text import body_text
from .body_text import decode
from .calendar import calendar_events
from .models import CalendarEvent
from .models import MailRead
from .models import QuotedBlock
from .models import UnreadableReason
from .replies import split_replies

logger = logging.getLogger(__name__)

CALENDAR_TYPES = frozenset({"text/calendar", "application/ics"})
RTF_TYPES = frozenset({"text/rtf", "application/rtf"})
ENCRYPTED_TYPES = frozenset({"multipart/encrypted", "application/pkcs7-mime", "application/x-pkcs7-mime"})

_LOOSE_CHARSETS = frozenset({"us-ascii", "ascii", "iso-8859-1", "latin-1", "latin1", "iso8859-1"})

_MAX_HEADER_CHARS = 4096


_slots: asyncio.Semaphore | None = None


async def read_message_within(raw: bytes, timeout: float = limits.READ_TIMEOUT_SECONDS) -> MailRead:
    global _slots
    if _slots is None:
        _slots = asyncio.Semaphore(limits.MAX_CONCURRENT_READS)
    async with _slots:
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-I",
            "-m",
            __name__,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            env={},
        )
        try:
            output, _ = await asyncio.wait_for(process.communicate(raw), timeout=timeout)
        except TimeoutError:
            logger.warning("mail read: stopped after %.0f s (%d bytes)", timeout, len(raw))
            return MailRead.unread(UnreadableReason.TIMEOUT)
        finally:
            await _reap(process)
    if process.returncode != 0:
        logger.warning("mail read: the reading process ended with %s", process.returncode)
        return MailRead.unread(UnreadableReason.FAILED)
    try:
        return MailRead.model_validate_json(output)
    except ValidationError:
        logger.warning("mail read: the reading process answered something else")
        return MailRead.unread(UnreadableReason.FAILED)


def read_message(raw: bytes) -> MailRead:
    if len(raw) > limits.MAX_MESSAGE_BYTES:
        return MailRead.unread(UnreadableReason.MESSAGE_TOO_LARGE)
    try:
        return _read(raw)
    except Exception as error:  # noqa: BLE001 - the contract is total; the reason is recorded
        logger.warning("mail read failed: %s", type(error).__name__)
        return MailRead.unread(UnreadableReason.FAILED)


def _read(raw: bytes) -> MailRead:
    message = BytesParser(policy=policy.default).parsebytes(raw)
    reasons: list[UnreadableReason] = []
    body = body_text(*_body_forms(message, reasons))
    split = split_replies(body.text)
    own = split.own[: limits.MAX_OWN_TEXT_CHARS]
    forwarded = _forwarded(message)
    quoted = [*forwarded.blocks] + [
        QuotedBlock(header=block.header[:_MAX_HEADER_CHARS], text=block.text[: limits.MAX_QUOTED_CHARS])
        for block in split.quoted[: limits.MAX_QUOTED_BLOCKS - len(forwarded.blocks)]
    ]
    events, calendar_truncated = _calendar(message, reasons)
    return MailRead(
        body_source=body.source,
        own_text=own,
        own_text_truncated=body.truncated or len(own) < len(split.own),
        split=split.split,
        signature_removed=split.signature_removed,
        quoted=quoted,
        quoted_truncated=len(forwarded.blocks) + len(split.quoted) > len(quoted)
        or any(len(block.text) > limits.MAX_QUOTED_CHARS for block in split.quoted)
        or forwarded.truncated,
        calendar=events,
        calendar_truncated=calendar_truncated,
        encrypted=_is_encrypted(message),
        unreadable_reasons=reasons,
    )


@dataclass(frozen=True)
class _Forwarded:
    blocks: tuple[QuotedBlock, ...] = ()
    truncated: bool = False


_FORWARD_HEADERS = ("From", "Date", "Subject")


def _forwarded(message: EmailMessage) -> _Forwarded:
    forward = _first_forward(message)
    if forward is None:
        return _Forwarded()
    try:
        body = body_text(*_body_forms(forward, []))
        header = "\n".join(
            f"{name}: {' '.join(str(forward[name]).split())}" for name in _FORWARD_HEADERS if forward[name] is not None
        )
    except Exception as error:  # noqa: BLE001 - the forward is extra; the mail's own text is still read
        logger.warning("mail read: the forwarded message could not be read: %s", type(error).__name__)
        return _Forwarded()
    text = body.text.strip()
    if not text and not header:
        return _Forwarded()
    block = QuotedBlock(header=header[:_MAX_HEADER_CHARS], text=text[: limits.MAX_QUOTED_CHARS])
    return _Forwarded(blocks=(block,), truncated=body.truncated or len(text) > limits.MAX_QUOTED_CHARS)


def _first_forward(message: EmailMessage) -> EmailMessage | None:
    stack = [message]
    while stack:
        part = stack.pop()
        content_type = part.get_content_type()
        if content_type.startswith("multipart/"):
            stack.extend(reversed(_children(part)))
            continue
        if content_type == "message/rfc822" and part is not message:
            inner = _children(part)
            return inner[0] if inner and isinstance(inner[0], EmailMessage) else None
    return None


def _body_forms(message: EmailMessage, reasons: list[UnreadableReason]) -> tuple[str | None, str | None, bytes | None]:
    plain_part = message.get_body(preferencelist=("plain",))
    html_part = message.get_body(preferencelist=("html",))
    rtf_part = next((part for part in _parts(message) if _is_body_rtf(part)), None)
    plain = _flowed_text(plain_part) if plain_part is not None else None
    if plain and plain.strip():
        return plain, None, None
    html = _capped(html_part, limits.MAX_HTML_BYTES, UnreadableReason.HTML_TOO_LARGE, reasons)
    rtf = _capped(rtf_part, limits.MAX_RTF_BYTES, UnreadableReason.RTF_TOO_LARGE, reasons)
    return plain, _part_text(html_part) if html is not None else None, rtf


def _capped(
    part: EmailMessage | None, cap: int, reason: UnreadableReason, reasons: list[UnreadableReason]
) -> bytes | None:
    if part is None:
        return None
    payload = _payload(part)
    if len(payload) > cap:
        reasons.append(reason)
        return None
    return payload


async def _reap(process: asyncio.subprocess.Process) -> None:
    if process.returncode is None:
        process.kill()
        await process.wait()


def _calendar(message: EmailMessage, reasons: list[UnreadableReason]) -> tuple[list[CalendarEvent], bool]:
    events: list[CalendarEvent] = []
    seen: set[tuple[str | None, int | None, str | None, str | None]] = set()
    truncated = False
    calendar_parts = (part for part in _parts(message) if _is_calendar(part))
    for index, part in enumerate(calendar_parts):
        if index >= limits.MAX_CALENDAR_PARTS:
            truncated = True
            break
        payload = _payload(part)
        if len(payload) > limits.MAX_CALENDAR_BYTES:
            _note(reasons, UnreadableReason.CALENDAR_TOO_LARGE)
            continue
        read = calendar_events(payload)
        if read.malformed:
            _note(reasons, UnreadableReason.CALENDAR_MALFORMED)
        truncated = _add_new_events(events, seen, read.events) or truncated or read.truncated
    return events, truncated


def _add_new_events(
    events: list[CalendarEvent],
    seen: set[tuple[str | None, int | None, str | None, str | None]],
    found: tuple[CalendarEvent, ...],
) -> bool:
    for event in found:
        key = (event.uid, event.sequence, event.start, event.summary)
        if key in seen:
            continue
        if len(events) >= limits.MAX_CALENDAR_EVENTS:
            return True
        seen.add(key)
        events.append(event)
    return False


def _note(reasons: list[UnreadableReason], reason: UnreadableReason) -> None:
    if reason not in reasons:
        reasons.append(reason)


def _parts(message: EmailMessage) -> Iterator[EmailMessage]:
    stack = [message]
    while stack:
        part = stack.pop()
        content_type = part.get_content_type()
        if content_type.startswith("multipart/"):
            stack.extend(reversed(_children(part)))
            continue
        if content_type == "message/rfc822" and part is not message:
            continue
        yield part


def _children(part: EmailMessage) -> list[EmailMessage]:
    payload = part.get_payload()
    return payload if isinstance(payload, list) else []


def _is_calendar(part: EmailMessage) -> bool:
    if part.get_content_type() in CALENDAR_TYPES:
        return True
    filename = part.get_filename() or ""
    return filename.lower().endswith(".ics")


def _is_body_rtf(part: EmailMessage) -> bool:
    return part.get_content_type() in RTF_TYPES and not part.is_attachment()


def _is_encrypted(message: EmailMessage) -> bool:
    return any(_is_encrypted_part(part) for part in (message, *_top_parts(message)))


def _is_encrypted_part(part: EmailMessage) -> bool:
    content_type = part.get_content_type()
    if content_type == "multipart/encrypted":
        return True
    if content_type not in ENCRYPTED_TYPES:
        return False
    smime_type = str(part.get_param("smime-type", "enveloped-data")).lower()
    return smime_type in {"enveloped-data", "authenveloped-data"}


def _top_parts(message: EmailMessage) -> list[EmailMessage]:
    payload = message.get_payload() if message.is_multipart() else None
    return [part for part in payload if isinstance(part, EmailMessage)] if isinstance(payload, list) else []


def _payload(part: EmailMessage) -> bytes:
    payload = part.get_payload(decode=True)
    return payload if isinstance(payload, bytes) else b""


def _part_text(part: EmailMessage) -> str:
    payload = _payload(part)
    charset = (part.get_content_charset() or "").strip().lower()
    if not charset or charset in _LOOSE_CHARSETS:
        return decode(payload)
    try:
        codecs.lookup(charset)
        return payload.decode(charset)
    except LookupError, UnicodeDecodeError, ValueError:
        return decode(payload)


def _flowed_text(part: EmailMessage) -> str:
    text = _part_text(part)
    if str(part.get_param("format", "")).lower() != "flowed":
        return text
    return unflow(text, delete_space=str(part.get_param("delsp", "")).lower() == "yes")


def unflow(text: str, delete_space: bool = False) -> str:
    lines: list[str] = []
    pieces: list[str] = []
    pieces_depth = 0

    def flush() -> None:
        if pieces:
            prefix = ">" * pieces_depth + " " if pieces_depth else ""
            lines.append(prefix + "".join(pieces))
            pieces.clear()

    for raw_line in text.replace("\r\n", "\n").split("\n"):
        depth = len(raw_line) - len(raw_line.lstrip(">"))
        line = raw_line[depth:]
        line = line.removeprefix(" ")
        if pieces and depth != pieces_depth:
            flush()
        pieces_depth = depth
        if line.endswith(" ") and line != "-- ":
            pieces.append(line[:-1] if delete_space else line)
            continue
        pieces.append(line)
        flush()
    flush()
    return "\n".join(lines)


def _main() -> None:
    raw = sys.stdin.buffer.read(limits.MAX_MESSAGE_BYTES + 1)
    sys.stdout.buffer.write(read_message(raw).model_dump_json().encode())


if __name__ == "__main__":
    _main()
