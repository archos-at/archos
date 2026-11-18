from __future__ import annotations

import json
import re
import shutil
import subprocess
from collections.abc import Callable
from pathlib import Path

import pytest
import yaml
from wcmatch import glob

ROOT = Path(__file__).resolve().parents[1]
FILTERS = ROOT / ".github" / "filters.yml"
FLAGS = glob.GLOBSTAR | glob.DOTGLOB

TEST_TIERS = ("backend", "workspace", "site", "cms", "infra", "packages", "migrations")

UNFILTERED = {
    "docs/**": "documentation",
    "*.md": "root documentation (README, AGENTS, VISION, CONTEXT, CONTRIBUTING, CLAUDE)",
    "NOTICE": "licence notice",
    ".gitattributes": "marks generated files for GitHub's diff view; nothing runs it",
    "data/oib/README.md": "says the corpus is operator-provided; nothing reads it",
    "skills/**": "agent skills; `task agents:audit` in Repo checks holds the lockfile to them",
    "apm.yml": "agent-skill manifest, audited by `task agents:audit`",
    "apm.lock.yaml": "agent-skill lockfile, audited by `task agents:audit`",
    "releasenotes/**": "Repo checks lints and requires the notes on every pull request",
    "ci/**": "CI scripts, tested by `be:test:harness`; data a tier reads is in that tier",
    ".github/workflows/*.yml": "workflows other than ci.yml, tested by `be:test:harness`",
    ".github/filters.yml": "this file's subject; tested here, in `be:test:harness`",
    "taskfiles/repo.yml": "the Repo checks job's own tasks",
    ".pre-commit-config.yaml": "the hooks Repo checks runs on every pull request",
    ".gitleaks.toml": "gitleaks, run by Repo checks",
    ".semgrepignore": "Semgrep, run by its own job on the `sast` filter",
    ".trivyignore.yaml": "Trivy, run by its own job on the image plan",
    ".dockerignore": "an image input; ci/image_inputs.py hashes what each image copies",
    ".github/CODEOWNERS": "review routing",
    ".github/*.md": "community and PR templates",
    ".github/ISSUE_TEMPLATE/**": "issue forms",
    ".github/dependabot.yml": "dependency update schedule",
    ".github/labeler.yml": "PR labelling",
    ".github/labels.yml": "label catalogue, applied by labels.yml",
    ".gitignore": "git configuration",
    ".devcontainer/**": "editor container",
    ".claude/**": "the cloud-session hook and settings for Claude Code",
}


def _filters() -> dict[str, list[str]]:
    return yaml.safe_load(FILTERS.read_text(encoding="utf-8"))


def _tier_patterns() -> list[str]:
    filters = _filters()
    return [pattern for tier in TEST_TIERS for pattern in filters[tier]]


def _tracked() -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [path for path in out.split("\0") if path]


def _matcher(patterns: list[str] | str) -> Callable[[str], bool]:
    include, exclude = glob.translate(patterns, flags=FLAGS)
    assert not exclude, f"an exclusion pattern is outside the shared grammar: {patterns}"
    compiled = [re.compile(expression) for expression in include]
    return lambda path: any(expression.match(path) for expression in compiled)


def _uncovered(paths: list[str]) -> list[str]:
    covered = _matcher(_tier_patterns() + list(UNFILTERED))
    return [path for path in paths if not covered(path)]


def test_every_tracked_path_is_in_a_tier_or_listed_as_in_none():
    uncovered = _uncovered(_tracked())
    assert uncovered == [], (
        "No CI tier watches these paths, so a change to them merges with no job run. "
        "Add them to the right family in .github/filters.yml, or to UNFILTERED here "
        "with why no tier needs them:\n  " + "\n  ".join(uncovered)
    )


def test_the_grammar_check_refuses_what_only_one_matcher_reads():
    for pattern in ("docs/{a,b}/**", "src/**.py", "a**/b", "[ab]/*", "!docs/**", "a//b"):
        assert not _in_shared_grammar(pattern), pattern
    for pattern in ("docs/**", "*.md", ".github/workflows/*.yml", "**/x", "Taskfile.yml"):
        assert _in_shared_grammar(pattern), pattern


def test_a_path_outside_every_tier_is_reported():
    assert _uncovered(["apps/moved-ui/src/page.tsx", "apps/workspace/src/page.tsx"]) == ["apps/moved-ui/src/page.tsx"]


def test_the_tiers_this_test_reads_exist():
    assert set(TEST_TIERS) <= set(_filters())


def test_every_unfiltered_entry_still_matches_something():
    paths = _tracked()
    stale = [pattern for pattern in UNFILTERED if not any(map(_matcher(pattern), paths))]
    assert stale == [], f"UNFILTERED entries that match no tracked path; delete them: {stale}"


SHARED_SEGMENT = re.compile(r"[A-Za-z0-9_.*-]+")


def _in_shared_grammar(pattern: str) -> bool:
    return all(
        segment == "**" or ("**" not in segment and SHARED_SEGMENT.fullmatch(segment)) for segment in pattern.split("/")
    )


def test_patterns_stay_in_the_grammar_both_matchers_share():
    patterns = [p for family in _filters().values() for p in family] + list(UNFILTERED)
    outside = [p for p in patterns if not _in_shared_grammar(p)]
    assert outside == [], (
        f"Patterns outside the grammar this test checks with wcmatch: {outside}. "
        "Widen SHARED_SEGMENT only after test_wcmatch_agrees_with_picomatch covers the new syntax."
    )


def _picomatch2() -> Path | None:
    for depth in ("picomatch", "*/node_modules/picomatch", "@*/*/node_modules/picomatch"):
        for candidate in sorted(ROOT.glob(f"apps/*/node_modules/{depth}/package.json")):
            if json.loads(candidate.read_text(encoding="utf-8")).get("version", "").startswith("2."):
                return candidate.parent
    return None


def test_wcmatch_agrees_with_picomatch():
    picomatch = _picomatch2()
    if shutil.which("node") is None or picomatch is None:
        pytest.skip("needs node and a picomatch 2.x under apps/*/node_modules (task setup)")
    patterns = sorted({p for family in _filters().values() for p in family} | set(UNFILTERED))
    paths = _tracked() + ["apps/moved-ui/src/page.tsx", ".github/x/y.yml", "a/.hidden/b"]
    script = (
        "const pm = require(process.argv[1]);"
        "const {patterns, paths} = JSON.parse(require('fs').readFileSync(0, 'utf8'));"
        "process.stdout.write(JSON.stringify(patterns.map(p => {"
        " const m = pm(p, {dot: true}); return paths.map(x => m(x)); })));"
    )
    result = subprocess.run(
        ["node", "-e", script, str(picomatch)],
        input=json.dumps({"patterns": patterns, "paths": paths}),
        capture_output=True,
        text=True,
        check=True,
    )
    expected = json.loads(result.stdout)
    disagreements = [
        (pattern, path, want)
        for pattern, row in zip(patterns, expected, strict=True)
        for matches in [_matcher(pattern)]
        for path, want in zip(paths, row, strict=True)
        if matches(path) != want
    ]
    assert disagreements == [], f"wcmatch and picomatch disagree (pattern, path, picomatch): {disagreements[:20]}"
