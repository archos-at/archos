from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

PYTHON_ROOTS = (
    "src",
    "packages/knowledge-layer",
    "packages/ris-adapter",
    "packages/tavily-web-search",
    "apps/agent-host/src",
    "scripts",
)
TS_ROOTS = tuple(
    f"apps/workspace/{root}"
    for root in (
        "app",
        "bff",
        "ui",
        "i18n",
        "shared",
        "types",
        "utils",
        "tests/test-utils",
        "workers",
        "purger",
    )
)
TS_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".cjs"}

PYTHON_CLIENT = "packages/agent/src/agent/observability/posthog_client.py"
BROWSER_CLIENT = "apps/workspace/bff/analytics/posthog.ts"
SERVER_CLIENT = "apps/workspace/bff/analytics/posthog-server.ts"
REQUEST_ERRORS = "apps/workspace/bff/analytics/request-error.ts"

_PY_IMPORT = re.compile(r"^\s*(?:from\s+posthog(?:\.\w+)*\s+import|import\s+posthog\b)", re.MULTILINE)
_TS_IMPORT = re.compile(
    r"""(?:from\s+|require\(\s*|import\(\s*)['"](posthog-js|posthog-node|@posthog/[\w-]+)(?:/[^'"]*)?['"]"""
)

AI_EVENTS = ("$ai_generation", "$ai_trace", "$ai_span", "$ai_embedding", "$ai_metric", "$ai_feedback")
_AI_EVENT = re.compile(r"""['"](\$ai_(?:generation|trace|span|embedding|metric|feedback))['"]""")


def _is_test(path: Path) -> bool:
    name = path.name
    return (
        ".spec." in name
        or ".test." in name
        or name.startswith("test_")
        or "__tests__" in path.parts
        or "tests" in path.parts
    )


def _files(roots: tuple[str, ...], suffixes: set[str]) -> list[Path]:
    found: list[Path] = []
    for root in roots:
        base = REPO_ROOT / root
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if path.suffix in suffixes and "node_modules" not in path.parts and not _is_test(path):
                found.append(path)
    return found


def _rel(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def test_only_the_python_client_imports_the_posthog_sdk() -> None:
    offenders = [
        _rel(path)
        for path in _files(PYTHON_ROOTS, {".py"})
        if _rel(path) != PYTHON_CLIENT and _PY_IMPORT.search(path.read_text(encoding="utf-8", errors="ignore"))
    ]
    assert offenders == [], f"import PostHog through {PYTHON_CLIENT}, not directly: {offenders}"


def test_only_the_two_ts_clients_import_posthog_packages() -> None:
    allowed = {
        "posthog-js": BROWSER_CLIENT,
        "posthog-node": SERVER_CLIENT,
        "@posthog/next": REQUEST_ERRORS,
        "@posthog/core": REQUEST_ERRORS,
    }
    offenders: list[str] = []
    for path in _files(TS_ROOTS, TS_SUFFIXES):
        rel = _rel(path)
        for package in _TS_IMPORT.findall(path.read_text(encoding="utf-8", errors="ignore")):
            if allowed.get(package) != rel:
                offenders.append(f"{rel} imports {package}")
    assert offenders == [], f"reach PostHog through {BROWSER_CLIENT} or {SERVER_CLIENT}: {offenders}"


def test_no_code_emits_posthog_ai_observability_events() -> None:
    offenders: list[str] = []
    for path in _files(PYTHON_ROOTS, {".py"}) + _files(TS_ROOTS, TS_SUFFIXES):
        for event in _AI_EVENT.findall(path.read_text(encoding="utf-8", errors="ignore")):
            offenders.append(f"{_rel(path)}: {event}")
    assert offenders == [], f"LLM data reaches PostHog through Langfuse's integration (ADR-0100): {offenders}"


CATALOGUE = "docs/observability/posthog-events.md"
PYTHON_EVENT_ROOTS = ("packages/agent/src", "apps/agent-host/src")
_PY_UNION = re.compile(r"^ServerEvent = Literal\[([^\]]*)\]", re.MULTILINE)
_PY_CAPTURE = re.compile(r"""posthog_client\.capture\(\s*['"]([^'"]+)['"]""")


def _python_events() -> set[str]:
    union = _PY_UNION.search((REPO_ROOT / PYTHON_CLIENT).read_text(encoding="utf-8"))
    assert union, f"{PYTHON_CLIENT} has no `ServerEvent = Literal[...]`"
    return set(re.findall(r"""['"]([^'"]+)['"]""", union.group(1)))


def test_every_python_capture_names_an_event_of_the_closed_union() -> None:
    events = _python_events()
    strays = [
        f"{_rel(path)}: {event}"
        for path in _files(PYTHON_EVENT_ROOTS, {".py"})
        for event in _PY_CAPTURE.findall(path.read_text(encoding="utf-8", errors="ignore"))
        if event not in events
    ]
    assert strays == [], f"add the event to ServerEvent in {PYTHON_CLIENT} and a row to {CATALOGUE}: {strays}"


def test_every_python_event_has_a_row_in_the_catalogue() -> None:
    catalogue = (REPO_ROOT / CATALOGUE).read_text(encoding="utf-8")
    missing = sorted(event for event in _python_events() if f"| `{event}` |" not in catalogue)
    assert missing == [], f"{CATALOGUE} has no row for {missing}"


def test_the_scanners_see_what_they_guard(tmp_path: Path) -> None:
    assert _PY_CAPTURE.findall('posthog_client.capture(\n    "answer_finished", distinct_id=x)') == ["answer_finished"]
    assert _PY_UNION.search('ServerEvent = Literal["a", "b"]\n')
    assert _PY_IMPORT.search("from posthog import Posthog")
    assert _PY_IMPORT.search("import posthog")
    assert not _PY_IMPORT.search("from agent.observability import posthog_client")
    assert _TS_IMPORT.findall("import { PostHog } from 'posthog-node'") == ["posthog-node"]
    assert _TS_IMPORT.findall('import posthog from "posthog-js/react"') == ["posthog-js"]
    assert _TS_IMPORT.findall("import { useThumbSurvey } from '@posthog/react'") == ["@posthog/react"]
    assert _AI_EVENT.findall("capture('$ai_generation', {})") == ["$ai_generation"]
    assert not _AI_EVENT.findall("properties['$ai_trace_id'] = trace_id")
    assert set(AI_EVENTS) >= {"$ai_generation", "$ai_metric"}
