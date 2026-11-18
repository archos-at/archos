from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

ALLOWED = (
    "apps/agent-host/entrypoint.py",
    "tests/test_entrypoint_roles.py",
    "tests/test_no_legacy_env_names.py",
    "tests/test_check_brand_prose.py",
    "tests/.test_durations",
    "apps/workspace/scripts/legacy-env-names.cjs",
    "apps/workspace/scripts/legacy-env-names.spec.mjs",
    "deploy/compose/docker-compose.yaml",
    "docs/deployment/environment-variables.md",
    "docs/adr/0145-the-repository-is-laid-out-by-job.md",
    "docs/adr/0079-background-work-runs-on-one-claim-substrate.md",
    "releasenotes/notes/",
)

OLD_NAME = re.compile(r"\bAIQ_")

GRID_NAME = re.compile(r"\bGRID_(?!(HEADER_NAMES|TITLE_KEY|METADATA_KEYS|HIDDEN_KEY|CARDS_KEY|AUTO_INVOKE_KEY)\b)[A-Z]")
GRID_FALLBACK = re.compile(r":-\$\{GRID_")
PROSE = (".md", ".mdx")
GRID_ALLOWED = (
    "scripts/check_brand_names.py",
    "tests/test_check_brand_names.py",
    "tests/test_check_brand_prose.py",
    "tests/.test_durations",
    "apps/workspace/migrations/",
    "apps/website/src/data/",
)


def _tracked_texts():
    tracked = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    for path in tracked:
        if path.startswith(ALLOWED) or not (ROOT / path).is_file():
            continue
        try:
            yield path, (ROOT / path).read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue


def test_no_file_spells_an_old_environment_variable_name():
    offenders = [
        f"{path}:{n}"
        for path, text in _tracked_texts()
        for n, line in enumerate(text.splitlines(), 1)
        if OLD_NAME.search(line)
    ]

    assert not offenders, "Old AIQ_ names; drop the prefix:\n" + "\n".join(offenders)


def test_no_code_or_config_spells_a_grid_prefixed_variable():
    offenders = [
        f"{path}:{n}"
        for path, text in _tracked_texts()
        if not path.endswith(PROSE) and not path.startswith(GRID_ALLOWED) and "GRID_" in text
        for n, line in enumerate(text.splitlines(), 1)
        if GRID_NAME.search(GRID_FALLBACK.sub("", line))
    ]

    assert not offenders, "Old GRID_ names; drop the prefix (environment-variables.md):\n" + "\n".join(offenders)
