from __future__ import annotations

import logging

from agent import project_context
from agent.tools.files.cards import propose_file_operation
from agent.tools.files.resolve import Refusal
from agent.tools.files.resolve import ResolvedDocument
from agent.tools.files.resolve import known_folders
from agent.tools.files.resolve import resolve_document
from agent.tools.files.resolve import resolve_folder
from nat.plugin_api import Builder
from nat.plugin_api import FunctionBaseConfig
from nat.plugin_api import FunctionInfo
from nat.plugin_api import register_function

logger = logging.getLogger(__name__)

_PROPOSED = (
    "A proposal was shown as a card. NOTHING has been changed YET — "
    "do not say it is done; the user decides on the card."
)

_NOT_PROPOSED = (
    "Error: The proposal could not be created (no card channel, or the server did not accept it), "
    "so nobody can accept anything. Nothing was changed. Say so; the person can make the change "
    "themselves in the project files or ask you to propose it again. "
    "Do not retry in this turn."
)

_NO_PROJECT = (
    "Error: This conversation belongs to no project, so there are no project files to organise. "
    "Nothing was changed. Do not retry."
)


MAX_REASON_CHARS = 200


def _reason_field(reason: str) -> dict[str, str]:
    text = " ".join((reason or "").split())
    if len(text) > MAX_REASON_CHARS:
        text = text[: MAX_REASON_CHARS - 1].rstrip() + "…"
    return {"reason": text} if text else {}


def _project_or_error() -> str | None:
    return None if project_context.get_project_id_from_context() else _NO_PROJECT


def _document(name: str) -> ResolvedDocument | str:
    resolved = resolve_document(name)
    return resolved.message if isinstance(resolved, Refusal) else resolved


async def _move(document: str, target_folder: str, reason: str = "") -> str:
    resolved = _document(document)
    if isinstance(resolved, str):
        return resolved
    folder = resolve_folder(target_folder)
    if isinstance(folder, Refusal):
        return folder.message
    if folder == resolved.folder_path:
        where = f"„{folder}“" if folder else "the top level"
        return f"`{resolved.file_name}` is already in {where}. No proposal needed."

    item = {
        "document": resolved.file_name,
        "source": resolved.source,
        "current": resolved.folder_path,
        "target_folder": folder,
        **_reason_field(reason),
    }
    title = (
        f"Verschieben nach „{folder}“" if folder else "Auf die oberste Ebene verschieben"
    )  # card title: shown to the person
    if not await propose_file_operation(operation="move", title=title, item=item):
        return _NOT_PROPOSED
    return f"Proposed: `{resolved.file_name}` → {folder or 'top level'}. {_PROPOSED}"


MAX_DISPLAY_NAME_CHARS = 255


async def _rename(document: str, new_name: str, reason: str = "") -> str:
    resolved = _document(document)
    if isinstance(resolved, str):
        return resolved
    name = " ".join((new_name or "").split())
    if not name:
        return "Error: `new_name` is empty. Give the new display name."
    if len(name) > MAX_DISPLAY_NAME_CHARS:
        return f"Error: The new name is longer than {MAX_DISPLAY_NAME_CHARS} characters. Shorten it."
    if name == resolved.file_name:
        return f"`{resolved.file_name}` already has that name. No proposal needed."

    item = {
        "document": resolved.file_name,
        "source": resolved.source,
        "current": resolved.file_name,
        "new_display_name": name,
        **_reason_field(reason),
    }
    if not await propose_file_operation(operation="rename", title="Datei umbenennen", item=item):
        return _NOT_PROPOSED
    return f"Proposed: `{resolved.file_name}` → „{name}“. {_PROPOSED}"


_FOLDER_NAME_MAX = 120


async def _create_folder(name: str, parent: str, reason: str = "") -> str:
    folder_name = " ".join((name or "").split())
    if not folder_name:
        return "Error: `new_name` is empty. Give the name of the new folder."
    if "/" in folder_name or "\\" in folder_name:
        return (
            "Error: `new_name` is ONE folder name without slashes. For a subfolder, give the "
            "parent path in `target_folder`."
        )
    if len(folder_name) > _FOLDER_NAME_MAX:
        return f"Error: Folder names are limited to {_FOLDER_NAME_MAX} characters. Shorten it."

    parent_path = resolve_folder(parent)
    if isinstance(parent_path, Refusal):
        return parent_path.message
    full = f"{parent_path}/{folder_name}" if parent_path else folder_name
    if full.casefold() in {folder.casefold() for folder in known_folders()}:
        return f"The folder „{full}“ already exists. No proposal needed; you can move files into it directly."

    item = {"folder_name": folder_name, "parent_folder": parent_path, "current": full, **_reason_field(reason)}
    if not await propose_file_operation(operation="create_folder", title="Neuen Ordner anlegen", item=item):
        return _NOT_PROPOSED
    return f"Proposed: new folder „{full}“. {_PROPOSED}"


async def _assign(document: str, member: str, reason: str = "") -> str:
    resolved = _document(document)
    if isinstance(resolved, str):
        return resolved
    person = " ".join((member or "").split())
    if not person:
        return "Error: `member` is empty. Give the person as the user named them."

    item = {"document": resolved.file_name, "source": resolved.source, "member": person, **_reason_field(reason)}
    if not await propose_file_operation(operation="assign", title="Datei zuweisen", item=item):
        return _NOT_PROPOSED
    return f"Proposed: `{resolved.file_name}` → {person}. {_PROPOSED}"


_DESCRIPTION = (
    "PROPOSES a change to the project's files — changes nothing itself. A card is created that the "
    "user accepts or dismisses; only then is it carried out, in their own session. "
    "Propose only when the user asks for it („leg die Einreichunterlagen in einen Ordner“, "
    "„benenn das um“, „gib das Anna“) or a name is demonstrably wrong.\n"
    "`operation` and what it needs:\n"
    "- `move`: `document` into the existing folder `target_folder` (path like 'Einreichung/Akten', "
    "empty = top level).\n"
    "- `rename`: `document` gets the display name `new_name` (the stored file name stays).\n"
    "- `create_folder`: new folder `new_name` (ONE segment, no slashes) under "
    "`target_folder` (empty = top level). `move` can put files into it afterwards; the user accepts the "
    "cards in that order.\n"
    "- `assign`: `document` to the person `member`, as the user named them (name or "
    "email) — not checked here, but resolved against the project members on acceptance. Propose only "
    "when the user named the person themselves, and take the name over unchanged; "
    "never infer a person from context.\n"
    "`reason` (for every operation, keep it short): ONE sentence, at most 200 characters, that the person reads on the "
    "card — why exactly this change („gehört zum Bescheid vom 12. März“). Only what you can substantiate from "
    "the file name, content or conversation; nothing invented. The reason is stored with the proposal and "
    "appears among the decisions in later turns.\n"
    "`document` is the file name exactly as the overview or a listing shows it. One call "
    "proposes ONE change; several files are several calls."
)

_OPERATIONS = ("move", "rename", "create_folder", "assign")


class ProposeFileChangeConfig(FunctionBaseConfig, name="propose_file_change"): ...


@register_function(config_type=ProposeFileChangeConfig)
async def propose_file_change(tool_config: ProposeFileChangeConfig, builder: Builder):
    async def _propose(
        operation: str,
        document: str = "",
        target_folder: str = "",
        new_name: str = "",
        member: str = "",
        reason: str = "",
    ) -> str:
        if (refused := _project_or_error()) is not None:
            return refused
        op = (operation or "").strip().lower()
        if op == "move":
            return await _move(document, target_folder, reason)
        if op == "rename":
            return await _rename(document, new_name, reason)
        if op == "create_folder":
            return await _create_folder(new_name, target_folder, reason)
        if op == "assign":
            return await _assign(document, member, reason)
        return f"Error: `operation` must be one of {', '.join(_OPERATIONS)}."

    yield FunctionInfo.from_fn(_propose, description=_DESCRIPTION)
