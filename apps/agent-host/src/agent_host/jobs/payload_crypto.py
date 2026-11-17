from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

_ENC_PREFIX = "enc:"
_PLAIN_PREFIX = "json:"
_warned_plaintext = False


class PayloadKeyError(RuntimeError): ...


def _kek() -> bytes | None:
    raw = os.environ.get("JOB_PAYLOAD_KEK", "").strip()
    if not raw:
        return None
    try:
        key = base64.b64decode(raw)
    except Exception as exc:  # noqa: BLE001
        raise PayloadKeyError("JOB_PAYLOAD_KEK is not valid base64") from exc
    if len(key) != 32:
        raise PayloadKeyError("JOB_PAYLOAD_KEK must decode to 32 bytes (AES-256)")
    return key


def serialize(payload: dict[str, Any]) -> str:
    data = json.dumps(payload).encode("utf-8")
    kek = _kek()
    if kek is None:
        global _warned_plaintext
        if not _warned_plaintext:
            logger.warning(
                "JOB_PAYLOAD_KEK is not set — research-job payloads (including the user auth "
                "token) are stored as PLAINTEXT in Postgres. Set a 32-byte base64 KEK to encrypt "
                "them at rest before running multi-node/production."
            )
            _warned_plaintext = True
        return _PLAIN_PREFIX + base64.b64encode(data).decode("ascii")

    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    nonce = os.urandom(12)
    ciphertext = AESGCM(kek).encrypt(nonce, data, None)
    return _ENC_PREFIX + base64.b64encode(nonce + ciphertext).decode("ascii")


def serialize_encrypted(payload: dict[str, Any]) -> str:
    require_kek()
    return serialize(payload)


def require_kek() -> None:
    if _kek() is None:
        raise PayloadKeyError("JOB_PAYLOAD_KEK is not set; a research payload never leaves this tier unencrypted")


def deserialize(stored: str) -> dict[str, Any]:
    if stored.startswith(_ENC_PREFIX):
        kek = _kek()
        if kek is None:
            raise PayloadKeyError("payload is encrypted but JOB_PAYLOAD_KEK is not set")
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM

        blob = base64.b64decode(stored[len(_ENC_PREFIX) :])
        nonce, ciphertext = blob[:12], blob[12:]
        data = AESGCM(kek).decrypt(nonce, ciphertext, None)
        return json.loads(data)
    if _kek() is not None:
        raise PayloadKeyError("payload is not encrypted but JOB_PAYLOAD_KEK is set; refusing plaintext")
    if stored.startswith(_PLAIN_PREFIX):
        return json.loads(base64.b64decode(stored[len(_PLAIN_PREFIX) :]))
    return json.loads(stored)
