#!/usr/bin/env python3


from __future__ import annotations

import argparse
import difflib
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from typing import Protocol

sys.path.insert(0, str(Path(__file__).resolve().parent))
from prompts_pull import FALLBACK_FILE  # noqa: E402
from prompts_pull import PROMPT_NAME  # noqa: E402
from prompts_pull import REPO_ROOT  # noqa: E402
from prompts_pull import PromptApi as ReadApi  # noqa: E402
from prompts_pull import build_client  # noqa: E402
from prompts_pull import fetch_version  # noqa: E402

EXIT_OK = 0
EXIT_WOULD_CHANGE = 1
EXIT_UNCONFIGURED = 2
EXIT_REFUSED = 3

GIT_TAG = "git"

_COMMIT_MESSAGE_RE = re.compile(r"^git ([0-9a-f]{7,40}) (\S+)$")


class PromptApi(ReadApi, Protocol):
    def create_prompt(
        self, *, name: str, prompt: str, labels: list[str], tags: list[str], type: str, commit_message: str
    ) -> Any: ...


@dataclass(frozen=True)
class Plan:
    action: str
    version: int | None = None
    diff: str = ""


def committed_text(text: str) -> str:
    return text.rstrip("\n")


def text_at(sha: str, path: str) -> str | None:
    shown = subprocess.run(["git", "show", f"{sha}:{path}"], cwd=REPO_ROOT, capture_output=True, text=True, check=False)
    return shown.stdout if shown.returncode == 0 else None


def published_from_git(live: Any) -> bool:
    served = committed_text(getattr(live, "prompt", "") or "")
    match = _COMMIT_MESSAGE_RE.match((getattr(live, "commit_message", None) or "").strip())
    if match is not None:
        committed = text_at(match.group(1), match.group(2))
        if committed is not None and committed_text(committed) == served:
            return True
    return any(committed_text(text) == served for text in file_history())


def file_history() -> list[str]:
    relative = str(FALLBACK_FILE.relative_to(REPO_ROOT))
    shas = subprocess.run(
        ["git", "log", "--format=%H", "--", relative], cwd=REPO_ROOT, capture_output=True, text=True, check=False
    ).stdout.split()
    return [text for sha in shas if (text := text_at(sha, relative)) is not None]


def plan(live: Any | None, text: str, *, label: str) -> Plan:
    if live is None:
        return Plan("create")
    served = committed_text(getattr(live, "prompt", "") or "")
    version = getattr(live, "version", None)
    if served == committed_text(text):
        return Plan("same", version)
    diff = "\n".join(
        difflib.unified_diff(
            served.splitlines(),
            committed_text(text).splitlines(),
            fromfile=f"langfuse:{label} (v{version})",
            tofile=str(FALLBACK_FILE.relative_to(REPO_ROOT)),
            lineterm="",
        )
    )
    diff = diff + "\n" if diff else diff
    if not published_from_git(live):
        return Plan("refuse", version, diff)
    return Plan("update", version, diff)


def git_origin() -> tuple[str, bool]:
    relative = str(FALLBACK_FILE.relative_to(REPO_ROOT))
    sha = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True, check=True
    ).stdout.strip()
    diff = subprocess.run(["git", "diff", "--quiet", "HEAD", "--", relative], cwd=REPO_ROOT, check=False)
    dirty = diff.returncode != 0
    return sha, dirty


def publish(client: PromptApi, text: str, *, name: str, label: str, sha: str) -> Any:
    return client.create_prompt(
        name=name,
        prompt=committed_text(text),
        labels=[label],
        tags=[GIT_TAG],
        type="text",
        commit_message=f"git {sha[:12]} {FALLBACK_FILE.relative_to(REPO_ROOT)}",
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Publish the committed platform prompt to Langfuse, or say what publishing would change."
    )
    parser.add_argument(
        "--label", default=None, help="the Langfuse label (check default: production; --apply requires it)"
    )
    parser.add_argument("--name", default=PROMPT_NAME, help="the Langfuse prompt name")
    parser.add_argument("--apply", action="store_true", help="write the new version; without it, only check")
    args = parser.parse_args(argv)
    if args.apply and not args.label:
        print("prompts_push: --apply needs the label named, e.g. --label staging.", file=sys.stderr)
        return EXIT_REFUSED
    args.label = args.label or "production"

    client = build_client()
    if client is None:
        print(
            "prompts_push: LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY are not set; nothing was checked.",
            file=sys.stderr,
        )
        return EXIT_UNCONFIGURED

    text = FALLBACK_FILE.read_text(encoding="utf-8")
    decided = plan(fetch_version(client, name=args.name, label=args.label), text, label=args.label)
    where = f"{args.name} ({args.label})"

    if decided.action == "same":
        print(f"prompts_push: {where} v{decided.version} already serves the committed file.")
        return EXIT_OK
    if decided.action == "refuse":
        sys.stdout.write(decided.diff)
        print(
            f"prompts_push: {where} v{decided.version} was edited in Langfuse, not published from git. "
            f"Bring it into review first: task prompts:pull -- --label {args.label}, commit, then push.",
            file=sys.stderr,
        )
        return EXIT_REFUSED

    sys.stdout.write(decided.diff)
    if not args.apply:
        verb = "create" if decided.action == "create" else f"replace v{decided.version} of"
        print(f"prompts_push: would {verb} {where}. Run with --apply to publish.")
        return EXIT_WOULD_CHANGE

    sha, dirty = git_origin()
    if dirty:
        print(
            f"prompts_push: {FALLBACK_FILE.relative_to(REPO_ROOT)} has uncommitted changes; commit it first, "
            "so the version names the commit it came from.",
            file=sys.stderr,
        )
        return EXIT_REFUSED
    created = publish(client, text, name=args.name, label=args.label, sha=sha)
    print(f"prompts_push: published {where} as v{getattr(created, 'version', '?')} from {sha[:12]}.")
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
