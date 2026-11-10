"""`task verify:fast` runs what a change can break, and everything when it cannot tell.

`ci/verify_plan.py` chooses the tiers from `.github/filters.yml` and the UI
specs through `ci/pr_selection.py`, the two definitions CI's Plan job reads. A
wrong plan is a push that CI then fails, so the widening rules are pinned here.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
READERS = {"tests/english-names.spec.ts": None, "app/api/authz-coverage.spec.ts": ("apps/workspace/app/api/**",)}


@pytest.fixture(scope="module")
def verify_plan():
    sys.path.insert(0, str(ROOT / "ci"))
    spec = importlib.util.spec_from_file_location("verify_plan", ROOT / "ci" / "verify_plan.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["verify_plan"] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def filters(verify_plan):
    return verify_plan.load_filters()


def test_every_tier_with_tasks_is_a_filter(verify_plan, filters) -> None:
    assert set(verify_plan.TIER_TASKS) | set(verify_plan.ALSO_RUN) <= set(filters)


def test_every_task_it_names_exists(verify_plan) -> None:
    taskfiles = "".join(path.read_text(encoding="utf-8") for path in (ROOT / "taskfiles").glob("*.yml"))
    taskfiles += (ROOT / "Taskfile.yml").read_text(encoding="utf-8")
    named = {task for tasks in verify_plan.TIER_TASKS.values() for task in tasks}
    named |= {"workspace:test", "workspace:test:related", "be:test:harness", "be:verify:affected"}
    named |= {command.removeprefix("task ") for command in verify_plan.ALSO_RUN.values()}
    missing = sorted(task for task in named if f"\n  {task}:\n" not in taskfiles)
    assert not missing


def test_a_ui_change_runs_the_ui_tier_on_the_specs_it_reaches(verify_plan, filters) -> None:
    decided = verify_plan.plan(["apps/workspace/ui/features/jobs/components/job-run-history.tsx"], filters, READERS)
    assert decided.tasks == ("workspace:lint", "workspace:types", "workspace:test:related", "be:test:harness")
    assert decided.ui_files == ("tests/english-names.spec.ts", "ui/features/jobs/components/job-run-history.tsx")
    run = verify_plan.command("task", decided)
    assert run[3] == "lint:repo"
    assert run[-2:] == ["SHARD=1/1", "FILES=" + " ".join(decided.ui_files)]


def test_a_change_every_spec_loads_runs_the_whole_ui_suite(verify_plan, filters) -> None:
    decided = verify_plan.plan(["apps/workspace/vitest.config.ts"], filters, READERS)
    assert "workspace:test" in decided.tasks
    assert decided.ui_files == ()


def test_a_backend_change_runs_the_backend_tier_and_no_ui_suite(verify_plan, filters) -> None:
    decided = verify_plan.plan(["packages/agent/src/agent/common/source_kinds.py"], filters, READERS)
    assert decided.tasks == ("be:verify:fast",)


def test_a_backend_change_runs_only_what_it_reaches_once_the_databases_are_recorded(verify_plan, filters) -> None:
    tests = {"packages/agent/tests/test_prompt.py": "PROMPT = 'agents/piloti/prompts/chat_static.md'"}
    changed = ["packages/agent/src/agent/common/source_kinds.py"]
    assert verify_plan.plan(changed, filters, READERS, tests).tasks == ("be:verify:affected",)


def test_a_change_testmon_cannot_see_runs_the_python_suites_whole(verify_plan, filters) -> None:
    decided = verify_plan.plan(["uv.lock"], filters, READERS, {})
    assert "be:verify:fast" in decided.tasks
    assert "be:verify:affected" not in decided.tasks


def test_test_files_naming_a_changed_input_ride_along(verify_plan, filters) -> None:
    tests = {"tests/test_config.py": "load('configs/config_oib_openrouter.yml')"}
    decided = verify_plan.plan(["configs/config_oib_openrouter.yml"], filters, READERS, tests)
    assert decided.py_extra == ("tests/test_config.py",)
    assert "EXTRA=tests/test_config.py" in verify_plan.command("task", decided)


def test_the_databases_it_looks_for_are_the_ones_the_recording_writes(verify_plan, tmp_path) -> None:
    backend = (ROOT / "taskfiles" / "backend.yml").read_text(encoding="utf-8")
    assert "TESTMON_ENV: TESTMON_DATAFILE=.testmondata-" in backend
    assert not verify_plan.recorded_databases(tmp_path)
    for name in verify_plan.TESTMON_DATABASES:
        (tmp_path / name).write_text("")
    assert verify_plan.recorded_databases(tmp_path)


def test_a_filter_line_is_read_as_ci_reads_it(verify_plan) -> None:
    filters = {"packages": ["packages/*.md"], "backend": ["packages/agent/**"]}
    assert verify_plan.tiers_for(["packages/agent/README.md"], filters) == {"backend"}


def test_a_docs_change_still_runs_the_harness_tests(verify_plan, filters) -> None:
    assert verify_plan.plan(["docs/glossary.md"], filters, READERS).tasks == ("be:test:harness",)


def test_the_root_taskfile_runs_every_tier_whole(verify_plan, filters) -> None:
    decided = verify_plan.plan(["Taskfile.yml"], filters, READERS)
    assert set(decided.tasks) == set(verify_plan.full_plan("x").tasks)


def test_a_change_to_a_gate_outside_verify_names_that_gate(verify_plan, filters) -> None:
    decided = verify_plan.plan(["apps/workspace/migrations/0001_init.sql"], filters, READERS)
    assert any("task db:test:rls" in note for note in decided.notes)


def test_no_base_runs_everything(verify_plan, monkeypatch) -> None:
    monkeypatch.setattr(verify_plan, "_git", lambda *args: None)
    assert verify_plan.changed_paths("origin/develop") is None
