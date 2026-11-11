#!/usr/bin/env python3

"""Keep a country's specifics out of every new line of source code.

Why this exists
---------------

A country is data: its legal database, its standards body, its hosts, its
territories and its building laws are records an operator proposes through the
platform door (ADR-0162, ADR-0168, ADR-0169, ADR-0173, ADR-0174,
`docs/architecture/country-extensibility.md`). Austria came first and was written
as code: modules and routes named for the OIB, a package and a model tool named
for RIS, the nine Länder as literals. Each of those is a place a second country
needs a code change, and a plan that would have added more passed until the
owner read it. Review does not hold this line; a count does.

What it checks
--------------

A ratchet, in the style of `scripts/check_brand_names.py`: no new hit anywhere,
and a baseline (`ci/country_in_code_baseline.json`) holding the hits each file
had when the check arrived.

- The tokens are data (`ci/country_tokens.json`): per country and per kind, the
  hosts, the patterns and the words that name it. Its `$comment` says how to add
  a country.
- A hit is one occurrence of a token in the code of a source file (Python,
  TypeScript, JavaScript) or in the text of a prompt (``PROMPT``: a `.j2`
  template, a Markdown file under `prompts/`, a built-in `SKILL.md`, the agent
  door's guides) under ``ROOTS``, or in the file's own name. A prompt is what
  the model reads on every turn, and ADR-0168 requires the static prompt to be
  country-neutral, so a country named there is the country in the product. A
  directory is keyed `dir/` and counts the hits in its own name, so a new file
  in `ris_adapter/` is not a new hit for its path, and a new directory named
  for a country's source is.
- Comments and docstrings are not code and are not counted: a sentence that
  says why the Austrian path went away is history, not a second copy of Austria.
  String literals are counted, whoever reads them: a prompt that says
  "österreichisches Architekturbüro" is the country in code.
- A key over its baseline fails; so does one under it (``--update`` lowers and
  removes entries, it never raises or adds one).

What is not checked
-------------------

What is data by nature (``EXCLUDED``): tests and fixtures, the i18n
dictionaries, the legal texts, the public site and its CMS, the component
gallery, migrations, generated files. And everything outside ``ROOTS``:
`configs/` (the packs and source records, where a country belongs), `docs/`,
`scripts/`, `evals/`, `deploy/`. Documentation in Markdown (a README, an
`AGENTS.md`) is prose about the code and is not counted.

Usage:
    python scripts/check_country_in_code.py              # check, exit 1 on a finding
    python scripts/check_country_in_code.py --update     # ratchet the baseline down
    python scripts/check_country_in_code.py --rebaseline # rewrite it from the tree
    python scripts/check_country_in_code.py --explain [PATH ...]  # every hit, with its kind
    python scripts/check_country_in_code.py --summary    # hits by area and by kind

``--rebaseline`` is for a move or rename that re-keys entries, and for a new
country's tokens: it records the tree as it is, new hits included, so its diff
is the thing to review.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import subprocess
import sys
import tokenize
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from pathlib import PurePosixPath

BASELINE = Path("ci/country_in_code_baseline.json")
TOKENS = Path("ci/country_tokens.json")
ROOTS = ("apps/", "packages/")
SUFFIXES = (".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")
#: What a model reads as its instructions, counted whole. Not documentation: a README or an AGENTS.md
#: beside the code is prose about it.
PROMPT = re.compile(
    "|".join(
        (
            r"\.j2$",  # a prompt template
            r"(^|/)prompts/[^/]+\.md$",  # the static prompt (`chat_static.md`) and the door's MCP prompts
            r"(^|/)skills/builtin/.+/SKILL\.md$",  # the platform's built-in skills
            r"^apps/workspace/bff/agent-api/door/.+\.md$",  # the guides the agent door serves as resources
        )
    )
)
#: A template comment or an HTML comment in a prompt: neither is rendered into what the model reads.
PROMPT_COMMENT = re.compile(r"\{#.*?#\}|<!--.*?-->", re.DOTALL)

# Matched against the repo-relative POSIX path. Each line says what it is and
# why a country in it is data, not code.
EXCLUDED = re.compile(
    "|".join(
        (
            r"(^|/)(tests?|testing|__tests__|e2e|_?fixtures|__fixtures__|test-utils)/",  # suites, their support, data
            r"(^|/)(test_[^/]*|[^/]*_test|conftest)\.py$",
            r"\.(spec|test)\.[cm]?[jt]sx?$",
            r"(^|/)[^/]+_testing/",  # a distribution's shared test helpers (naming.md)
            r"(^|/)[^/]*fixtures?\.[cm]?[jt]sx?$",  # sample data kept beside the code it feeds (`photon.fixtures.ts`)
            r"^apps/workspace/app/dev/",  # the component gallery: every page renders sample data
            r"(^|/)i18n/dictionaries/",  # copy: the words a person reads, per locale
            # The public site, its CMS and the brand kit: copy, the company's own address and published URLs.
            # What the site claims per country is the coverage-copy hook's (scripts/check_coverage_copy.py).
            r"^apps/(website|cms)/|^packages/brand/",
            r"^apps/workspace/bff/legal/content/",  # the terms and the privacy notice: legal copy, per locale
            r"(^|/)migrations/",  # Alembic and Drizzle history, written once
            r"\.generated\.|(^|/)generated\.ts$",  # rendered from a source that is checked, or from records
            # Written by sync-platform-skills.mjs from the built-in SKILL.md files, which are counted as prompts.
            r"^apps/workspace/bff/skills/platform-skills\.ts$",
            r"\.d\.ts$",  # type declarations
        )
    )
)

LETTERS = r"[^\W\d_]"
#: One word of an identifier or of text: `OibSync` is `Oib`, `Sync`; `RISClient` is `RIS`, `Client`.
WORD = re.compile(r"[A-ZÄÖÜ]+(?![a-zäöüß])|[A-ZÄÖÜ]?[a-zäöüß]+")
RUN = re.compile(rf"{LETTERS}+")
LETTER = re.compile(LETTERS)


@dataclass(frozen=True)
class Hit:
    country: str
    kind: str
    text: str


class Tokens:
    """The token list, compiled: hosts, then patterns, then words, each on what the one before left."""

    def __init__(self, data: dict) -> None:
        self.hosts: list[tuple[str, re.Pattern[str], str, str]] = []
        self.patterns: list[tuple[re.Pattern[str], str, str]] = []
        self.words: dict[str, tuple[str, str]] = {}
        self.prefixes: list[tuple[str, str, str]] = []
        for country, kinds in data["countries"].items():
            for kind, entry in kinds.items():
                for host in entry.get("hosts", ()):
                    pattern = rf"(?<![\w-])(?:[\w-]+\.)*{re.escape(host)}(?![\w-]|\.\w)"
                    self.hosts.append((host.lower(), re.compile(pattern, re.IGNORECASE), country, kind))
                for pattern in entry.get("patterns", ()):
                    self.patterns.append((re.compile(pattern), country, kind))
                for word in entry.get("words", ()):
                    lowered = word.lower()
                    if lowered.endswith("*"):
                        self.prefixes.append((lowered[:-1], country, kind))
                    else:
                        self.words[lowered] = (country, kind)
        #: Every word and prefix, as the substring a lower-cased text must hold for a word to match at all.
        self.stems = sorted({*self.words, *(prefix for prefix, _, _ in self.prefixes)})

    def may_hit(self, text: str) -> bool:
        """Whether ``text`` can hold a hit at all; a cheap no for the nine files in ten that name no country."""
        lowered = text.lower()
        if any(stem in lowered for stem in self.stems) or any(host in lowered for host, *_ in self.hosts):
            return True
        return any(pattern.search(text) for pattern, _, _ in self.patterns)

    def _word(self, word: str) -> tuple[str, str] | None:
        lowered = word.lower()
        if lowered in self.words:
            return self.words[lowered]
        return next(((country, kind) for prefix, country, kind in self.prefixes if lowered.startswith(prefix)), None)

    def _runs(self, text: str) -> list[str]:
        """The letter runs of ``text`` that hold a stem, in order.

        Grown out from each stem found by substring, as `check_brand_names.py`
        grows its tokens: one regex over every run of a large file was most of
        this check. A text whose lower-casing changes its length (a rare
        letter) is walked run by run instead, since the offsets no longer agree.
        """
        lowered = text.lower()
        if len(lowered) != len(text):
            return [run for run in RUN.findall(text) if any(stem in run.lower() for stem in self.stems)]
        starts: dict[int, int] = {}
        for stem in self.stems:
            at = lowered.find(stem)
            while at != -1:
                start, end = at, at + len(stem)
                while start > 0 and LETTER.match(text[start - 1]):
                    start -= 1
                while end < len(text) and LETTER.match(text[end]):
                    end += 1
                starts[start] = end
                at = lowered.find(stem, end)
        return [text[start:end] for start, end in sorted(starts.items())]

    def hits(self, text: str) -> list[Hit]:
        """Every token in ``text``, one hit per occurrence."""
        found: list[Hit] = []
        lowered = text.lower()
        hosts = [(pattern, country, kind) for host, pattern, country, kind in self.hosts if host in lowered]
        for pattern, country, kind in (*hosts, *self.patterns):
            matches = [match.group(0) for match in pattern.finditer(text)]
            if matches:
                found.extend(Hit(country, kind, match) for match in matches)
                text = pattern.sub(" ", text)
        for run in self._runs(text):
            for word in WORD.findall(run):
                named = self._word(word)
                if named:
                    found.append(Hit(*named, word))
        return found


def load_tokens(path: Path) -> Tokens:
    return Tokens(json.loads(path.read_text(encoding="utf-8")))


def _python_code(source: str) -> str:
    """``source`` without its comments and docstrings (a string that is a whole statement)."""
    kept: list[str] = []
    skip = {tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, tokenize.ENCODING}
    statement_start = True
    pending: str | None = None  # a string that opened a statement: a docstring unless more follows
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type in skip:
            if token.type == tokenize.NEWLINE:
                pending = None  # the statement was that string alone
                statement_start = True
            continue
        if pending is not None:
            kept.append(pending)
            pending = None
        if statement_start and token.type == tokenize.STRING:
            pending = token.string
        else:
            kept.append(token.string)
        statement_start = False
    return "\n".join(kept)


#: A comment or a string of TypeScript or JavaScript, whichever starts first. A string is matched so that a
#: `//` inside it (a URL) is not read as a comment; one left open on its line is not a string and is skipped.
SCRIPT_SPAN = re.compile(
    r"//[^\n]*|/\*.*?\*/|'(?:\\.|[^'\\\n])*'|\"(?:\\.|[^\"\\\n])*\"|`(?:\\.|[^`\\])*`",
    re.DOTALL,
)


def _script_code(source: str) -> str:
    """TypeScript or JavaScript ``source`` without its comments.

    A scan for strings and comments, not a parser: a quote or `//` inside a
    regex literal or JSX text can open a span that is not one. A single- or
    double-quoted string ends on its own line, so the damage is that line.
    """
    return SCRIPT_SPAN.sub(lambda match: " " if match.group(0).startswith(("//", "/*")) else match.group(0), source)


def code_text(path: str, source: str) -> str:
    """The part of ``source`` that is code: everything but comments and docstrings. A prompt is all code."""
    if PROMPT.search(path):
        return PROMPT_COMMENT.sub(" ", source)
    if not path.endswith(".py"):
        return _script_code(source)
    try:
        return _python_code(source)
    except (tokenize.TokenError, SyntaxError):
        return source  # ruff reports it; count the whole text rather than nothing


def is_checked(path: str) -> bool:
    """Whether ``path`` is a source file or a prompt this check governs."""
    if not path.startswith(ROOTS) or EXCLUDED.search(path):
        return False
    return path.endswith(SUFFIXES) or bool(PROMPT.search(path))


def tracked_sources(root: Path) -> list[str]:
    """Every checked file git tracks (staged included), so a new file is seen at commit time."""
    out = subprocess.run(["git", "ls-files", *ROOTS], cwd=root, capture_output=True, text=True, check=True).stdout
    return [path for path in out.splitlines() if is_checked(path) and (root / path).is_file()]


def file_hits(root: Path, path: str, tokens: Tokens) -> list[Hit]:
    """The hits in ``path``'s own name and in its code."""
    source = (root / path).read_text(encoding="utf-8", errors="replace")
    named = tokens.hits(PurePosixPath(path).name)
    # Comments are stripped only where there is something to find: tokenizing every file was most of the run.
    return named + tokens.hits(code_text(path, source)) if tokens.may_hit(source) else named


def measure(root: Path, paths: list[str], tokens: Tokens) -> dict[str, list[Hit]]:
    """The hits per file and per directory (keyed `dir/`), keys without a hit left out."""
    found: dict[str, list[Hit]] = {}
    directories: set[str] = set()
    for path in paths:
        directories.update(str(parent) for parent in PurePosixPath(path).parents if str(parent) != ".")
        found[path] = file_hits(root, path, tokens)
    for directory in directories:
        found[f"{directory}/"] = tokens.hits(PurePosixPath(directory).name)
    return {key: hits for key, hits in found.items() if hits}


def load_baseline(path: Path) -> dict[str, int]:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def write_baseline(path: Path, counts: dict[str, int]) -> None:
    path.write_text(json.dumps(dict(sorted(counts.items())), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def check(current: dict[str, int], baseline: dict[str, int]) -> list[str]:
    """New or grown keys, and keys the baseline should lower."""
    findings = []
    for key, count in sorted(current.items()):
        allowed = baseline.get(key, 0)
        if count > allowed:
            findings.append(f"{key}: {count} country hit(s), baseline {allowed}. A country is records, not code.")
    for key, allowed in sorted(baseline.items()):
        count = current.get(key, 0)
        if count < allowed:
            findings.append(f"{key}: down from {allowed} to {count}, so lower its baseline entry (run --update).")
    return findings


def tightened(current: dict[str, int], baseline: dict[str, int]) -> dict[str, int]:
    """The baseline lowered to the tree wherever the tree has fewer; nothing new, nothing raised."""
    return {key: min(allowed, current[key]) for key, allowed in baseline.items() if key in current}


def area(key: str) -> str:
    """The part of the repository a key belongs to: `apps/workspace/bff`, `packages/ris-adapter`."""
    parts = key.rstrip("/").split("/")
    depth = 3 if parts[:2] in (["apps", "workspace"], ["packages", "agent"]) else 2
    if parts[:4] == ["packages", "agent", "src", "agent"]:
        depth = 5
    return "/".join(parts[: min(depth, len(parts) - (0 if key.endswith("/") else 1))])


def explain(found: dict[str, list[Hit]], only: list[str]) -> None:
    for key in sorted(found):
        if only and not any(key == path or key.startswith(path.rstrip("/") + "/") for path in only):
            continue
        for (kind, text), count in sorted(Counter((hit.kind, hit.text) for hit in found[key]).items()):
            print(f"{key}\t{kind}\t{text}\t{count}")


def summarise(found: dict[str, list[Hit]]) -> None:
    """Hits by area and by kind, as the burn-down table in country-extensibility.md shows them."""
    kinds = sorted({hit.kind for hits in found.values() for hit in hits})
    rows: dict[str, Counter[str]] = {}
    keys: Counter[str] = Counter()
    for key, hits in found.items():
        rows.setdefault(area(key), Counter()).update(hit.kind for hit in hits)
        keys[area(key)] += 1
    print("| Area | Paths | Hits | " + " | ".join(kinds) + " |")
    print("|---|---:|---:|" + "---:|" * len(kinds))
    for name, row in sorted(rows.items(), key=lambda item: -sum(item[1].values())):
        print(
            f"| `{name}` | {keys[name]} | {sum(row.values())} | " + " | ".join(str(row[kind]) for kind in kinds) + " |"
        )
    total = Counter(hit.kind for hits in found.values() for hit in hits)
    print(
        f"| **Total** | {len(found)} | {sum(total.values())} | " + " | ".join(str(total[kind]) for kind in kinds) + " |"
    )


def main(argv: list[str] | None = None) -> int:
    """CLI entry point: check (or ratchet) the country-in-code baseline and return an exit code."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--update", action="store_true", help="Lower and remove baseline entries; never raise one.")
    mode.add_argument("--rebaseline", action="store_true", help="Record the tree as it is, new hits included.")
    mode.add_argument("--explain", nargs="*", metavar="PATH", help="Print every hit (path, kind, text, count).")
    mode.add_argument("--summary", action="store_true", help="Print the hits by area and kind as a table.")
    args = parser.parse_args(argv)
    if sys.version_info < (3, 14):
        # An older tokenizer reads 3.14 syntax as an error, and the file would be counted comments and all.
        print("check_country_in_code.py needs Python 3.14: run it with .venv/bin/python", file=sys.stderr)
        return 2

    root = Path.cwd()
    found = measure(root, tracked_sources(root), load_tokens(root / TOKENS))
    if args.explain is not None:
        explain(found, args.explain)
        return 0
    if args.summary:
        summarise(found)
        return 0
    current = {key: len(hits) for key, hits in found.items()}
    baseline = load_baseline(root / BASELINE)
    if args.rebaseline:
        write_baseline(root / BASELINE, current)
        print(f"Country-in-code baseline rewritten: {sum(current.values())} hit(s) in {len(current)} path(s).")
        return 0
    if args.update:
        baseline = tightened(current, baseline)
        write_baseline(root / BASELINE, baseline)

    findings = check(current, baseline)
    if findings:
        print(f"Country-in-code check FAILED ({len(findings)} finding(s)):", file=sys.stderr)
        for finding in findings:
            print(f"  - {finding}", file=sys.stderr)
        print(
            "What each hit is: .venv/bin/python scripts/check_country_in_code.py --explain <path>\n"
            "Where it belongs instead: docs/architecture/country-extensibility.md#country-in-code-the-burn-down",
            file=sys.stderr,
        )
        return 1

    print(f"Country-in-code check passed: {sum(baseline.values())} hit(s) in {len(baseline)} path(s) held at baseline.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
