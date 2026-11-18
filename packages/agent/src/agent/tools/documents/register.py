from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
import re
from dataclasses import dataclass
from dataclasses import replace
from typing import Any
from typing import Literal
from uuid import uuid4

from agent import project_context
from agent.common.bff_http import SignedEnvelope
from agent.observability.langfuse_scores import emit_scores
from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import register_function

from ..execute.trace import filed_scores
from .cards import draft_title
from .cards import emit_draft_card
from .draft_store import DRAFT_ROOT
from .draft_store import FILED_DOCUMENT_KEY
from .draft_store import FILED_HASH_KEY
from .draft_store import FILED_STATE_KEY
from .draft_store import FILED_VERSION_KEY
from .draft_store import MADE_BY_RUN
from .draft_store import DraftBackend
from .draft_store import DraftUsage
from .draft_store import filing_record
from .draft_store import get_draft_backend
from .draft_store import modernize_draft_path
from .filing import FilingError
from .filing import post_document_version
from .media_types import file_content_type

logger = logging.getLogger(__name__)

MAX_TITLE_CHARS = 200
MAX_REF_CHARS = 200

MAX_REVIEWER_CHARS = 200

IN_REVIEW_STATE = "in_review"

FILE_AS_REVISION = "new_revision"

FILE_AS_SEPARATE = "separate_file"

FILE_AS_OVER_CHANGES = "over_changes"

MAX_FOLDER_CHARS = 300

MAX_CHANGE_NOTE_CHARS = 500

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

_IN_REVIEW = (
    "Error: The document in the project is in review right now, so it cannot take a new version. Nothing was "
    "filed. Tell the user that a person must first decide the review."
)

_NO_SOURCE = (
    "Error: `{path}` was not made from a project document, so it cannot become a new version of one. Nothing was "
    "filed. File it as its own file instead."
)


def _changed_in_project(details: dict[str, Any]) -> str:
    number = details.get("versionNumber")
    which = f" (it is now Fassung {number})" if isinstance(number, int) else ""
    return (
        f"Error: A person changed the document in the project since this draft was filed{which}. Nothing was "
        "filed. Tell the user in one sentence and ask which they want: the draft as a new version on top of "
        'theirs (call again with `file_as="over_changes"`), or the draft as its own file '
        '(`file_as="separate_file"`). Do not choose for them.'
    )


def _unknown_folder(details: dict[str, Any]) -> str:
    folders = [str(folder) for folder in details.get("folders") or [] if isinstance(folder, str)]
    named = ", ".join(f"„{folder}“" for folder in folders) or "none"
    return (
        f"Error: There is no folder „{details.get('folder', '')}“ in this project. Nothing was filed. "
        f"The folders are: {named}. Ask the user which one they meant, or file without `folder`."
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


def _file_bytes(usage: DraftUsage) -> str:
    content = usage.content or ""
    return content if usage.is_binary else base64.b64encode(content.encode("utf-8")).decode("ascii")


def _card_size(usage: DraftUsage) -> int | None:
    return len(base64.b64decode(usage.content or "")) if usage.is_binary else None


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
    if not path.lower().endswith(".md") and file_content_type(path) is None:
        raise _Refused(
            f"Error: `{path}` cannot be filed: only Markdown drafts and .docx, .xlsx, .pptx, .pdf, .svg or .png "
            "files go into the project. Convert it with execute first (a CSV into .xlsx, for example)."
        )
    return backend, usage


_CALL_FAILED = "Error filing: {error}. Nothing was filed; tell the user that the draft is in the working directory."

_SUBMIT_FAILED_AFTER_FILING = (
    "Error submitting: {error}. Tell the user that the draft is in the project as a DRAFT, but not submitted."
)


def _refusal_for(exc: FilingError) -> str | None:
    if exc.reason == "changed-in-project":
        return _changed_in_project(exc.details)
    if exc.reason == "in-review":
        return _IN_REVIEW
    if exc.reason == "folder-unknown":
        return _unknown_folder(exc.details)
    return None


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
        named = _refusal_for(exc)
        if named is not None:
            raise _Refused(named) from exc
        if bad_request is not None and exc.status == 400:
            raise _Refused(bad_request) from exc
        if conflict is not None and exc.status == 409:
            raise _Refused(conflict) from exc
        raise _Refused(failure.format(error=exc)) from exc


@dataclass(frozen=True)
class _Choice:
    title: str = ""
    folder: str = ""
    file_as: str = ""
    over_changes: bool = False
    change_note: str = ""
    separate_ref: str = ""


def _create_payload(path: str, usage: DraftUsage, choice: _Choice) -> dict[str, Any]:
    common = {
        "projectId": project_context.get_project_id_from_context(),
        "ref": choice.separate_ref or filing_reference(_conversation_id(), path),
        "title": choice.title,
        **({"folder": choice.folder} if choice.folder else {}),
    }
    kind = file_content_type(path)
    if kind is None:
        return {"op": "create", **common, "content": usage.content or ""}
    source = usage.derived_from.get("document_id")
    return {
        "op": "create_file",
        **common,
        **({"sourceDocumentId": source} if source and not choice.folder else {}),
        "filename": path.rsplit("/", 1)[-1],
        "contentType": kind,
        "contentBase64": _file_bytes(usage),
    }


async def _create(path: str, usage: DraftUsage, choice: _Choice, envelope: SignedEnvelope) -> dict[str, str]:
    body = await _post(_create_payload(path, usage, choice), envelope)
    filing = filing_record(body)
    if not body.get("alreadyFiled"):
        return filing
    if filing[FILED_STATE_KEY] == IN_REVIEW_STATE:
        raise _Refused(_ALREADY_SUBMITTED)
    return await _update(path, usage, filing, envelope, over_changes=choice.over_changes)


async def _revise_source(path: str, usage: DraftUsage, choice: _Choice, envelope: SignedEnvelope) -> dict[str, str]:
    source = usage.derived_from.get("document_id")
    kind = file_content_type(path)
    if not source or kind is None:
        raise _Refused(_NO_SOURCE.format(path=path))
    payload = {
        "op": "revise_file",
        "documentId": source,
        "contentType": kind,
        "contentBase64": _file_bytes(usage),
        **({"changeNote": choice.change_note} if choice.change_note else {}),
    }
    return filing_record(await _post(payload, envelope))


def _update_payload(path: str, usage: DraftUsage, filing: dict[str, str], *, over_changes: bool) -> dict[str, Any]:
    common = {
        "documentId": filing[FILED_DOCUMENT_KEY],
        "versionId": filing[FILED_VERSION_KEY],
        "ifMatch": filing[FILED_HASH_KEY],
        **({"overChanges": True} if over_changes else {}),
    }
    kind = file_content_type(path)
    if kind is None:
        return {"op": "update", **common, "content": usage.content or ""}
    return {"op": "update_file", **common, "contentType": kind, "contentBase64": _file_bytes(usage)}


async def _update(
    path: str, usage: DraftUsage, filing: dict[str, str], envelope: SignedEnvelope, *, over_changes: bool = False
) -> dict[str, str]:
    payload = _update_payload(path, usage, filing, over_changes=over_changes)
    body = await _post(payload, envelope, conflict=_NOT_REPLACEABLE_NOW)
    return filing_record(body)


def _project_or_refuse() -> str:
    project_id = project_context.get_project_id_from_context()
    if not project_id:
        raise _Refused(_NO_PROJECT)
    return project_id


_FILE_DRAFT_DESCRIPTION = (
    "Files a draft from the working directory into the project AS A DRAFT. `path`: `" + DRAFT_ROOT + "<name>.md`; "
    "`title` optional. "
    "Call it when the user asks („leg das ins Projekt“, „abspeichern“, „ablegen“), not on your own after "
    "every write. Again for the same path puts the current draft into the same document. A DRAFT: nobody has "
    "approved it. "
    "`submit=true` submits it FOR APPROVAL (filed and unchanged, it is only submitted). Call with `submit=true` "
    "only when the user asks for approval, review or hand-over — „ablegen“ alone is not such a request. "
    "`reviewer` (only with submit): the person exactly as the user named them; without it the draft goes to "
    "the project's editors. "
    "`folder`: a folder the user named. A file made from a project document files as its own file, unless "
    'the user asks for its new version: `file_as="new_revision"` and `change_note`. '
    '`file_as="over_changes"`/`"separate_file"` only answer a refusal, as the user chose.'
)

_REVIEWER_WITHOUT_SUBMIT = (
    "Error: `reviewer` applies only together with `submit=true`. Nothing was filed. If the user "
    "asked for approval or review, call again with `submit=true`; otherwise without `reviewer`."
)


class FileDraftConfig(FunctionBaseConfig, name="file_draft"): ...


async def _refile(path: str, usage: DraftUsage, choice: _Choice, envelope: SignedEnvelope) -> dict[str, str]:
    return await _update(path, usage, usage.filing, envelope, over_changes=choice.over_changes)


async def _put(path: str, usage: DraftUsage, choice: _Choice, envelope: SignedEnvelope) -> tuple[dict[str, str], bool]:
    if choice.file_as == FILE_AS_REVISION:
        return await _revise_source(path, usage, choice, envelope), False
    filed = bool(usage.filing.get(FILED_DOCUMENT_KEY))
    if filed and choice.file_as != FILE_AS_SEPARATE:
        return await _refile(path, usage, choice, envelope), False
    if filed:
        choice = replace(choice, separate_ref=_separate_reference(path))
    return await _create(path, usage, choice, envelope), True


def _separate_reference(path: str) -> str:
    ref = filing_reference(_conversation_id(), path)
    suffix = f"-{uuid4().hex[:8]}"
    return f"{ref[: MAX_REF_CHARS - len(suffix)]}{suffix}"


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
    emit_draft_card(
        path=path, content=usage.content or "", version=usage.version or 1, filing=submitted, size=_card_size(usage)
    )
    return (
        f"Submitted for approval {_whom(reviewer)}: „{draft_title(path, usage.content or '')}“ is now waiting "
        f"for review by a person. {_STILL_A_DRAFT}"
    )


def _filed_message(chosen: str, usage: DraftUsage, choice: _Choice, first: bool) -> str:
    if choice.file_as == FILE_AS_REVISION:
        source = usage.derived_from.get("name") or "the project document"
        return f"Filed in the project as the new version of „{source}“, as a draft. {_STILL_A_DRAFT}"
    verb = "Filed in the project" if first else "Filed in the project as the current version of the draft"
    return f"{verb}: „{chosen}“. {_STILL_A_DRAFT}"


async def _file(path: str, choice: _Choice, *, submit: bool, reviewer: str) -> str:
    path = modernize_draft_path(path)
    _project_or_refuse()
    envelope = _envelope()
    named = " ".join((reviewer or "").split())[:MAX_REVIEWER_CHARS]
    if named and not submit:
        raise _Refused(_REVIEWER_WITHOUT_SUBMIT)
    backend, usage = await _draft(path)
    if submit and usage.filed_unchanged and not choice.file_as:
        return await _submit_unchanged(backend, path, usage, named, envelope)

    chosen = choice.title or draft_title(path, usage.content or "")
    filing, first = await _put(path, usage, replace(choice, title=chosen), envelope)
    if first and usage.made_by == MADE_BY_RUN:
        emit_scores(filed_scores(path), writer="file-draft")
    await backend.arecord_filing(path, filing, draft_version=usage.version)

    def _card(record: dict[str, str]) -> None:
        emit_draft_card(
            path=path,
            content=usage.content or "",
            version=usage.version or 1,
            filing=record,
            title=chosen,
            size=_card_size(usage),
            filed_at_version=usage.version or 1,
            previous_version=usage.previous_version,
            derived_from=usage.derived_from,
        )

    filed = _filed_message(chosen, usage, choice, first)
    if not submit:
        _card(filing)
        return f"{filed} The same call with `submit=true` can submit it for approval, if the user asks for that."
    try:
        submitted = await _submit(backend, path, filing, named, envelope, failure=_SUBMIT_FAILED_AFTER_FILING)
    except _Refused as refused:
        _card(filing)
        raise _Refused(f"{filed} — but NOT submitted. {refused.message}") from refused
    _card(submitted)
    return f"{filed} It is submitted for approval {_whom(named)} and now waits for review by a person."


def _clean(text: str | None, limit: int) -> str:
    return " ".join((text or "").split())[:limit]


async def run_file_draft(
    path: str,
    title: str | None = None,
    submit: bool = False,
    reviewer: str | None = None,
    folder: str | None = None,
    file_as: Literal["new_revision", "separate_file", "over_changes"] | None = None,
    change_note: str | None = None,
) -> str:
    choice = _Choice(
        title=_clean(title, MAX_TITLE_CHARS),
        folder=_clean(folder, MAX_FOLDER_CHARS),
        file_as="" if file_as == FILE_AS_OVER_CHANGES else file_as or "",
        over_changes=file_as == FILE_AS_OVER_CHANGES,
        change_note=_clean(change_note, MAX_CHANGE_NOTE_CHARS),
    )
    try:
        return await _file(path, choice, submit=submit, reviewer=reviewer or "")
    except _Refused as refused:
        return refused.message


@register_function(config_type=FileDraftConfig)
async def file_draft(tool_config: FileDraftConfig, builder: Builder):
    yield FunctionInfo.from_fn(run_file_draft, description=_FILE_DRAFT_DESCRIPTION)
