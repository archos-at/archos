"""Parity guard: the workspace spells the backend's two ingest vocabularies as the backend does.

``JobState`` and ``FileStatus`` (``agent/knowledge/schema.py``) are what an
ingest job and each of its files say about themselves. The workspace reads them
in two tiers and neither shares a schema with Python:

* the browser types them again as zod enums (``JobStateSchema``,
  ``DocumentFileStatusSchema`` in
  ``apps/workspace/ui/adapters/api/documents-schemas.ts``) and maps a file state
  onto a tray row in ``mapBackendStatus``
  (``apps/workspace/ui/features/documents/utils.ts``);
* the BFF does not type them at all: ``resolveJobOutcome`` and
  ``resolveFromCollection`` in ``apps/workspace/bff/documents/reconcile-status.ts``
  compare the strings one by one.

A state added on one side only does not fail anywhere near its cause. The
browser's zod parse throws on a value it does not know, so the job poll logs and
asks again without end and one such file fails a whole listing. The BFF takes
an unknown job status for "still running": the document row stays ``pending``
and is asked about on every read, for good. Both are silent, so the drift is
caught here, and the message says which readers need a branch.
"""

import re
from pathlib import Path

from agent.knowledge.schema import FileStatus
from agent.knowledge.schema import JobState

REPO_ROOT = Path(__file__).resolve().parents[2]
TS_SCHEMAS = REPO_ROOT / "apps" / "workspace" / "ui" / "adapters" / "api" / "documents-schemas.ts"
TS_UTILS = REPO_ROOT / "apps" / "workspace" / "ui" / "features" / "documents" / "utils.ts"

READERS = (
    "A new state needs a branch in every reader, and nothing else asks for one: "
    "resolveJobOutcome and resolveFromCollection in apps/workspace/bff/documents/reconcile-status.ts "
    "(an unknown backend status falls through to 'in progress' there and leaves the document row "
    "`pending` for good), the zod enum in apps/workspace/ui/adapters/api/documents-schemas.ts "
    "(the browser's parse throws on a value it does not list), and mapBackendStatus and "
    "isEndedJobStatus in apps/workspace/ui/features/documents/utils.ts."
)


def _zod_enum(name: str) -> set[str]:
    """The literals of ``export const <name> = z.enum([...])`` in the browser's schemas."""
    source = TS_SCHEMAS.read_text(encoding="utf-8")
    match = re.search(rf"export const {name} = z\.enum\(\[(.*?)\]\)", source, re.DOTALL)
    assert match, f"{name} not found in {TS_SCHEMAS}"
    return set(re.findall(r"'([a-z_]+)'", match.group(1)))


def _mapped_file_states() -> set[str]:
    """The keys of the map inside ``mapBackendStatus``."""
    source = TS_UTILS.read_text(encoding="utf-8")
    match = re.search(r"export const mapBackendStatus = .*?statusMap[^=]*= \{(.*?)\}", source, re.DOTALL)
    assert match, f"mapBackendStatus's statusMap not found in {TS_UTILS}"
    return set(re.findall(r"^\s*([a-z_]+):", match.group(1), re.MULTILINE))


def _difference(python: set[str], typescript: set[str]) -> str:
    return (
        f"only in Python: {sorted(python - typescript)}; only in TypeScript: {sorted(typescript - python)}. {READERS}"
    )


def test_the_browser_knows_exactly_the_job_states_the_backend_writes():
    python, typescript = {state.value for state in JobState}, _zod_enum("JobStateSchema")
    assert typescript == python, f"JobStateSchema: {_difference(python, typescript)}"


def test_the_browser_knows_exactly_the_file_states_the_backend_writes():
    python, typescript = {state.value for state in FileStatus}, _zod_enum("DocumentFileStatusSchema")
    assert typescript == python, f"DocumentFileStatusSchema: {_difference(python, typescript)}"


def test_every_file_state_has_a_branch_in_the_tray_mapping():
    """An unmapped file state reads as ``uploading``: a file shown in flight that never lands."""
    python, mapped = {state.value for state in FileStatus}, _mapped_file_states()
    assert mapped == python, f"mapBackendStatus: {_difference(python, mapped)}"
