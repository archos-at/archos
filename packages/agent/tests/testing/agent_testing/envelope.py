from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

from agent.project_context import REQUEST_CONTEXT_ENVELOPE_HEADER
from agent.project_context import REQUEST_CONTEXT_ENVELOPE_SIG_HEADER

SECRET = "request-context-test-secret"


def signed_envelope(secret: str = SECRET, **payload: Any) -> tuple[str, str]:
    payload.setdefault("issuedAt", int(time.time() * 1000))
    raw = json.dumps(payload)
    header = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")
    return header, hmac.new(secret.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()


def signed_headers(secret: str = SECRET, **payload: Any) -> dict[str, str]:
    header, signature = signed_envelope(secret, **payload)
    return {REQUEST_CONTEXT_ENVELOPE_HEADER: header, REQUEST_CONTEXT_ENVELOPE_SIG_HEADER: signature}
