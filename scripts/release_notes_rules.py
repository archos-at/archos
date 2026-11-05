"""Release notes: the house rules a note is held to before anyone reads it.

Every rule here exists because the failure it prevents is invisible until it is
in front of a customer: a German note on the English page, a module name, a
vulnerability spelled out. The rules are the same for every tier a note can
reach (the public weekly summary, the in-app list), because the in-app list is
read by every member of every office and a summary is written from the notes.
Split out of ``release_notes.py``, which is the command line around them.
"""

from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path
from typing import Any

import yaml
from release_notes_areas import lint_area

REPO_ROOT = Path(__file__).resolve().parent.parent
_IDENTITY = json.loads((REPO_ROOT / "packages" / "brand" / "identity.json").read_text(encoding="utf-8"))
SITE_DOMAIN = _IDENTITY["domain"]
PRODUCT_NAME = _IDENTITY["name"]
# The site's address before the rename; links to it stay allowed until the domain cutover.
FORMER_DOMAIN = "piloti.at"

PRELUDE_SECTION = "prelude"

# Sections reno keeps and no reader ever sees, neither on the public changelog
# nor in the app's list. The notes are product news for the architect, not a bug
# register, so three kinds of note are kept in the repository and off both:
#
# * `operators`: only the people running the platform can act on it (model
#   defaults, the Platform area, deployment and migration steps);
# * `security`: a vulnerability, a hardening, a dependency bumped for a CVE. The
#   public page named a remote-code-execution flaw before this was internal;
# * `incident`: a severe fix, something that should never have happened (data
#   lost or kept after deletion, a permission or legal hold that did not hold,
#   an answer passed as checked when it was not, a false claim on the site).
#
# A customer who must hear about a security or incident fix is told directly,
# not by a changelog line. `task release:preview` still lists all three.
INTERNAL_SECTIONS = frozenset({"operators", "security", "incident"})


# ── Authoring rules ─────────────────────────────────────────────────────────
#
# Every note in a customer section is shown verbatim to every member of every
# office (the app's "What's new"), and the week's public summary is written from
# them, so the lint is about readability for a customer, not about YAML
# validity. Each rule below exists because the failure it prevents is invisible
# until it is in front of one.

MIN_LENGTH = 20
MAX_LENGTH = 400
MAX_SENTENCES = 2
# A week's summary covers a dozen notes, so it gets a little more room than one.
SUMMARY_MAX_LENGTH = 500
SUMMARY_MAX_SENTENCES = 3
# An internal note may carry a migration step or the cause of an incident, so it
# gets two more sentences. Nobody outside the repository reads it.
INTERNAL_MAX_SENTENCES = 4

# The source language is English; German is generated from it. A note written
# in German is published as "English" on /en/changelog and translated from German
# into German for /changelog, which is how 344 German sentences reached the
# English page before this check existed. Function words decide it: they occur in
# every sentence, and the two sets do not overlap. Quoted UI labels are removed
# first, because an English note may quote a UI label such as „Freigeben" verbatim.
# (A language-identification library was the alternative; the lint runs outside
# the project environment on every PR, and the question here is only ever
# "English or German", which this answers without a model download.)
GERMAN_FUNCTION_WORDS = frozenset(
    "der die das und ist nicht mit für auf werden wird sind ein eine einen einem einer "
    "im den dem des zu von sie jetzt auch nach bei wenn oder kann können aus als wie "
    "noch nur über statt bisher wieder dass sich es zum zur".split()
)
ENGLISH_FUNCTION_WORDS = frozenset(
    "the and is not with for on are a an of to from you now also after when or can in "
    "it that this by be as has have its your their which what no was were".split()
)
QUOTED = re.compile(r"„[^“\"”]*[“\"”]|\"[^\"]*\"|“[^”]*”|»[^«]*«")

# Phrasing that marks a note as written for the people who run the platform. The
# public changelog is for architects; these belong in the `operators` section.
OPERATOR_PATTERNS = re.compile(
    r"\b(platform operators?|operators? of the platform|whoever operates|platform staff"
    r"|platform support role|Platform\s*(→|->|>)|Platform (settings|area)|Plattform\s*→|Plattform-Betreiber"
    r"|environment variable|Umgebungsvariable|self-host\w*|(new|existing) (installations?|deployments?)"
    r"|search index volume|feature flag)",
    re.IGNORECASE,
)

# Phrasing that marks a note as a security or severe fix. The public changelog is
# product news: a vulnerability or a data-loss bug belongs in `security` or
# `incident`, which are kept and never published. Deliberately short: each word
# here blocks an author, so only phrases that cannot describe an ordinary fix.
SEVERE_PATTERNS = re.compile(
    r"(vulnerab\w*|Sicherheitsl(ü|ue)cke\w*|remote code|\bCVE-\d|\bexploit\w*"
    r"|permissions? (check )?bypass\w*|bypass\w* (the |a )?permissions?|Berechtigung\w* umgangen"
    r"|data loss|Datenverlust\w*)",
    re.IGNORECASE,
)

# Words a reader of the public changelog should not have to meet. The changelog is
# written for an architect who uses the product, so a word goes here when that reader
# cannot act on it. Four kinds are listed: the names of the services underneath
# the product (databases, object storage, the tracing platform, the model gateway); the
# interfaces and formats the services speak (API, webhook, JSON, schema); the
# mechanics of shipping and running software (deploy, staging, pipeline, commit,
# container); and the internals of search and the model (index, embedding, token,
# prompt, cache), together with the switches and measurements an engineer reads
# (feature flag, configuration, latency, trace). The words the product's screens
# themselves show (Papierkorb, Quarantäne, Steckbrief, IFC and the rest) are product
# terms, not jargon, and are deliberately not here. Matching ignores case and a
# trailing s or es; a space in a term matches any space; a hyphen is a hyphen.
# Spellings that differ only by case are listed once; the match ignores case anyway.
PUBLIC_JARGON = (
    "API",
    "API key",
    "SDK",
    "endpoint",
    "endpoints",
    "webhook",
    "JSON",
    "YAML",
    "schema",
    "migration",
    "migrations",
    "backfill",
    "Langfuse",
    "KEDA",
    "Kubernetes",
    "Postgres",
    "PostgreSQL",
    "Redis",
    "Dragonfly",
    "SeaweedFS",
    "S3",
    "Dask",
    "OpenRouter",
    "NeMo",
    "WebSocket",
    "socket",
    "container",
    "pod",
    "replica",
    "cluster",
    "deploy",
    "deployed",
    "deployment",
    "deployments",
    "staging",
    "pipeline",
    "CI",
    "commit",
    "branch",
    "repository",
    "regex",
    "hash",
    "cache",
    "cached",
    "index",
    "indexed",
    "indexing",
    "reindex",
    "re-index",
    "re-indexed",
    "re-indexing",
    "embedding",
    "embeddings",
    "vector",
    "token",
    "tokens",
    "prompt",
    "prompts",
    "worker",
    "workers",
    "queue",
    "queued",
    "config",
    "configuration",
    "environment variable",
    "feature flag",
    "flag",
    "service",
    "microservice",
    "backend",
    "frontend",
    "rate limit",
    "autoscaling",
    "latency",
    "telemetry",
    "tracing",
    "trace",
    "traces",
    "observability",
    "metric",
    "metrics",
    "payload",
    "parser",
    "ingestion",
    "Endpunkt",
    "Endpunkte",
    "Migrationen",
    "gecacht",
    "indexiert",
    "indexieren",
    "Indexierung",
    "Re-Indexierung",
    "Vektor",
    "Warteschlange",
    "Konfiguration",
    "Umgebungsvariable",
    "Feature-Flag",
    "Replik",
    "Latenz",
    "Telemetrie",
    "Metrik",
    "Metriken",
)

# reStructuredText that reno tolerates and the changelog page would render as
# literal punctuation: directives, comments, roles, literal markup, code fences.
RST_PATTERNS = [
    (re.compile(r"^\s*\.\.\s"), "reStructuredText directive or comment (`.. `)"),
    (re.compile(r"::\s*$", re.MULTILINE), "reStructuredText literal block marker (`::`)"),
    (re.compile(r"```"), "code fence"),
    (re.compile(r"`"), "backtick (the changelog renders plain text)"),
    (re.compile(r":(ref|doc|class|func|meth|py:\w+):"), "reStructuredText role"),
]

# Internal references. A reader of the changelog has no issue tracker, no repository
# and no module names — a note that mentions them was written for the reviewer.
INTERNAL_PATTERNS = [
    (re.compile(r"(?<![\w#])#\d+\b"), "issue or PR number"),
    # The lookahead demands a digit, so ordinary words that happen to be spelled
    # out of a-f ("defaced", "acceded") are not mistaken for a sha.
    (re.compile(r"\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b"), "commit sha"),
    (re.compile(r"\b\w+\.(py|ts|tsx|astro|yml|yaml|json|mjs)\b"), "file name"),
    (re.compile(r"\b(src|frontends|sources|configs|deploy)/"), "repository path"),
    (re.compile(rf"https?://(?!(www\.)?({re.escape(SITE_DOMAIN)}|{re.escape(FORMER_DOMAIN)}))"), "link off the website"),
]

# Sentences shipped by the `reno new` template. A note still carrying one was
# created and never written.
TEMPLATE_MARKERS = [
    "say what is new, from the reader's side",
    "say what got better about something they already had",
    "say what used to go wrong",
    "only for a vulnerability or hardening; never published",
    "only for a severe fix that should never have happened; never published",
    "name what is going away",
    "only when the reader has to do something themselves",
    "anything genuinely user-visible",
    "only for the people running the platform; never published",
    "replace this text",
]


def clean(text: str) -> str:
    """Collapse the YAML folding artefacts so the page gets one clean sentence."""
    return " ".join(text.split()).strip()


# ── Lint ────────────────────────────────────────────────────────────────────


def lint_note(filename: str, raw: str, valid_sections: set[str]) -> list[str]:
    """House-rule violations in one note file, each with the fix spelled out."""
    try:
        content = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        return [f"{filename}: not valid YAML ({exc}). Fix: compare it with the template `task release:note` writes."]
    if not isinstance(content, dict):
        return [f"{filename}: the file must be a YAML mapping of section -> list of entries."]
    if not content:
        return [f"{filename}: the file is empty. Fix: write the note, or delete the file."]

    problems: list[str] = lint_area(filename, raw)
    for section, body in content.items():
        entries, problem = _section_entries(section, body, valid_sections)
        if problem:
            problems.append(f"{filename}: {problem}")
            continue
        for entry in entries:
            if not isinstance(entry, str):
                problems.append(f"{filename}: section `{section}` has an entry that is not text.")
                continue
            public = section not in INTERNAL_SECTIONS
            limit = MAX_SENTENCES if public else INTERNAL_MAX_SENTENCES
            issues = lint_text(entry, public=public, max_sentences=limit)
            problems.extend(f"{filename} ({section}): {issue}" for issue in issues)
    return problems


def _section_entries(section: str, body: Any, valid_sections: set[str]) -> tuple[list[Any], str | None]:
    """A section's entries, or the structural problem that stops them being read."""
    if section == PRELUDE_SECTION:
        if isinstance(body, str):
            return [body], None
        return [], f"`{PRELUDE_SECTION}` must be one block of text, not a list."
    if section not in valid_sections:
        allowed = ", ".join(sorted(valid_sections))
        return [], f"unknown section `{section}`. Fix: use one of {allowed}."
    if not isinstance(body, list):
        return [], f"section `{section}` must be a list of entries (`- >` before each one)."
    if not body:
        return [], f"section `{section}` is empty. Fix: delete the section."
    return body, None


def _jargon_pattern(term: str) -> re.Pattern[str]:
    """One term as a whole-word, case-insensitive pattern.

    `(?<!\\w)` and `(?!\\w)` make a term a whole word, so `S3` does not match `S30`
    and `API` does not match `Kapitel`. A hyphen is a literal character, so
    `re-index` does not match `re index`. A space matches any run of whitespace. A
    trailing `s` or `es` is allowed, so `APIs` and `indexes` count; a longer word
    that merely starts with the term (`Tokenizer`) does not.
    """
    body = r"\s+".join(re.escape(part) for part in term.split(" "))
    return re.compile(rf"(?<!\w){body}(?:e?s)?(?!\w)", re.IGNORECASE)


# Longest first, so `feature-flag` claims its text before the bare `flag` can.
_JARGON_PATTERNS = tuple(_jargon_pattern(term) for term in sorted(PUBLIC_JARGON, key=len, reverse=True))


def jargon_hits(text: str) -> list[str]:
    """The public-jargon words in `text`, as written, in reading order, each once."""
    claimed: list[tuple[int, int]] = []
    hits: list[tuple[int, str]] = []
    for pattern in _JARGON_PATTERNS:
        for match in pattern.finditer(text):
            if any(match.start() < end and start < match.end() for start, end in claimed):
                continue
            claimed.append(match.span())
            hits.append((match.start(), match.group(0)))
    seen: set[str] = set()
    words: list[str] = []
    for _, word in sorted(hits):
        if word.lower() not in seen:
            seen.add(word.lower())
            words.append(word)
    return words


def _jargon_issue(word: str) -> str:
    return (
        f'uses "{word}", a technical word a reader of the changelog cannot act on. Fix: say what '
        "the reader sees or can do, in the words the product's screens use (Papierkorb, Archiv, "
        "Steckbrief); leave out the name of the system and the mechanism behind it."
    )


def lint_text(
    entry: str,
    *,
    public: bool = True,
    max_length: int = MAX_LENGTH,
    max_sentences: int = MAX_SENTENCES,
) -> list[str]:
    """The published-prose rules, applied to one entry. Every message names the fix."""
    text = clean(entry)
    if not text:
        return ["the entry is blank. Fix: write it, or delete the entry."]
    lowered = text.lower()
    if any(marker in lowered for marker in TEMPLATE_MARKERS):
        return ["the entry still holds the `reno new` template text. Fix: replace it with your note."]

    issues: list[str] = []
    if looks_german(text):
        issues.append(
            "reads as German. Fix: write the note in English; the German page is translated from it. "
            "German you already wrote is not lost: once the English is final, put the pair into "
            "releasenotes/translations/de.json as the `de` side of your English sentence."
        )
    if public and OPERATOR_PATTERNS.search(text):
        issues.append(
            "reads as a note for the people who run the platform. Fix: move it to the `operators` "
            "section, which stays off the public changelog; or rewrite it for the architect using the product."
        )
    if public and SEVERE_PATTERNS.search(text):
        issues.append(
            "reads as a security or severe fix. Fix: move it to `security` (a vulnerability or hardening) "
            "or `incident` (data lost, a permission that did not hold); both are kept and never published."
        )
    if public:
        issues.extend(_jargon_issue(word) for word in jargon_hits(text))
    if len(text) < MIN_LENGTH:
        issues.append(f"too short ({len(text)} chars) to mean anything to a reader. Fix: say what changed for them.")
    if len(text) > max_length:
        issues.append(
            f"too long ({len(text)} chars, limit {max_length}). Fix: keep what changed for the reader; "
            "the mechanism belongs in the PR description."
        )
    count = sentence_count(text)
    if count > max_sentences:
        issues.append(
            f"{count} sentences, limit {max_sentences}. Fix: one sentence for what changed, one for why "
            "it matters; split an unrelated change into its own entry."
        )
    if text[-1] not in ".!?":
        issues.append("does not end with punctuation. Fix: write it as a full sentence.")
    for pattern, label in RST_PATTERNS:
        if pattern.search(entry):
            issues.append(f"contains a {label}. Fix: remove the markup; the changelog renders plain text.")
    for pattern, label in INTERNAL_PATTERNS:
        if pattern.search(text):
            issues.append(f"mentions a {label}. Fix: describe the effect on the reader, not the change to the code.")
    return issues


def _unquoted(text: str) -> str:
    """The text with quoted labels removed: „Freigeben" is a UI string, not prose."""
    return QUOTED.sub("X", text)


def looks_german(text: str) -> bool:
    """True when the prose outside quotation marks is German rather than English."""
    words = re.findall(r"[a-zäöüß]+", _unquoted(text).lower())
    german = sum(word in GERMAN_FUNCTION_WORDS for word in words)
    english = sum(word in ENGLISH_FUNCTION_WORDS for word in words)
    return german >= 2 and german > english


# A sentence ends at . ! ? or … followed by a space and a capital letter or an
# opening quote. A digit does not start a sentence, so "Pkt. 3.5.2" and "S. 7"
# stay one; neither does a lower-case word, so "e.g. a plan" stays one.
_SENTENCE_END = re.compile(r"[.!?…](?=\s+[„“\"'(]?[A-ZÄÖÜ])")


def sentence_count(text: str) -> int:
    """How many sentences a reader sees in the entry, quoted labels not counted."""
    return len(_SENTENCE_END.findall(_unquoted(text))) + 1


SUMMARY_KEY = re.compile(r"^(\d{4}-W\d{2}|\d+\.\d+\.\d+)$")


def lint_summaries(raw: str, today: date | None = None) -> list[str]:
    """The rules for releasenotes/summaries.yaml: known group ids, weeks that have begun, short English prose.

    A summary is the public changelog's only content for its week, so it is held
    to the note rules with a little more room, and it cannot be written ahead: a
    week that has not started has shipped nothing to summarise.
    """
    today = today or date.today()
    try:
        content = yaml.safe_load(raw) or {}
    except yaml.YAMLError as exc:
        return [f"summaries.yaml: not valid YAML ({exc})."]
    if not isinstance(content, dict):
        return ["summaries.yaml: must be a mapping of week (2026-W39) or version (1.2.0) -> summary."]
    problems: list[str] = []
    for key, body in content.items():
        if not SUMMARY_KEY.match(str(key)):
            problems.append(f"summaries.yaml: `{key}` is not a week like 2026-W39 or a version like 1.2.0.")
            continue
        if not isinstance(body, str):
            problems.append(f"summaries.yaml ({key}): the summary must be one block of text.")
            continue
        monday = week_monday(str(key))
        if "-W" in str(key) and monday is None:
            problems.append(f"summaries.yaml: `{key}` is no ISO week (weeks run from W01 to W52 or W53).")
            continue
        if monday and monday > today:
            problems.append(f"summaries.yaml ({key}): the week has not started. Fix: write it once the week shipped.")
        issues = lint_text(body, max_length=SUMMARY_MAX_LENGTH, max_sentences=SUMMARY_MAX_SENTENCES)
        problems.extend(f"summaries.yaml ({key}): {issue}" for issue in issues)
    return problems


def week_monday(group_id: str) -> date | None:
    """The Monday of an ISO week id (`2026-W39`), or None for a version or anything else."""
    match = re.fullmatch(r"(\d{4})-W(\d{2})", group_id)
    if not match:
        return None
    try:
        return date.fromisocalendar(int(match.group(1)), int(match.group(2)), 1)
    except ValueError:
        return None
