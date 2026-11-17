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
FORMER_DOMAIN = "piloti.at"

PRELUDE_SECTION = "prelude"

INTERNAL_SECTIONS = frozenset({"operators", "security", "incident"})


MIN_LENGTH = 20
MAX_LENGTH = 400
MAX_SENTENCES = 2
SUMMARY_MAX_LENGTH = 500
SUMMARY_MAX_SENTENCES = 3
INTERNAL_MAX_SENTENCES = 4

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

OPERATOR_PATTERNS = re.compile(
    r"\b(platform operators?|operators? of the platform|whoever operates|platform staff"
    r"|platform support role|Platform\s*(→|->|>)|Platform (settings|area)|Plattform\s*→|Plattform-Betreiber"
    r"|environment variable|Umgebungsvariable|self-host\w*|(new|existing) (installations?|deployments?)"
    r"|search index volume|feature flag)",
    re.IGNORECASE,
)

SEVERE_PATTERNS = re.compile(
    r"(vulnerab\w*|Sicherheitsl(ü|ue)cke\w*|remote code|\bCVE-\d|\bexploit\w*"
    r"|permissions? (check )?bypass\w*|bypass\w* (the |a )?permissions?|Berechtigung\w* umgangen"
    r"|data loss|Datenverlust\w*)",
    re.IGNORECASE,
)

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

RST_PATTERNS = [
    (re.compile(r"^\s*\.\.\s"), "reStructuredText directive or comment (`.. `)"),
    (re.compile(r"::\s*$", re.MULTILINE), "reStructuredText literal block marker (`::`)"),
    (re.compile(r"```"), "code fence"),
    (re.compile(r"`"), "backtick (the changelog renders plain text)"),
    (re.compile(r":(ref|doc|class|func|meth|py:\w+):"), "reStructuredText role"),
]

INTERNAL_PATTERNS = [
    (re.compile(r"(?<![\w#])#\d+\b"), "issue or PR number"),
    (re.compile(r"\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b"), "commit sha"),
    (re.compile(r"\b\w+\.(py|ts|tsx|astro|yml|yaml|json|mjs)\b"), "file name"),
    (re.compile(r"\b(src|frontends|sources|configs|deploy)/"), "repository path"),
    (
        re.compile(rf"https?://(?!(www\.)?({re.escape(SITE_DOMAIN)}|{re.escape(FORMER_DOMAIN)}))"),
        "link off the website",
    ),
]

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
    return " ".join(text.split()).strip()


def lint_note(filename: str, raw: str, valid_sections: set[str]) -> list[str]:
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
    body = r"\s+".join(re.escape(part) for part in term.split(" "))
    return re.compile(rf"(?<!\w){body}(?:e?s)?(?!\w)", re.IGNORECASE)


_JARGON_PATTERNS = tuple(_jargon_pattern(term) for term in sorted(PUBLIC_JARGON, key=len, reverse=True))


def jargon_hits(text: str) -> list[str]:
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
    return QUOTED.sub("X", text)


def looks_german(text: str) -> bool:
    words = re.findall(r"[a-zäöüß]+", _unquoted(text).lower())
    german = sum(word in GERMAN_FUNCTION_WORDS for word in words)
    english = sum(word in ENGLISH_FUNCTION_WORDS for word in words)
    return german >= 2 and german > english


_SENTENCE_END = re.compile(r"[.!?…](?=\s+[„“\"'(]?[A-ZÄÖÜ])")


def sentence_count(text: str) -> int:
    return len(_SENTENCE_END.findall(_unquoted(text))) + 1


SUMMARY_KEY = re.compile(r"^(\d{4}-W\d{2}|\d+\.\d+\.\d+)$")


def lint_summaries(raw: str, today: date | None = None) -> list[str]:
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
    match = re.fullmatch(r"(\d{4})-W(\d{2})", group_id)
    if not match:
        return None
    try:
        return date.fromisocalendar(int(match.group(1)), int(match.group(2)), 1)
    except ValueError:
        return None
