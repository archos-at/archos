from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

REGENERATE_SWITCH = "UPDATE_FIXTURES"

READERS = {
    "apps/workspace/tests/test-utils/generated-file.ts": "the UI specs' helper, expectGenerated",
    "packages/agent/tests/testing/agent_testing/generated.py": "the Python tests' helper, assert_generated",
    "scripts/generate.py": "task generate, which sets it",
    "packages/ifc-spatial-py/tests/test_vocabulary_fixture.py": "its own uv.lock and IfcOpenShell (task pkg:test)",
}

DATED_RECORDS = ("docs/adr/", "docs/audit/", "docs/roadmap/", "releasenotes/")


def _grep(*pathspecs: str) -> list[str]:
    done = subprocess.run(
        ["git", "grep", "-l", "-F", REGENERATE_SWITCH, "--", *pathspecs],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    return sorted(done.stdout.splitlines())


def test_only_the_helpers_rewrite_a_generated_file() -> None:
    code = _grep("*.ts", "*.tsx", "*.mjs", "*.js", "*.py", "*.sh", "*.yml", "*.yaml")
    strays = [path for path in code if path not in READERS and path != "tests/test_generated_files.py"]
    assert not strays, (
        f"{strays} read {REGENERATE_SWITCH} themselves, so `task generate` does not find them. "
        "Compare and rewrite a generated file with expectGenerated (@/test-utils/generated-file) in a spec, "
        "or assert_generated (agent_testing.generated) in a Python test."
    )


def test_every_named_reader_still_reads_it() -> None:
    code = set(_grep("*.ts", "*.py"))
    assert not set(READERS) - code, f"{sorted(set(READERS) - code)} no longer read it: drop them from READERS"


def test_a_live_doc_names_task_generate_not_the_switch() -> None:
    docs = [path for path in _grep("*.md") if not path.startswith(DATED_RECORDS)]
    told = [path for path in docs if re.search(rf"{REGENERATE_SWITCH}=1", (ROOT / path).read_text(encoding="utf-8"))]
    assert not told, f"{told} tell the reader to set {REGENERATE_SWITCH}=1 on a spec. Say `task generate` instead."
