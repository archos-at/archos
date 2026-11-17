import re
from pathlib import Path

from agent.common.grounding_block import PROJECT_STATUS_LABELS

REPO_ROOT = Path(__file__).resolve().parents[4]
TS_STATUS = REPO_ROOT / "apps" / "workspace" / "bff" / "projects" / "project-status.ts"


def _ts_statuses() -> set[str]:
    source = TS_STATUS.read_text(encoding="utf-8")
    match = re.search(r"export const PROJECT_STATUSES = \[(.*?)\] as const", source, re.DOTALL)
    assert match, f"PROJECT_STATUSES not found in {TS_STATUS}"
    return set(re.findall(r"'([^']+)'", match.group(1)))


def test_every_status_has_a_label():
    assert _ts_statuses() == set(PROJECT_STATUS_LABELS)


def test_labels_read_back_to_one_status_each():
    assert len(set(PROJECT_STATUS_LABELS.values())) == len(PROJECT_STATUS_LABELS)
