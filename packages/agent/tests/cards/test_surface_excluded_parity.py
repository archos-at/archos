import re
from pathlib import Path

from agent.cards.surface_card import SURFACE_EXCLUDED_LEAVES

REPO_ROOT = Path(__file__).resolve().parents[4]
TS_CATALOG = REPO_ROOT / "apps" / "workspace" / "ui" / "features" / "a2ui" / "catalog.tsx"


def _ts_excluded_leaves() -> set[str]:
    source = TS_CATALOG.read_text(encoding="utf-8")
    match = re.search(
        r"export const SURFACE_EXCLUDED_LEAVES: ReadonlySet<string> = new Set\(\[(.*?)\]\)",
        source,
        re.DOTALL,
    )
    assert match, f"SURFACE_EXCLUDED_LEAVES not found in {TS_CATALOG}"
    return set(re.findall(r"'([^']+)'", match.group(1)))


def test_a_surface_is_not_a_leaf():
    assert "surface" in SURFACE_EXCLUDED_LEAVES


def test_backend_and_frontend_exclude_the_same_leaves():
    assert _ts_excluded_leaves() == set(SURFACE_EXCLUDED_LEAVES)
