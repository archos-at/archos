#!/usr/bin/env python3


from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any
from typing import Protocol

REPO_ROOT = Path(__file__).resolve().parents[1]
FALLBACK_FILE = REPO_ROOT / "packages/agent/src/agent/core/prompts/chat_static.md"
PROMPT_NAME = "piloti-system-static"

EXIT_OK = 0
EXIT_ABSENT = 1
EXIT_UNCONFIGURED = 2


class PromptApi(Protocol):
    def get_prompt(self, name: str, *, label: str, cache_ttl_seconds: int, type: str) -> Any: ...


def fetch_version(client: PromptApi, *, name: str = PROMPT_NAME, label: str = "production") -> Any | None:
    from langfuse.api import NotFoundError

    try:
        return client.get_prompt(name, label=label, cache_ttl_seconds=0, type="text")
    except NotFoundError:
        return None


def fetch_text(client: PromptApi, *, name: str = PROMPT_NAME, label: str = "production") -> str | None:
    text = getattr(fetch_version(client, name=name, label=label), "prompt", None)
    return text if isinstance(text, str) else None


def write_fallback(text: str, path: Path | None = None) -> bool:
    path = FALLBACK_FILE if path is None else path
    normalized = text.rstrip("\n") + "\n"
    if path.exists() and path.read_text(encoding="utf-8") == normalized:
        return False
    path.write_text(normalized, encoding="utf-8")
    return True


def build_client() -> PromptApi | None:
    from agent.common.prompt_store import HOST_ENV
    from agent.common.prompt_store import PUBLIC_KEY_ENV
    from agent.common.prompt_store import SECRET_KEY_ENV

    public_key = os.environ.get(PUBLIC_KEY_ENV, "").strip()
    secret_key = os.environ.get(SECRET_KEY_ENV, "").strip()
    if not public_key or not secret_key:
        return None
    from langfuse import Langfuse

    return Langfuse(
        public_key=public_key,
        secret_key=secret_key,
        host=os.environ.get(HOST_ENV, "").strip() or None,
        tracing_enabled=False,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Bring a Langfuse version of the platform prompt into review.")
    parser.add_argument("--label", default="production", help="the Langfuse label to pull (default: production)")
    parser.add_argument("--name", default=PROMPT_NAME, help="the Langfuse prompt name")
    args = parser.parse_args(argv)

    client = build_client()
    if client is None:
        print(
            "prompts_pull: LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY are not set; the prompt file was not touched.",
            file=sys.stderr,
        )
        return EXIT_UNCONFIGURED

    text = fetch_text(client, name=args.name, label=args.label)
    if text is None:
        print(f"prompts_pull: Langfuse has no {args.label!r} version of {args.name!r}.", file=sys.stderr)
        return EXIT_ABSENT

    changed = write_fallback(text)
    state = "updated" if changed else "already current"
    print(f"prompts_pull: {FALLBACK_FILE.relative_to(REPO_ROOT)} {state} from {args.name} ({args.label}).")
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
