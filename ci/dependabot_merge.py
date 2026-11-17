from __future__ import annotations

import json
import sys
from collections.abc import Iterable
from typing import Any

USAGE = (
    "usage: python3 ci/dependabot_merge.py <update-type> <directory>\n"
    "       gh api repos/OWNER/REPO/rules/branches/BASE | python3 ci/dependabot_merge.py rules"
)

MERGES = frozenset({"version-update:semver-minor", "version-update:semver-patch"})

HELD_DIRECTORIES = ("/deploy/pulumi",)


def decide(update_type: str, directory: str) -> tuple[bool, str]:
    for held in HELD_DIRECTORIES:
        if directory == held or directory.startswith(held + "/"):
            return False, f"{directory} changes what only a deploy proves; a person merges it"
    if update_type not in MERGES:
        return False, f"update type {update_type or 'unknown'} needs a person to read it"
    return True, f"{update_type.removeprefix('version-update:semver-')} update; merges when CI OK passes"


GITHUB_ACTIONS_APP_ID = 15368
CI_OK = "CI OK"


def ci_ok_required(rules: Iterable[dict[str, Any]]) -> bool:
    for rule in rules:
        if rule.get("type") != "required_status_checks":
            continue
        for check in rule.get("parameters", {}).get("required_status_checks", []):
            if check.get("context") == CI_OK and check.get("integration_id") == GITHUB_ACTIONS_APP_ID:
                return True
    return False


def required_reviews(rules: Iterable[dict[str, Any]]) -> int:
    counts = [
        rule.get("parameters", {}).get("required_approving_review_count", 0)
        for rule in rules
        if rule.get("type") == "pull_request"
    ]
    return max(counts, default=0)


def main(argv: list[str]) -> int:
    if argv[1:] == ["rules"]:
        rules = json.load(sys.stdin)
        print(f"ci_ok_required={'true' if ci_ok_required(rules) else 'false'}")
        print(f"reviews={required_reviews(rules)}")
        return 0
    if len(argv) != 3:
        print(USAGE, file=sys.stderr)
        return 2
    merge, reason = decide(argv[1], argv[2])
    print(f"merge={'true' if merge else 'false'}")
    print(f"reason={reason}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
