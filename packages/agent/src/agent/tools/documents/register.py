from __future__ import annotations

import asyncio
import hashlib
import logging
import re
from typing import Any

from agent import project_context
from agent.common.bff_http import SignedEnvelope
from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import register_function

from .cards import draft_title
from .cards import emit_draft_card
from .draft_store import DRAFT_ROOT
from .draft_store import FILED_DOCUMENT_KEY
from .draft_store import FILED_HASH_KEY
from .draft_store import FILED_STATE_KEY
from .draft_store import FILED_VERSION_KEY
from .draft_store import DraftBackend
from .draft_store import DraftUsage
from .draft_store import filing_record
from .draft_store import get_draft_backend
from .draft_store import modernize_draft_path
from .filing import FilingError
from .filing import post_document_version

logger = logging.getLogger(__name__)

MAX_TITLE_CHARS = 200
MAX_REF_CHARS = 200

MAX_REVIEWER_CHARS = 200

REPLACEABLE_STATES = frozenset({"draft", "changes_requested"})

_STILL_A_DRAFT = (
    "This is a DRAFT that nobody has approved yet — do not say the document is approved, published or final."
)

_NO_PROJECT = (
    "Error: There is no project in this conversation, so there are no project files in which a "
    "draft could be filed. The draft stays in this conversation's working directory. "
    "Do not retry."
)

_NO_ENVELOPE = (
    "Error: This run has no signed session credential, so nothing can be filed in a "
    "person's name. Nothing was filed. Do not retry."
)

_NO_CONVERSATION = (
    "Error: This run belongs to no conversation, so there is no working directory. Nothing was filed. Do not retry."
)

_ALREADY_SUBMITTED = (
    "Error: This draft is already submitted for approval and can no longer be changed. "
    "Tell the user that a person must first return or approve it."
)


_NOT_REPLACEABLE_NOW = (
    "Error: The draft in the project cannot be replaced right now. Either it is submitted for approval, "
    "or a person has changed it since it was last filed. Tell the user that a "
    "person must first return it, or that they should check the current state in the project."
)

_NOT_SUBMITTABLE_NOW = (
    "Error: This draft has already been submitted. Tell the user that it is waiting for approval by a person."
)


def _slug(path: str) -> str:
    name = path.rsplit("/", 1)[-1]
    name = re.sub(r"\.md$", "", name, flags=re.IGNORECASE)
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug or "draft"


def _filing_hash(conversation_id: str, path: str) -> str:
    return hashlib.sha256(f"{conversation_id}\0{path}".encode()).hexdigest()[:8]


def filing_reference(conversation_id: str, path: str) -> str:
    normalized = path.strip().lstrip("/")
    raw = f"{conversation_id}-{_slug(normalized)}"
    if len(raw) <= MAX_REF_CHARS:
        return raw
    suffix = f"-{_filing_hash(conversation_id, normalized)}"
    return f"{raw[: MAX_REF_CHARS - len(suffix)]}{suffix}"


class _Refused(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def _envelope() -> SignedEnvelope:
    header, signature = project_context.get_request_envelope_from_context()
    if not header or not signature:
        raise _Refused(_NO_ENVELOPE)
    return SignedEnvelope(header=header, signature=signature)


def _conversation_id() -> str:
    live = project_context.get_conversation_id_from_context()
    if not live:
        raise _Refused(_NO_CONVERSATION)
    signed = project_context.RequestContext.from_context().conversation_id
    if signed and signed != live:
        logger.warning("Envelope conversation %r disagrees with the turn's %r; refusing to file", signed, live)
        raise _Refused(_NO_ENVELOPE)
    return live


async def _draft(path: str) -> tuple[DraftBackend, DraftUsage]:
    if not path.startswith(DRAFT_ROOT) or ".." in path:
        raise _Refused(
            f"Error: `{path}` is not in the working directory. Only what was written under `{DRAFT_ROOT}` can be filed."
        )
    backend = await get_draft_backend(_conversation_id())
    usage = await backend.ausage(path)
    if usage.content is None:
        raise _Refused(f"Error: There is no draft at `{path}`. Use `ls` to see what the draft is really called.")
    return backend, usage


_CALL_FAILED = "Error filing: {error}. Nothing was filed; tell the user that the draft is in the working directory."

_SUBMIT_FAILED_AFTER_FILING = (
    "Error submitting: {error}. Tell the user that the draft is in the project as a DRAFT, but not submitted."
)


async def _post(
    payload: dict[str, Any],
    envelope: SignedEnvelope,
    *,
    bad_request: str | None = None,
    conflict: str | None = None,
    failure: str = _CALL_FAILED,
) -> dict[str, Any]:
    try:
        return await asyncio.to_thread(post_document_version, payload, envelope)
    except FilingError as exc:
        if bad_request is not None and exc.status == 400:
            raise _Refused(bad_request) from exc
        if conflict is not None and exc.status == 409:
            raise _Refused(conflict) from exc
        raise _Refused(failure.format(error=exc)) from exc


async def _create(path: str, usage: DraftUsage, title: str, envelope: SignedEnvelope) -> dict[str, str]:
    body = await _post(
        {
            "op": "create",
            "projectId": project_context.get_project_id_from_context(),
            "ref": filing_reference(_conversation_id(), path),
            "title": title,
            "content": usage.content or "",
        },
        envelope,
    )
    filing = filing_record(body)
    if not body.get("alreadyFiled"):
        return filing
    if filing[FILED_STATE_KEY] not in REPLACEABLE_STATES:
        raise _Refused(_ALREADY_SUBMITTED)
    return await _update(usage, filing, envelope)


async def _update(usage: DraftUsage, filing: dict[str, str], envelope: SignedEnvelope) -> dict[str, str]:
    body = await _post(
        {
            "op": "update",
            "documentId": filing[FILED_DOCUMENT_KEY],
            "versionId": filing[FILED_VERSION_KEY],
            "content": usage.content or "",
            "ifMatch": filing[FILED_HASH_KEY],
        },
        envelope,
        conflict=_NOT_REPLACEABLE_NOW,
    )
    return filing_record(body)


def _project_or_refuse() -> str:
    project_id = project_context.get_project_id_from_context()
    if not project_id:
        raise _Refused(_NO_PROJECT)
    return project_id


_FILE_DRAFT_DESCRIPTION = (
    "Files a draft from the working directory into the project AS A DRAFT, so that others can see and "
    "review it. `path` is the path in the working directory (`" + DRAFT_ROOT + "<name>.md`), `title` "
    "is optionally the title in the project — by default the document's first heading. "
    "Call it when the user asks for it („leg das ins Projekt“, „abspeichern“, „ablegen“), "
    "not on your own after every write. "
    "A second call for the same path replaces the content of the same draft; no "
    "second document is created. What is filed is a DRAFT: nobody has approved it, it is not "
    "published and is not searched. "
    "`submit=true` then submits the draft FOR APPROVAL: it goes into review and appears in the "
    "reviewers' inbox. If it is already filed and unchanged since, it is only submitted. "
    "Call with `submit=true` only when the user asks for approval, review or hand-over — "
    "„ablegen“ alone is not such a request. Submitting costs a person attention, and the "
    "draft cannot be changed afterwards. "
    "`reviewer` applies only together with `submit=true` and is optional: the person who is to review, named exactly "
    "as the user named them (name or email) — THIS execution does not know the "
    "project members and does not check the name; it is resolved on submission against the "
    "project's members. So fill it only when the user named the person themselves, "
    "and take the name over unchanged. Without `reviewer` the draft goes to the project's "
    "editors. Even after submission the document is NOT approved: it waits for approval "
    "by a person."
)

_REVIEWER_WITHOUT_SUBMIT = (
    "Error: `reviewer` applies only together with `submit=true`. Nothing was filed. If the user "
    "asked for approval or review, call again with `submit=true`; otherwise without `reviewer`."
)


class FileDraftConfig(FunctionBaseConfig, name="file_draft"): ...


async def _refile(usage: DraftUsage, envelope: SignedEnvelope) -> dict[str, str]:
    return await _update(usage, usage.filing, envelope)


def _submit_payload(filing: dict[str, str], reviewer: str) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "op": "submit",
        "documentId": filing[FILED_DOCUMENT_KEY],
        "versionId": filing[FILED_VERSION_KEY],
        "reviewerUserIds": [],
    }
    if reviewer:
        payload["reviewer"] = reviewer
    return payload


def _unknown_reviewer(reviewer: str) -> str:
    return (
        f"I do not know a person named „{reviewer}“ in this project. Nothing was submitted. "
        "Ask the user for the exact name or email address, or submit without a name "
        "— then the draft goes to the project's editors."
    )


def _whom(reviewer: str) -> str:
    return f"to {reviewer}" if reviewer else "to the project's editors"


async def _submit(
    backend: DraftBackend,
    path: str,
    filing: dict[str, str],
    reviewer: str,
    envelope: SignedEnvelope,
    *,
    failure: str = _CALL_FAILED,
) -> dict[str, str]:
    body = await _post(
        _submit_payload(filing, reviewer),
        envelope,
        bad_request=_unknown_reviewer(reviewer) if reviewer else None,
        conflict=_NOT_SUBMITTABLE_NOW,
        failure=failure,
    )
    submitted = filing_record(body)
    await backend.arecord_filing(path, submitted)
    return submitted


async def _submit_unchanged(
    backend: DraftBackend, path: str, usage: DraftUsage, reviewer: str, envelope: SignedEnvelope
) -> str:
    submitted = await _submit(backend, path, usage.filing, reviewer, envelope, failure=_SUBMIT_FAILED_AFTER_FILING)
    emit_draft_card(path=path, content=usage.content or "", version=usage.version or 1, filing=submitted)
    return (
        f"Submitted for approval {_whom(reviewer)}: „{draft_title(path, usage.content or '')}“ is now waiting "
        f"for review by a person. {_STILL_A_DRAFT}"
    )


async def _file(path: str, title: str, *, submit: bool, reviewer: str) -> str:
    path = modernize_draft_path(path)
    _project_or_refuse()
    envelope = _envelope()
    named = " ".join((reviewer or "").split())[:MAX_REVIEWER_CHARS]
    if named and not submit:
        raise _Refused(_REVIEWER_WITHOUT_SUBMIT)
    backend, usage = await _draft(path)
    if submit and usage.filed_unchanged:
        return await _submit_unchanged(backend, path, usage, named, envelope)

    chosen = " ".join((title or "").split())[:MAX_TITLE_CHARS] or draft_title(path, usage.content or "")
    filing = (
        await _refile(usage, envelope)
        if usage.filing.get(FILED_DOCUMENT_KEY)
        else await _create(path, usage, chosen, envelope)
    )
    await backend.arecord_filing(path, filing, draft_version=usage.version)

    def _card(record: dict[str, str]) -> None:
        emit_draft_card(path=path, content=usage.content or "", version=usage.version or 1, filing=record, title=chosen)

    if not submit:
        _card(filing)
        return (
            f"Filed in the project: „{chosen}“. {_STILL_A_DRAFT} "
            "The same call with `submit=true` can submit it for approval, if the user asks for that."
        )
    try:
        submitted = await _submit(backend, path, filing, named, envelope, failure=_SUBMIT_FAILED_AFTER_FILING)
    except _Refused as refused:
        _card(filing)
        raise _Refused(f"Filed in the project: „{chosen}“ — but NOT submitted. {refused.message}") from refused
    _card(submitted)
    return (
        f"Filed in the project and submitted for approval {_whom(named)}: „{chosen}“ is now waiting for "
        f"review by a person. {_STILL_A_DRAFT}"
    )


async def run_file_draft(
    path: str,
    title: str | None = None,
    submit: bool = False,
    reviewer: str | None = None,
) -> str:
    try:
        return await _file(path, title or "", submit=submit, reviewer=reviewer or "")
    except _Refused as refused:
        return refused.message


@register_function(config_type=FileDraftConfig)
async def file_draft(tool_config: FileDraftConfig, builder: Builder):
    yield FunctionInfo.from_fn(run_file_draft, description=_FILE_DRAFT_DESCRIPTION)
