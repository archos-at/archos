from __future__ import annotations

import json
from pathlib import Path


def _identity() -> dict:
    return json.loads(Path(__file__).with_name("identity.json").read_text(encoding="utf-8"))


PRODUCT_NAME = str(_identity()["name"])

PRODUCT_DOMAINS: tuple[str, ...] = tuple(
    str(domain).lower() for domain in (_identity().get("domain"), *_identity().get("formerDomains", ())) if domain
)
