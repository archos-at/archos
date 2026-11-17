#!/usr/bin/env python3

"""Keep the product's name out of every new code and infrastructure identifier.

Why this exists
---------------

The product has been called AI-Q, then Grid, then Piloti, now ARCHOS, and it is
about to change again. Every rename so far was a code change across thousands of lines,
because the name sat in identifiers, file names, environment variables, routes
and resource names. The name belongs in user-facing copy, read from one place,
so the next rename is a copy change.

What it checks
--------------

A ratchet, in the style of `scripts/check_file_size.py`: no new hit anywhere,
and a baseline (`ci/brand_names_baseline.json`) holding the hits each file had
when the check arrived.

- A hit is a word of a token (a camelCase, snake_case, kebab-case or dotted
  name) that is one of the brands: `aiq`, `archos`, `piloti`, `grid` (``brand_words``).
- A file's count is its hits in its own name plus, for a code or config file
  (``CONTENT_SUFFIXES``), its hits in the text. A directory is keyed `dir/`
  and counts the hits in its own name, so a new file in an old directory is
  not a new hit, and a new directory is.
- A key over its baseline fails; so does one under it (``--update`` lowers and
  removes entries, it never raises or adds one).

What is not a hit
-----------------

- The name as a word in prose: the bare token `Piloti`, `Grid` or `ARCHOS` (a
  comment, a docstring, a string a person reads, a generated fixture that renders
  `PRODUCT_NAME` into copy). That copy is the brand's business, and the place to
  centralise it is the `PRODUCT_NAME` constant; `scripts/check_brand_prose.py`
  counts it in text, this check does not.
- `grid` the English word: a bare lowercase `grid`, CSS and Tailwind
  (`grid-cols-2`, `gridTemplateColumns`), and `grid` as the last word, the
  layout noun (`FileGrid`, `document_grid`, `stat-grid`).
- The repository's own name and URLs (``REPOSITORY``), which only the
  repository's owners rename: `archos-at/archos` and the `archos-at` org
  (`ghcr.io/archos-at/...`, `github.com/archos-at/...`). The image or repo
  name after the org is not exempt, so an existing `grid-oib-*` hit stays.
- The Kubernetes and Compose tier names `aiq-agent` and `aiq-api`
  (``PENDING_INFRA_NAMES``), until the deploy rename (ADR-0145 row 10c) moves
  them in its three operator-applied deploys.
- The external names the owner kept (``EXTERNAL_NAMES``, ADR-0182 decision 4):
  the Pulumi project and stack `grid-oib`, the buckets `grid-documents` and
  `grid-org-<id>`, the Qdrant aliases `piloti_corpus` and `piloti_office`.
- A legacy module's text, whose header says ``drop after release N`` (``LEGACY_HEADER``).
- History and copy (``EXCLUDED``): ADRs, audits, release notes, migrations,
  the i18n dictionaries and the site's content, published assets, lockfiles,
  and Markdown, whose paths and names follow the code they describe.

Usage:
    python scripts/check_brand_names.py              # check, exit 1 on a finding
    python scripts/check_brand_names.py --update     # ratchet the baseline down
    python scripts/check_brand_names.py --rebaseline # rewrite it from the tree

``--rebaseline`` is for a move or rename that re-keys entries: it records the
tree as it is, new hits included, so its diff is the thing to review.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path
from pathlib import PurePosixPath

BASELINE = Path("ci/brand_names_baseline.json")
BRANDS = ("aiq", "archos", "piloti", "grid")
PROSE = {"Piloti", "Grid", "ARCHOS", "Archos"}
CONTENT_SUFFIXES = (
    ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".astro", ".css", ".html", ".hog",
    ".yaml", ".yml", ".json", ".toml", ".sh", ".sql", ".example",
)  # fmt: skip
CONTENT_NAMES = ("Dockerfile", "pre-commit")

EXCLUDED = re.compile(
    "|".join(
        (
            r"^docs/(adr|audits)/",  # decisions and audits: history, written once
            r"^releasenotes/",  # what shipped, under the name it shipped with
            r"(^|/)migrations/|^apps/workspace/migrations/",  # Alembic and Drizzle history, written once
            r"(^|/)i18n/dictionaries/",  # copy, where the name belongs
            r"^apps/website/src/data/changelog\.json$",  # generated from releasenotes/, excluded above
            r"^apps/workspace/bff/release-notes/release-notes\.generated\.json$",  # the same, the app's copy
            r"^packages/brand/signatures/",  # email signatures, generated from identity.json
            r"(^|/)public/",  # published assets: their URLs are public
            r"(^|/)(uv\.lock|bun\.lockb?|package-lock\.json|apm\.lock\.yaml)$",  # rendered from manifests
            r"\.mdx?$",  # prose, which follows the code it names
            r"^ci/[^/]*baseline[^/]*\.json$",  # ratchet baselines: they list paths, not names
            r"^\.github/filters\.yml$",  # CI path filters: they list paths, not names
            r"^scripts/check_brand_(names|prose)\.py$|^tests/test_check_brand_(names|prose)\.py$",  # these checks
            r"^tests/test_(repo_layout|test_imports)\.py$",
            r"^apps/agent-host/entrypoint\.py$|^tests/test_(entrypoint_roles|no_legacy_env_names)\.py$|^apps/workspace/scripts/legacy-env-names\.",
            r"^deploy/pulumi/src/names\.ts$",
            r"^apps/workspace/bff/http/legacy-header-names\.|^apps/agent-host/src/agent_host/legacy_headers\.py$",
            r"^apps/workspace/ui/features/documents/hooks/legacy-drag-types\.ts$",
            r"^apps/workspace/bff/agent-api/legacy-names\.|^packages/agent/src/agent/tools/workspace/legacy_names\.py$",
            r"^packages/brand/identity\.json$|^apps/[^/]+/(.*/)?identity\.json$|^packages/agent/src/agent/common/identity\.json$",
            r"^tests/test_legacy_headers\.py$",
            r"^deploy/postgres/rename-legacy-names\.sh$|^deploy/pulumi/src/data/postgres-rename\.ts$",
            r"^deploy/pulumi/index-postgres-rename\.spec\.ts$|^tests/test_postgres_rename_legacy_names\.py$",
            r"^apps/workspace/app/storage-rename-boot(\.spec)?\.ts$",
            r"^scripts/rls-test-db\.sh$",
            r"^apps/workspace/bff/turns/headless-mode\.ts$",
            r"^apps/website/redirects\.mjs$",
        )
    )
)

URL = re.compile(r"\b(?:https?|git|ssh)://\S+|\bgit@[\w.-]+:\S+")
LEGACY_HEADER = re.compile(r"(?i)drop after release\s+\S+")
HOST = re.compile(r"\.(?:at|ai|app|com|de|dev|eu|io|net|org|tech)$")
PENDING_INFRA_NAMES = re.compile(r"(?<![A-Za-z0-9])(?:aiq-agent|aiq-api)(?![A-Za-z0-9])")
REPOSITORY = re.compile(
    r"\bgrid-check/grid-oib-agent\b|\bgrid-oib-agent\b|\bgrid-check\b|(?<![\w.-])archos-at(?:/archos(?![\w-]))?(?![\w-])",
    re.IGNORECASE,
)
EXTERNAL_NAMES = re.compile(
    r"(?<![\w-])grid-oib(?![\w-])|(?<![\w-])grid-documents(?![\w-])|(?<![\w-])grid-org(?![\w])(?:-[\w-]*)?"
    r"|(?<![\w-])piloti_(?:corpus|office)(?!\w)"
)
BRAND = re.compile("|".join(BRANDS), re.IGNORECASE)
TOKEN_CHARS = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-")
WORD = re.compile(r"[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+")
CSS_GRID = re.compile(r"^(inline-)?grid(-(cols|rows|flow|area|template|column|row|auto|gap|start|end|span)\b.*)?$")
CSS_GRID_PROPERTY = re.compile(r"^grid(Template|Column|Row|Area|Auto|Gap)")


def _words(token: str) -> list[str]:
    return [word for part in re.split(r"[_.-]+", token) for word in WORD.findall(part)]


def _is_brand(word: str) -> bool:
    lowered = word.lower()
    if lowered in BRANDS:
        return True
    return word.isupper() and any(lowered.startswith(brand) for brand in BRANDS)


def brand_words(token: str) -> list[str]:
    """The brand words of ``token`` (`piloti_wakes` → ['piloti'], `FileGrid` → [], `Piloti` → [])."""
    if token in PROSE or token == "grid" or HOST.search(token):
        return []
    if CSS_GRID.match(token) or CSS_GRID_PROPERTY.match(token):
        return []
    words = _words(token)
    hits = [index for index, word in enumerate(words) if _is_brand(word)]
    return [words[index] for index in hits if not (words[index].lower() == "grid" and index == len(words) - 1 > 0)]


def branded_tokens(text: str) -> list[str]:
    """The tokens of ``text`` that contain a brand, grown out from each match (a regex for whole tokens is slow)."""
    tokens: list[str] = []
    end = 0
    for match in BRAND.finditer(text):
        if match.start() < end:
            continue
        start, end = match.start(), match.end()
        while start > 0 and text[start - 1] in TOKEN_CHARS:
            start -= 1
        while end < len(text) and text[end] in TOKEN_CHARS:
            end += 1
        tokens.append(text[start:end].strip(".-"))
    return tokens


def _without_exempt_names(text: str) -> str:
    """``text`` with URLs, the repository's own name and the pending infra names blanked.

    Each substitution runs only where a plain substring says it can match: the
    three regexes over every file were half of this check (2.7s of 5.3,
    2026-11-10), REPOSITORY alone 1.8s, and most files hold none of them.
    """
    if "://" in text or "git@" in text:
        text = URL.sub(" ", text)
    lowered = text.lower()
    if "grid-" in lowered or "archos-at" in lowered:
        text = REPOSITORY.sub(" ", text)
    if "grid-" in text or "piloti_" in text:
        text = EXTERNAL_NAMES.sub(" ", text)
    if "aiq-a" in text:
        text = PENDING_INFRA_NAMES.sub(" ", text)
    return text


def count_text(text: str) -> int:
    """The brand hits in ``text``, URLs and the repository's own name left out."""
    if not BRAND.search(text):
        return 0
    return sum(len(brand_words(token)) for token in branded_tokens(_without_exempt_names(text)))


def is_content(path: str) -> bool:
    name = PurePosixPath(path).name
    return path.endswith(CONTENT_SUFFIXES) or name.startswith(CONTENT_NAMES) or name.startswith(".env")


def tracked_files(root: Path) -> list[str]:
    """Every file git tracks (staged included) that this check governs."""
    out = subprocess.run(["git", "ls-files"], cwd=root, capture_output=True, text=True, check=True).stdout
    return [path for path in out.splitlines() if not EXCLUDED.search(path) and (root / path).is_file()]


def measure(root: Path, paths: list[str]) -> dict[str, int]:
    """The hits per file and per directory (keyed `dir/`), zeros left out."""
    counts: Counter[str] = Counter()
    directories: set[str] = set()
    for path in paths:
        pure = PurePosixPath(path)
        directories.update(str(parent) for parent in pure.parents if str(parent) != ".")
        counts[path] += count_text(pure.name)
        if is_content(path):
            text = (root / path).read_text(encoding="utf-8", errors="replace")
            if not LEGACY_HEADER.search("\n".join(text.split("\n", 15)[:15])):
                counts[path] += count_text(text)
    for directory in directories:
        counts[f"{directory}/"] += count_text(PurePosixPath(directory).name)
    return {key: count for key, count in counts.items() if count}


def load_baseline(path: Path) -> dict[str, int]:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def write_baseline(path: Path, counts: dict[str, int]) -> None:
    path.write_text(json.dumps(dict(sorted(counts.items())), indent=2) + "\n", encoding="utf-8")


def check(current: dict[str, int], baseline: dict[str, int]) -> list[str]:
    """New or grown keys, and keys the baseline should lower."""
    findings = []
    for key, count in sorted(current.items()):
        allowed = baseline.get(key, 0)
        if count > allowed:
            findings.append(f"{key}: {count} brand hit(s), baseline {allowed}. Name it for what it does.")
    for key, allowed in sorted(baseline.items()):
        count = current.get(key, 0)
        if count < allowed:
            findings.append(f"{key}: down from {allowed} to {count}, so lower its baseline entry (run --update).")
    return findings


def tightened(current: dict[str, int], baseline: dict[str, int]) -> dict[str, int]:
    """The baseline lowered to the tree wherever the tree has fewer; nothing new, nothing raised."""
    return {key: min(allowed, current[key]) for key, allowed in baseline.items() if key in current}


def main(argv: list[str] | None = None) -> int:
    """CLI entry point: check (or ratchet) the brand-name baseline and return an exit code."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--update", action="store_true", help="Lower and remove baseline entries; never raise one.")
    mode.add_argument("--rebaseline", action="store_true", help="Record the tree as it is, new hits included.")
    args = parser.parse_args(argv)

    root = Path.cwd()
    current = measure(root, tracked_files(root))
    baseline = load_baseline(root / BASELINE)
    if args.rebaseline:
        write_baseline(root / BASELINE, current)
        print(f"Brand-name baseline rewritten: {sum(current.values())} hit(s) in {len(current)} path(s).")
        return 0
    if args.update:
        baseline = tightened(current, baseline)
        write_baseline(root / BASELINE, baseline)

    findings = check(current, baseline)
    slack = [f for f in findings if "so lower its" in f or "remove its baseline entry" in f]
    findings = [f for f in findings if f not in slack]
    if findings:
        print(f"Brand-name check FAILED ({len(findings)} finding(s)):", file=sys.stderr)
        for finding in findings:
            print(f"  - {finding}", file=sys.stderr)
        print("Why and what to name it instead: docs/contributing/code-conventions.md#no-brand-names", file=sys.stderr)
        return 1

    print(f"Brand-name check passed: {sum(baseline.values())} hit(s) in {len(baseline)} path(s) held at baseline.")
    if slack:
        print(
            f"  {len(slack)} baseline entr{'y' if len(slack) == 1 else 'ies'} can be lowered: `task baselines:tighten`."
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
