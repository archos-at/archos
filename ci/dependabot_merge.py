"""Which Dependabot pull requests merge themselves once `CI OK` passes.

`.github/workflows/dependabot-auto-merge.yml` asks this with the metadata
`dependabot/fetch-metadata` reads from the pull request, and turns on GitHub's
auto-merge only on a yes. CI is the judge of a lockfile bump; this decides
only which bumps nobody needs to read first.

    python3 ci/dependabot_merge.py <update-type> <directory>

prints `merge=true|false` and `reason=...`, the lines the workflow appends to
`$GITHUB_OUTPUT`.

    gh api repos/OWNER/REPO/rules/branches/BASE | python3 ci/dependabot_merge.py rules

reads the base branch's active rules and prints `ci_ok_required=true|false`
and `reviews=<n>`, the approvals the branch requires.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Iterable
from typing import Any

# A group's update type is its largest member's (fetch-metadata), so a group
# that carries one major is held as a whole.
MERGES = frozenset({"version-update:semver-minor", "version-update:semver-patch"})

# Directories whose bump moves something CI cannot exercise. The Pulumi SDK
# pins the CLI the deploy installs (deploy.yml), so it is proven only by a
# deploy: a person merges it (.github/dependabot.yml, the deploy/pulumi entry).
HELD_DIRECTORIES = ("/deploy/pulumi",)


def decide(update_type: str, directory: str) -> tuple[bool, str]:
    """Whether to auto-merge, and the reason a person reads in the log."""
    for held in HELD_DIRECTORIES:
        if directory == held or directory.startswith(held + "/"):
            return False, f"{directory} changes what only a deploy proves; a person merges it"
    if update_type not in MERGES:
        # Majors, and a security update whose version jump fetch-metadata
        # could not classify (empty update type).
        return False, f"update type {update_type or 'unknown'} needs a person to read it"
    return True, f"{update_type.removeprefix('version-update:semver-')} update; merges when CI OK passes"


# The GitHub Actions app. A required check bound to it can only be passed by a
# workflow run of this repository; one bound to no app ("any source") or to
# another app can be passed by any integration that may write checks.
GITHUB_ACTIONS_APP_ID = 15368
CI_OK = "CI OK"


def ci_ok_required(rules: Iterable[dict[str, Any]]) -> bool:
    """Whether `CI OK`, from GitHub Actions, is a required check.

    Auto-merge on a pull request with no required check merges it at once, so
    without this rule the workflow must not turn auto-merge on.
    """
    for rule in rules:
        if rule.get("type") != "required_status_checks":
            continue
        for check in rule.get("parameters", {}).get("required_status_checks", []):
            if check.get("context") == CI_OK and check.get("integration_id") == GITHUB_ACTIONS_APP_ID:
                return True
    return False


def required_reviews(rules: Iterable[dict[str, Any]]) -> int:
    """The approving reviews the branch requires, the most any rule asks."""
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
        print(__doc__, file=sys.stderr)
        return 2
    merge, reason = decide(argv[1], argv[2])
    print(f"merge={'true' if merge else 'false'}")
    print(f"reason={reason}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
