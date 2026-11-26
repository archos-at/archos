from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import turn_input


def precedent_envelope(
    office: dict, conversation_id: str, secret: str, current: dict | None = None, extra: dict | None = None
) -> tuple[str, str]:
    import base64
    import hashlib
    import hmac

    current = current or office["current"]
    raw = json.dumps(
        {
            "organizationId": office["organizationId"],
            "userId": office["userId"],
            "projectId": current["id"],
            "conversationId": conversation_id,
            "issuedAt": int(time.time() * 1000),
            "contextTransport": "bff",
            "federalState": current.get("facts", {}).get("federal_state"),
            **(extra or {}),
        },
        ensure_ascii=False,
    )
    header = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")
    signature = hmac.new(secret.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    return header, signature


def start_workspace_bff(out: Path) -> tuple[Any, Any]:
    import secrets

    from fixture_bff import FixtureBFF
    from fixture_workspace import FixtureWorkspace

    token = secrets.token_hex(16)
    workspace = FixtureWorkspace()
    bff = FixtureBFF(token, out / "requests.jsonl", workspace=workspace).start()
    office = workspace.office
    project = next(p for p in office["projects"] if p["id"] == office["current"])

    def env_for(conversation_id: str, question: dict) -> dict[str, str]:
        header, signature = precedent_envelope(
            {"organizationId": office["organizationId"], "userId": office["userId"]},
            conversation_id,
            token,
            {"id": project["id"]},
        )
        return {
            "FRONTEND_INTERNAL_URL": bff.url,
            "INTERNAL_API_TOKEN": token,
            "EVAL_ENVELOPE": header,
            "EVAL_ENVELOPE_SIG": signature,
        }

    return bff, env_for


def start_files_bff(out: Path) -> tuple[Any, Any]:
    import secrets

    from fixture_bff import FixtureBFF
    from fixture_files import FilesWorkspace

    token = secrets.token_hex(16)
    workspace = FilesWorkspace()
    bff = FixtureBFF(token, out / "requests.jsonl", workspace=workspace).start()

    def env_for(conversation_id: str, question: dict) -> dict[str, str]:
        header, signature = precedent_envelope(
            workspace.office, conversation_id, token, {"id": workspace.project_id}, extra=workspace.envelope_fields
        )
        return {
            "FRONTEND_INTERNAL_URL": bff.url,
            "INTERNAL_API_TOKEN": token,
            "EVAL_ENVELOPE": header,
            "EVAL_ENVELOPE_SIG": signature,
            **turn_input.env_for(question),
        }

    return bff, env_for


def start_visual_bff(out: Path, look: bool = True) -> tuple[Any, Any]:
    import secrets

    from fixture_bff import FixtureBFF
    from fixture_visual import VisualWorkspace

    token = secrets.token_hex(16)
    workspace = VisualWorkspace.rendered(out / "drawings")
    bff = FixtureBFF(token, out / "requests.jsonl", workspace=workspace).start()

    def env_for(conversation_id: str, question: dict) -> dict[str, str]:
        header, signature = precedent_envelope(
            workspace.office, conversation_id, token, {"id": workspace.project_id}, extra=workspace.envelope_fields
        )
        return {
            "FRONTEND_INTERNAL_URL": bff.url,
            "INTERNAL_API_TOKEN": token,
            "EVAL_ENVELOPE": header,
            "EVAL_ENVELOPE_SIG": signature,
            **workspace.env(bff.url, look),
            **turn_input.env_for(question),
        }

    return bff, env_for


def start_fixture_bff(out: Path) -> tuple[Any, Any]:
    import secrets

    from fixture_bff import FixtureBFF
    from fixture_bff import production_embedder

    token = secrets.token_hex(16)
    bff = FixtureBFF(token, out / "requests.jsonl", embed=production_embedder()).start()

    def env_for(conversation_id: str, question: dict) -> dict[str, str]:
        from fixture_bff import DEFAULT_SCENARIO

        office = bff.assign(conversation_id, str(question.get("scenario") or DEFAULT_SCENARIO))
        header, signature = precedent_envelope(office.office, conversation_id, token, office.current)
        return {
            "FRONTEND_INTERNAL_URL": bff.url,
            "INTERNAL_API_TOKEN": token,
            "EVAL_ENVELOPE": header,
            "EVAL_ENVELOPE_SIG": signature,
        }

    return bff, env_for
