from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

from agent.common.turn_decision import TurnDecision
from agent.common.turn_decision import verify_decision

SECRET = "turn-decision-test-secret"


def decision_payload(**overrides: Any) -> dict[str, Any]:
    may = {
        "shelves": [{"collection": "oib_knowledge", "shelf": "base", "countries": ["AT"]}],
        "restrictedCollections": [],
        "otherProjects": {"reach": "chat-projects", "restrictedFolders": True},
        "personalMemory": True,
        "personalShelf": True,
        "workspaceRead": "all",
        "features": {"deepResearch": True, "tasks": True},
    }
    may.update(overrides.pop("may", {}))
    payload = {
        "conversationId": "s_conv_1",
        "answerMessageId": None,
        "kind": "chat",
        "solo": True,
        "recordedRestricted": False,
        "audienceVersion": 0,
        "issuedAt": int(time.time() * 1000),
        "may": may,
    }
    payload.update(overrides)
    return payload


def sign_payload(payload: dict[str, Any], secret: str = SECRET) -> tuple[str, str]:
    raw = json.dumps(payload).encode("utf-8")
    header = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    return header, hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()


def signed_decision(secret: str = SECRET, **overrides: Any) -> TurnDecision:
    header, signature = sign_payload(decision_payload(**overrides), secret)
    decision = verify_decision(header, signature, secret)
    assert decision is not None
    return decision
