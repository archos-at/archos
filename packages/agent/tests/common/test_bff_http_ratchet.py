from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[4]
SEAM = Path("packages/agent/src/agent/common/bff_http.py")

TREES = ("packages/agent/src/agent", "packages/knowledge-layer/src", "apps/agent-host/src")

PATTERNS = {
    "redirect_guard": re.compile(r"class \w+\([^)]*HTTPRedirectHandler"),
    "base_url": re.compile(r"FRONTEND_INTERNAL_URL"),
    "token_header": re.compile(r"x-(?:grid-)?internal-token", re.IGNORECASE),
}
TOKEN_HEADER_TREES = ("packages/agent/src/agent",)

ALLOWED: dict[str, dict[str, int]] = {
    "base_url": {
        "packages/agent/src/agent/skills/resolver.py": 1,
        "packages/agent/src/agent/common/model_overrides.py": 1,
        "packages/agent/src/agent/common/llm_credentials.py": 1,
        "packages/agent/src/agent/common/platform_lessons.py": 1,
        "packages/agent/src/agent/common/retrieval_settings.py": 1,
        "packages/agent/src/agent/common/reasoning_settings.py": 1,
        "packages/agent/src/agent/corpus_store.py": 4,
        "packages/agent/src/agent/knowledge/permit_records_client.py": 3,
        "packages/knowledge-layer/src/ingest/image_store.py": 3,
        "packages/knowledge-layer/src/ingest/document_presence.py": 3,
        "packages/knowledge-layer/src/ingest/page_text_store.py": 3,
        "packages/knowledge-layer/src/view_image.py": 3,
        "apps/agent-host/src/agent_host/internal_api.py": 2,
    },
    "token_header": {
        "packages/agent/src/agent/skills/resolver.py": 1,
        "packages/agent/src/agent/common/model_overrides.py": 1,
        "packages/agent/src/agent/common/llm_credentials.py": 1,
        "packages/agent/src/agent/common/platform_lessons.py": 1,
        "packages/agent/src/agent/common/retrieval_settings.py": 1,
        "packages/agent/src/agent/common/reasoning_settings.py": 1,
        "packages/agent/src/agent/corpus_store.py": 1,
        "packages/agent/src/agent/knowledge/permit_records_client.py": 1,
    },
    "redirect_guard": {},
}


def _counts(pattern_name: str) -> dict[str, int]:
    trees = TOKEN_HEADER_TREES if pattern_name == "token_header" else TREES
    pattern = PATTERNS[pattern_name]
    found: dict[str, int] = {}
    for tree in trees:
        for path in sorted((ROOT / tree).rglob("*.py")):
            relative = path.relative_to(ROOT)
            if relative == SEAM:
                continue
            hits = len(pattern.findall(path.read_text(encoding="utf-8")))
            if hits:
                found[relative.as_posix()] = hits
    return found


@pytest.mark.parametrize("pattern_name", sorted(PATTERNS))
def test_no_new_copy_of_the_bff_client(pattern_name: str) -> None:
    found = _counts(pattern_name)
    allowed = ALLOWED[pattern_name]
    grown = {path: hits for path, hits in found.items() if hits > allowed.get(path, 0)}
    assert not grown, (
        f"{pattern_name}: go through agent.common.bff_http instead of a copy of your own "
        f"(internal_base_url, send/get_json/post_json, BffError). New or grown: {grown}"
    )


@pytest.mark.parametrize("pattern_name", sorted(PATTERNS))
def test_the_allowlist_only_falls(pattern_name: str) -> None:
    found = _counts(pattern_name)
    stale = {
        path: (hits, found.get(path, 0)) for path, hits in ALLOWED[pattern_name].items() if found.get(path, 0) < hits
    }
    assert not stale, f"{pattern_name}: lower or delete these entries in ALLOWED (allowed, found): {stale}"


def test_the_seam_itself_is_seen() -> None:
    text = (ROOT / SEAM).read_text(encoding="utf-8")
    assert all(pattern.search(text) for pattern in PATTERNS.values())
