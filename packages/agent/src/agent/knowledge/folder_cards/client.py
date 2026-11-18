from __future__ import annotations

import logging
from collections.abc import Iterable
from typing import Any

from agent.common import bff_http

logger = logging.getLogger(__name__)

FOLDER_CARDS_PATH = "/api/internal/folder-cards"
REQUEST_TIMEOUT_SECONDS = 15
READ_TIMEOUT_SECONDS = 3


class FolderCardsError(bff_http.BffError):
    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message, status=status)


def put_request(
    *,
    organization_id: str,
    collection: str,
    folder_path: str,
    abstract: str | None,
    key_facts: Iterable[dict[str, Any]],
    input_hash: str,
    abstract_hash: str | None,
    model: str | None,
    prompt_version: str | None,
    status: str,
) -> dict[str, Any]:
    return {
        "organization_id": organization_id,
        "collection": collection,
        "folder_path": folder_path,
        "abstract": abstract,
        "key_facts": list(key_facts),
        "input_hash": input_hash,
        "abstract_hash": abstract_hash,
        "model": model,
        "prompt_version": prompt_version,
        "status": status,
    }


def _call(method: str, query: dict[str, str] | None = None, body: dict[str, Any] | None = None, timeout: float = 0):
    try:
        parsed = bff_http.request_json(
            method, FOLDER_CARDS_PATH, timeout=timeout or REQUEST_TIMEOUT_SECONDS, body=body, query=query
        )
    except bff_http.BffNotConfiguredError as exc:
        raise FolderCardsError(str(exc)) from exc
    except bff_http.BffRefusedError as exc:
        raise FolderCardsError(f"the folder cards route refused ({exc.status})", status=exc.status) from exc
    except bff_http.BffError as exc:
        raise FolderCardsError("the folder cards route could not be reached") from exc
    if not isinstance(parsed, dict):
        raise FolderCardsError("the folder cards route answered with something that is not an object")
    return parsed


def put_card(body: dict[str, Any]) -> bool:
    try:
        _call("PUT", body=body)
    except FolderCardsError as exc:
        if exc.status == 404:
            return False
        raise
    return True


def get_cards(organization_id: str, collection: str, *, timeout: float = 0) -> dict[str, dict[str, Any]]:
    return read_collection(organization_id, collection, timeout=timeout)[0]


def read_collection(
    organization_id: str, collection: str, *, timeout: float = 0
) -> tuple[dict[str, dict[str, Any]], dict[str, str], set[str] | None]:
    reply = _call("GET", query={"organization_id": organization_id, "collection": collection}, timeout=timeout)
    cards = reply.get("cards")
    by_path = (
        {
            str(card["folder_path"]).strip("/"): card
            for card in cards
            if isinstance(card, dict) and card.get("folder_path")
        }
        if isinstance(cards, list)
        else {}
    )
    folders = reply.get("folders")
    descriptions = (
        {
            str(folder["folder_path"]).strip("/"): str(folder["folder_description"])
            for folder in folders
            if isinstance(folder, dict) and folder.get("folder_path") and folder.get("folder_description")
        }
        if isinstance(folders, list)
        else {}
    )
    owned = (
        {
            str(folder["folder_path"]).strip("/")
            for folder in folders
            if isinstance(folder, dict) and folder.get("folder_path")
        }
        if isinstance(folders, list)
        else None
    )
    return by_path, descriptions, owned


def delete_card(organization_id: str, collection: str, folder_path: str) -> bool:
    query = {"organization_id": organization_id, "collection": collection, "folder_path": folder_path}
    try:
        reply = _call("DELETE", query=query)
    except FolderCardsError as exc:
        if exc.status == 404:
            return False
        raise
    return bool(reply.get("deleted"))
