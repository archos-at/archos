from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import pytest
import yaml

WORKFLOWS = Path(__file__).resolve().parents[1] / ".github" / "workflows"


def load(name: str) -> dict:
    data = yaml.safe_load((WORKFLOWS / name).read_text(encoding="utf-8"))
    if True in data:
        data["on"] = data.pop(True)
    return data


class Ctx(dict):
    def __getattr__(self, key):
        value = self.get(key, {})
        return Ctx(value) if isinstance(value, dict) else value

    __getitem__ = __getattr__


class Vars(dict):
    def __getattr__(self, key):
        return self.get(key, "")


def evaluate(expression: str, **context) -> object:
    text = " ".join(str(expression).split())
    if text.startswith("${{"):
        text = text[3:-2]
    text = text.replace("&&", " and ").replace("||", " or ")
    text = re.sub(r"!(?!=)", " not ", text)
    text = re.sub(r"\.(\w+(?:-\w+)+)", r"['\1']", text)
    text = text.replace("needs.*.result", "[job.result for job in needs.values()]")
    names = {key: Ctx(value) if isinstance(value, dict) else value for key, value in context.items()}
    names["vars"] = Vars(context.get("vars", {}))
    names |= {
        "always": lambda: True,
        "cancelled": lambda: False,
        "success": lambda: True,
        "contains": lambda haystack, needle: needle in haystack,
    }
    return eval(text, {"__builtins__": {}}, names)  # noqa: S307 - our own workflow files


CI = load("ci.yml")
JOBS = CI["jobs"]
PLAN = JOBS["changes"]
STEPS = {step["id"]: step for step in PLAN["steps"] if "id" in step}
TIERS = ["backend", "workspace", "site", "cms", "infra", "packages", "sast", "hatchet", "skills", "runner_e2e"]
BUILD = json.dumps([{"name": "backend"}])


def plan(
    *,
    event: str,
    parent_green: bool = False,
    hit: str | None = None,
    build: str = BUILD,
    py_mode: str | None = None,
    ui_mode: str | None = None,
    reference: str | None = None,
    depth: str | None = None,
) -> dict:
    github = {"event_name": event}
    steps: dict = {}
    if depth:
        steps["depth"] = {"outputs": {"depth": depth}}
    if evaluate(STEPS["green"]["if"], github=github):
        steps["green"] = {"outputs": {"sha": "f" * 40, "parent-is-green": "true" if parent_green else "false"}}
    if evaluate(STEPS["reuse"]["if"], github=github, steps=steps) and hit is not None:
        steps["reuse"] = {"outputs": {"hit": hit}}
    if evaluate(STEPS["filter"]["if"], github=github, steps=steps):
        steps["filter"] = {"outputs": dict.fromkeys(TIERS, "true")}
    if evaluate(STEPS["pysel"]["if"], github=github, steps=steps) and (py_mode or ui_mode):
        steps["pysel"] = {"outputs": {"py_mode": py_mode or "", "ui_mode": ui_mode or "", "reference": reference or ""}}
    steps["images"] = {"outputs": {"build": build, "images": "[]"}}
    if evaluate(STEPS["pins"]["if"], github=github, steps=steps):
        steps["pins"] = {"outputs": {"pins": '["x@sha256:' + "0" * 64 + '"]'}}
    return {name: evaluate(expr, github=github, steps=steps) for name, expr in PLAN["outputs"].items()}


def runs(job: str, *, event: str, outputs: dict) -> bool:
    condition = JOBS[job].get("if")
    if condition is None:
        return True
    needs = {"changes": {"outputs": outputs, "result": "success"}}
    return bool(evaluate(condition, github={"event_name": event}, needs=needs))


CHECKS = [job for job in JOBS if job not in ("changes", "ci-ok", "publish", "image", "image-push")]
FULL_PY = ["backend", "backend-coverage", "backend-suites"]
FULL_ONLY = [*FULL_PY, "workspace-test", "hatchet", "image"]


def test_a_light_pull_request_run_skips_what_only_the_full_suite_runs():
    light = plan(event="pull_request", py_mode="full", ui_mode="full", depth="light")
    full = plan(event="pull_request", py_mode="full", ui_mode="full", depth="full")

    assert light["depth"] == "light"
    assert not [job for job in FULL_ONLY if runs(job, event="pull_request", outputs=light)]
    assert all(runs(job, event="pull_request", outputs=full) for job in FULL_ONLY)


def test_a_light_run_keeps_the_cheap_checks():
    light = plan(event="pull_request", py_mode="select", ui_mode="select", depth="light")

    for job in ["repo", "repo-tests", "release-notes", "semgrep", "backend-affected", "workspace", "site", "infra"]:
        assert runs(job, event="pull_request", outputs=light), job


def test_a_push_runs_the_full_suite_the_deploy_waits_for():
    push = plan(event="push", depth="full")

    for job in [*FULL_PY, "workspace-test", "hatchet", "image-push"]:
        assert runs(job, event="push", outputs=push), job


def test_a_failed_depth_step_reads_as_full():
    assert plan(event="pull_request")["depth"] == "full"


def test_light_runs_have_an_off_switch_in_the_repository_variable():
    assert STEPS["depth"]["env"]["LIGHT_RUNS"] == "${{ vars.CI_LIGHT_RUNS }}"


def test_the_depth_step_reads_labels_with_the_least_permission_it_needs():
    assert PLAN["permissions"]["pull-requests"] == "read"
    assert "statuses" not in PLAN["permissions"]
    assert "types" not in CI["on"]["pull_request"]


def test_only_a_full_run_leaves_the_green_marker_a_push_reuses():
    steps = {step.get("name"): step for step in JOBS["ci-ok"]["steps"]}

    assert "needs.changes.outputs.depth == 'full'" in steps["Name the tree this run tested"]["if"]


def test_a_pull_request_diffs_its_whole_base_and_a_push_its_last_green_commit():
    base = STEPS["filter"]["with"]["base"]
    pins = STEPS["pins"]["env"]["BASE"]

    assert base == pins == "${{ github.event.pull_request.base.sha || steps.green.outputs.sha }}"


def test_no_workflow_diffs_against_the_previous_push():
    for path in WORKFLOWS.glob("*.yml"):
        assert "github.event.before" not in path.read_text(encoding="utf-8"), path.name


def test_the_last_green_lookup_runs_on_push_and_may_not_fail_quietly():
    green = STEPS["green"]

    assert evaluate(green["if"], github={"event_name": "push"})
    assert not evaluate(green["if"], github={"event_name": "pull_request"})
    assert "continue-on-error" not in green
    assert green["run"] == "python3 ci/last_green.py"


def test_a_branch_coalesces_its_pushes_and_a_pull_request_cancels_its_older_run():
    concurrency = CI["concurrency"]

    assert "github.sha" not in concurrency["group"]
    assert "github.ref" in concurrency["group"] and "github.event_name" in concurrency["group"]
    assert concurrency["cancel-in-progress"] == "${{ github.event_name == 'pull_request' }}"


def test_closing_a_pull_request_cancels_its_ci_run():
    cancel = load("ci-cancel.yml")

    assert cancel["concurrency"] == {"group": CI["concurrency"]["group"], "cancel-in-progress": True}
    assert cancel["on"]["pull_request"]["types"] == ["closed"]
    assert cancel["on"]["pull_request"]["branches"] == CI["on"]["pull_request"]["branches"]
    assert "closed" not in CI["on"]["pull_request"].get("types", [])


def test_a_reused_push_skips_every_check_but_still_publishes():
    outputs = plan(event="push", parent_green=True, hit="true")

    assert outputs["reused"] == "true"
    assert {outputs[tier] for tier in TIERS} == {"false"}
    assert outputs["pins"] == "[]"
    assert [job for job in CHECKS if runs(job, event="push", outputs=outputs)] == []
    assert runs("image-push", event="push", outputs=outputs)


def test_a_pull_request_result_counts_only_on_a_green_parent():
    outputs = plan(event="push", parent_green=False, hit="true")

    assert outputs["reused"] == "false"
    assert [job for job in CHECKS if not runs(job, event="push", outputs=outputs) and job != "semgrep"] == [
        "backend-affected",
    ]


@pytest.mark.parametrize("hit", ["false", None])  # a miss, and a lookup step that failed
def test_a_miss_runs_every_check_the_filter_selects(hit):
    outputs = plan(event="push", parent_green=True, hit=hit)
    skipped = [job for job in CHECKS if not runs(job, event="push", outputs=outputs)]

    assert skipped == ["semgrep", "backend-affected"]


def test_a_pull_request_runs_every_check_the_filter_selects():
    outputs = plan(event="pull_request")

    assert outputs["backend_mode"] == "full"
    assert [job for job in CHECKS if not runs(job, event="pull_request", outputs=outputs)] == ["backend-affected"]
    assert runs("image", event="pull_request", outputs=outputs)
    assert not runs("image-push", event="pull_request", outputs=outputs)


def test_a_selected_pull_request_runs_the_affected_tests_instead_of_the_full_suite():
    selected = plan(event="pull_request", py_mode="select")
    full = plan(event="pull_request", py_mode="full")

    assert runs("backend-affected", event="pull_request", outputs=selected)
    assert not any(runs(job, event="pull_request", outputs=selected) for job in FULL_PY)
    assert not runs("backend-affected", event="pull_request", outputs=full)
    assert all(runs(job, event="pull_request", outputs=full) for job in FULL_PY)


@pytest.mark.parametrize(("reference", "own"), [("green", True), ("base", False), (None, False)])
def test_a_suite_reads_its_own_database_only_against_the_last_green_run(reference, own):
    outputs = plan(event="pull_request", py_mode="select", reference=reference)
    step = next(s for s in JOBS["backend-affected"]["steps"] if s.get("id") == "own-db")
    needs = {"changes": {"outputs": outputs}}

    assert bool(evaluate(step["if"], matrix={"suite": "api"}, needs=needs)) is own
    assert not evaluate(step["if"], matrix={"suite": "core", "shard": 1}, needs=needs)


def test_a_push_always_runs_the_full_python_suite():
    outputs = plan(event="push", py_mode="select")

    assert all(runs(job, event="push", outputs=outputs) for job in FULL_PY)
    assert not runs("backend-affected", event="push", outputs=outputs)


def test_the_test_database_follows_every_develop_push_and_holds_nobody_up():
    testmon = load("testmon.yml")
    job = testmon["jobs"]["backend-testmon"]

    assert testmon["on"]["push"]["branches"] == ["develop"]
    assert "**/*.py" in testmon["on"]["push"]["paths"] and "uv.lock" in testmon["on"]["push"]["paths"]
    assert "backend-testmon" not in JOBS
    assert not any("be:test:testmon" in json.dumps(other) for other in JOBS.values())
    assert testmon["concurrency"]["group"] != CI["concurrency"]["group"]
    steps = job["steps"]
    run = next(i for i, step in enumerate(steps) if step.get("run") == "task be:test:testmon")
    save = next(i for i, step in enumerate(steps) if step.get("uses", "").startswith("actions/cache/save"))
    assert save > run and "if" not in steps[save]
    restore = next(
        step for step in JOBS["backend-affected"]["steps"] if step.get("name") == "Restore develop's test database"
    )
    assert steps[save]["with"]["path"] == restore["with"]["path"]
    assert steps[save]["with"]["key"].startswith(restore["with"]["restore-keys"].strip())


def test_a_ui_selection_runs_the_shards():
    selected = plan(event="pull_request", ui_mode="select")
    nothing = plan(event="pull_request", ui_mode="none")
    full = plan(event="pull_request", ui_mode="full")

    assert runs("workspace-test", event="pull_request", outputs=selected)
    assert not runs("workspace-test", event="pull_request", outputs=nothing)
    assert runs("workspace-test", event="pull_request", outputs=full)
    assert runs("workspace", event="pull_request", outputs=nothing)


def test_a_push_always_runs_every_ui_spec():
    outputs = plan(event="push", ui_mode="none")

    assert runs("workspace-test", event="push", outputs=outputs)
    steps = {step.get("name", ""): step for step in JOBS["workspace-test"]["steps"]}
    full = next(step for name, step in steps.items() if name.startswith("All specs"))
    assert evaluate(full["if"], github={"event_name": "push"}, needs={"changes": {"outputs": outputs}})


def test_a_failed_selection_step_reads_as_the_full_suite():
    assert STEPS["pysel"]["continue-on-error"] is True
    assert PLAN["outputs"]["backend_mode"] == "${{ steps.pysel.outputs.py_mode || 'full' }}"
    assert PLAN["outputs"]["ui_mode"] == "${{ steps.pysel.outputs.ui_mode || 'full' }}"


def test_the_reuse_lookup_cannot_fail_the_run():
    reuse = STEPS["reuse"]

    assert reuse["continue-on-error"] is True
    assert reuse["run"] == "python3 ci/reuse_green_run.py ci-green"
    assert PLAN["permissions"] == {
        "contents": "read",
        "actions": "read",
        "packages": "read",
        "pull-requests": "read",
    }


def test_the_marker_is_uploaded_only_by_a_passing_pull_request_gate():
    steps = JOBS["ci-ok"]["steps"]
    check = next(i for i, step in enumerate(steps) if "Require needed jobs" in step.get("name", ""))
    uploads = [i for i, step in enumerate(steps) if step.get("uses", "").startswith("actions/upload-artifact")]

    assert JOBS["ci-ok"]["if"] == "always()"
    assert set(JOBS["ci-ok"]["needs"]) == set(JOBS) - {"ci-ok"}
    assert len(uploads) == 1 and uploads[0] > check
    upload = steps[uploads[0]]
    assert not re.search(r"always\(\)|failure\(\)|cancelled\(\)", upload["if"])
    assert "github.event_name == 'pull_request'" in upload["if"]
    assert upload["with"]["name"] == "ci-green-${{ steps.tree.outputs.tree }}"
    assert int(upload["with"]["retention-days"]) <= 7
    for other in WORKFLOWS.glob("*.yml"):
        if other.name != "ci.yml":
            assert "ci-green-" not in other.read_text(encoding="utf-8")


def test_only_a_push_can_write_to_the_registry():
    for name, job in JOBS.items():
        packages = (job.get("permissions") or {}).get("packages")
        if packages == "write":
            assert name in ("image-push", "publish")
            assert not runs(name, event="pull_request", outputs=plan(event="pull_request"))
    assert CI.get("permissions") == {"contents": "read"}
    assert JOBS["image"]["permissions"]["packages"] == "read"
    pushes = [step for step in JOBS["image"]["steps"] if step.get("with", {}).get("push")]
    assert pushes == []


def test_no_image_job_runs_with_an_empty_build_plan():
    outputs = plan(event="push", build="[]")

    assert not runs("image-push", event="push", outputs=outputs)
    assert not runs("image", event="pull_request", outputs=plan(event="pull_request", build="[]"))


def test_the_commit_is_tagged_only_after_every_check_on_its_push_passed():
    publish = JOBS["publish"]
    can_run_on_push = {job for job in CHECKS if runs(job, event="push", outputs=plan(event="push"))}

    assert can_run_on_push <= set(publish["needs"])
    assert "image-push" in publish["needs"]
    condition = " ".join(publish["if"].split())
    assert "github.event_name == 'push'" in condition
    assert "needs.changes.result == 'success'" in condition
    assert "!contains(needs.*.result, 'failure')" in condition
    assert "!contains(needs.*.result, 'cancelled')" in condition
    assert "publish" in JOBS["ci-ok"]["needs"]


def test_the_engine_suites_run_on_the_engine_production_runs():
    root = WORKFLOWS.parents[1]
    production = re.search(
        r'HATCHET_IMAGE_TAG = "([^"]+)"', (root / "deploy/pulumi/src/config/background-work.ts").read_text()
    )
    pins = {
        path: re.findall(r"hatchet-lite:(v[\w.]+)", (root / path).read_text())
        for path in ("ci/hatchet_engine.sh", "deploy/compose/docker-compose.yaml")
    }

    assert production
    assert pins == dict.fromkeys(pins, [production[1]])


def test_the_engine_job_runs_on_its_own_tier():
    assert JOBS["hatchet"]["if"] == "needs.changes.outputs.depth == 'full' && needs.changes.outputs.hatchet == 'true'"
    assert not runs("hatchet", event="pull_request", outputs=plan(event="pull_request") | {"hatchet": "false"})


def test_a_report_with_a_skipped_test_fails_and_an_expected_failure_does_not(tmp_path):
    def require_ran(case: str) -> int:
        report = tmp_path / "report.xml"
        report.write_text(f'<testsuite><testcase name="a">{case}</testcase></testsuite>', encoding="utf-8")
        script = WORKFLOWS.parents[1] / "ci/hatchet_engine.sh"
        return subprocess.run(["bash", script, "require-ran", report], capture_output=True, check=False).returncode

    assert require_ran("") == 0
    assert require_ran('<skipped type="pytest.xfail" message="a known bug"/>') == 0
    assert require_ran('<skipped type="pytest.skip" message="no engine"/>') == 1
    assert require_ran("<skipped/>") == 1


def test_the_agent_engine_job_runs_every_suite_that_skips_without_the_engine():
    root = WORKFLOWS.parents[1]
    gated = {
        path.relative_to(root).as_posix()
        for tests in ("packages/agent/tests", "apps/agent-host/tests")
        for path in (root / tests).rglob("test_*.py")
        if 'importorskip("ifc_spatial' in path.read_text(encoding="utf-8")
    }
    steps = JOBS["agent-engine"]["steps"]
    suites = next(step["run"] for step in steps if "pytest" in step.get("run", ""))
    named = {
        match.relative_to(root).as_posix()
        for pattern in re.findall(r"\S+/test_\S+\.py", suites)
        for match in root.glob(pattern)
    }

    assert "packages/agent/tests/tools/bim/test_question_battery.py" in gated
    assert named == gated
    assert any("require-ran" in step.get("run", "") for step in steps)


def test_the_agent_engine_job_installs_the_engine_the_way_the_image_does():
    dockerfile = (WORKFLOWS.parents[1] / "apps/agent-host/Dockerfile").read_text(encoding="utf-8")
    install = re.search(r"(uv pip install -e \S*ifc-spatial-py\S*)$", dockerfile, re.MULTILINE)
    steps = JOBS["agent-engine"]["steps"]

    assert install
    assert any(install[1] in step.get("run", "") for step in steps)
    assert not [step for step in steps if "setup-python-env" in step.get("uses", "")]


@pytest.mark.parametrize("tier", ["backend", "packages"])
def test_the_agent_engine_job_runs_when_either_side_of_the_path_changes(tier):
    nothing = plan(event="pull_request") | {"backend": "false", "packages": "false"}

    assert not runs("agent-engine", event="pull_request", outputs=nothing)
    assert runs("agent-engine", event="pull_request", outputs=nothing | {tier: "true"})


def test_the_agent_engine_job_waits_for_a_full_run_and_runs_where_there_is_no_depth():
    full = plan(event="pull_request")
    without_depth = {key: value for key, value in full.items() if key != "depth"}

    assert not runs("agent-engine", event="pull_request", outputs=full | {"depth": "light"})
    assert runs("agent-engine", event="pull_request", outputs=full | {"depth": "full"})
    assert runs("agent-engine", event="pull_request", outputs=without_depth)


def test_the_agent_engine_job_runs_when_the_script_it_calls_changes():
    filters = yaml.safe_load((WORKFLOWS.parent / "filters.yml").read_text(encoding="utf-8"))

    assert any("ci/hatchet_engine.sh" in step.get("run", "") for step in JOBS["agent-engine"]["steps"])
    assert "ci/hatchet_engine.sh" in filters["packages"]


def test_a_push_lints_its_release_notes_and_a_pull_request_must_add_one():
    steps = JOBS["release-notes"]["steps"]
    lint = next(step for step in steps if step.get("name") == "Release notes (lint)")
    require = next(step for step in steps if "require_release_note.py" in step.get("run", ""))

    assert "if" not in lint
    assert "task release:lint:house" in lint["run"]
    assert "task release:lint\n" in lint["run"]
    assert "releasenotes/ Taskfile.yml taskfiles/repo.yml" in lint["run"]
    assert evaluate(require["if"], github={"event_name": "pull_request"})
    assert not evaluate(require["if"], github={"event_name": "push"})
    assert "labels.*.name" not in require["if"]
    assert "no-release-note" in require["run"]


@pytest.mark.parametrize("job", ["repo", "release-notes"])
def test_a_pull_requests_repo_checks_fetch_only_down_to_the_merge_base(job):
    steps = JOBS[job]["steps"]
    checkout = steps[0]
    depth = checkout["with"]["fetch-depth"]
    assert evaluate(depth.removeprefix("${{").removesuffix("}}"), github={"event_name": "pull_request"}) == 1
    assert evaluate(depth.removeprefix("${{").removesuffix("}}"), github={"event_name": "push"}) == 0

    fetch = steps[1]
    assert evaluate(fetch["if"], github={"event_name": "pull_request"})
    assert 'ci/fetch_merge_base.sh "$BASE_SHA" "$HEAD_SHA"' in fetch["run"]
    assert ". ci/git_auth.sh" in fetch["run"]
    readers = [
        i
        for i, step in enumerate(steps)
        if "require_release_note.py" in step.get("run", "") or "gitleaks" in step.get("run", "")
    ]
    assert readers and min(readers) > 1


def test_repo_checks_run_as_legs_side_by_side_and_all_gate():
    legs = {"repo", "repo-tests", "release-notes"}

    for leg in legs:
        assert JOBS[leg]["needs"] == "changes"
        assert JOBS[leg]["if"] == "needs.changes.outputs.reused != 'true'"
        assert JOBS[leg]["name"].startswith("Repo checks (")
        assert leg in JOBS["publish"]["needs"] and leg in JOBS["ci-ok"]["needs"]
    assert "be:test:harness" in json.dumps(JOBS["repo-tests"])
    assert "be:test:harness" not in json.dumps(JOBS["repo"]) + json.dumps(JOBS["release-notes"])


def test_the_skill_lockfile_is_audited_only_when_something_it_hashes_changed():
    audit = next(step for step in JOBS["release-notes"]["steps"] if step.get("run") == "task agents:audit")
    filters = yaml.safe_load((WORKFLOWS.parent / "filters.yml").read_text(encoding="utf-8"))

    assert audit["if"] == "needs.changes.outputs.skills == 'true'"
    assert {"skills/**", "apm.yml", "apm.lock.yaml", "Taskfile.yml"} <= set(filters["skills"])
    assert evaluate(PLAN["outputs"]["skills"], steps={"filter": {"outputs": {"skills": "true"}}}) == "true"


def test_only_the_helper_unshallows_a_clone():
    root = WORKFLOWS.parents[1]
    sources = [
        *WORKFLOWS.glob("*.yml"),
        *(root / ".github" / "actions").rglob("*.yml"),
        *(root / "ci").glob("*"),
        *(root / "taskfiles").glob("*.yml"),
        root / "Taskfile.yml",
    ]
    bare = [
        f"{path.relative_to(root)}:{number}"
        for path in sources
        if path.is_file() and path.name != "unshallow.sh"
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
        if "--unshallow" in line
    ]

    assert bare == [], (
        f"{bare} run `git fetch --unshallow`, which aborts on a clone an earlier step completed: "
        "call ci/unshallow.sh instead"
    )


def test_semgrep_finds_its_own_merge_base_from_a_shallow_clone():
    steps = JOBS["semgrep"]["steps"]
    checkout = steps[0]
    assert "fetch-depth" not in checkout.get("with", {})
    scan = next(step for step in steps if "semgrep ci" in step.get("run", ""))
    assert scan["env"]["GH_TOKEN"] == "${{ github.token }}"


def test_the_pr_secret_scan_reads_only_the_history_under_test():
    scans = [step for step in JOBS["repo"]["steps"] if "gitleaks" in step.get("run", "")]

    assert len(scans) == 2
    for scan in scans:
        assert scan["env"]["BASE_SHA"] == "${{ github.event.pull_request.base.sha }}"
        assert 'range="$BASE_SHA..HEAD"' in scan["run"]
        assert 'range="--full-history HEAD"' in scan["run"]
        assert '--log-opts="$range"' in scan["run"]


def test_security_is_surveillance_and_the_gate_lives_in_ci():
    triggers = set(load("security.yml")["on"])

    assert triggers == {"schedule", "workflow_dispatch"}
    assert "gitleaks" in json.dumps(JOBS["repo"])
    assert re.fullmatch(r"semgrep/semgrep:\d+\.\d+\.\d+", evaluate(JOBS["semgrep"]["container"]["image"]))


DEPLOY = load("deploy.yml")


def test_staging_deploys_follow_ci_and_nothing_else():
    trigger = DEPLOY["on"]["workflow_run"]

    assert trigger == {"workflows": ["CI"], "types": ["completed"], "branches": ["develop"]}
    assert "gate" not in DEPLOY["jobs"]


@pytest.mark.parametrize(
    ("run", "deploys"),
    [
        ({"conclusion": "success", "event": "push", "head_repository": {"full_name": "acme/grid"}}, True),
        ({"conclusion": "cancelled", "event": "push", "head_repository": {"full_name": "acme/grid"}}, False),
        ({"conclusion": "failure", "event": "push", "head_repository": {"full_name": "acme/grid"}}, False),
        ({"conclusion": "success", "event": "pull_request", "head_repository": {"full_name": "acme/grid"}}, False),
        ({"conclusion": "success", "event": "push", "head_repository": {"full_name": "fork/grid"}}, False),
    ],
)
def test_staging_deploys_only_a_green_push_run_of_this_repository(run, deploys):
    condition = DEPLOY["jobs"]["deploy"]["if"]
    github = {"event_name": "workflow_run", "repository": "acme/grid", "event": {"workflow_run": run}}

    assert bool(evaluate(condition, github=github, inputs={})) is deploys
    assert not evaluate(DEPLOY["jobs"]["deploy-prod"]["if"], github=github, inputs={})


@pytest.mark.parametrize("workflow", sorted(path.name for path in WORKFLOWS.glob("*.yml")))
def test_every_job_has_a_timeout(workflow):
    jobs = load(workflow)["jobs"]
    missing = [name for name, job in jobs.items() if "uses" not in job and "timeout-minutes" not in job]
    assert not missing, f"{workflow}: no timeout-minutes on {missing}"


def test_every_action_is_pinned_to_a_commit():
    github = WORKFLOWS.parent
    pattern = re.compile(r"^\s*-?\s*uses:\s*(?P<ref>\S+)(?P<rest>.*)$", re.M)
    unpinned = [
        f"{path.relative_to(github)}: {match['ref']}"
        for path in sorted(github.rglob("*.yml"))
        for match in pattern.finditer(path.read_text(encoding="utf-8"))
        if not match["ref"].startswith(("./", "docker://"))
        and not (re.fullmatch(r"[^@]+@[0-9a-f]{40}", match["ref"]) and re.match(r"\s+# v\d", match["rest"]))
    ]
    assert not unpinned, f"pin these to a commit SHA with a `# vX.Y.Z` comment: {unpinned}"


def _step_index(steps: list[dict], name: str) -> int:
    return next(i for i, step in enumerate(steps) if step.get("name") == name)


@pytest.mark.parametrize("job", ["deploy", "deploy-prod"])
def test_every_deploy_is_smoke_checked_from_outside_and_names_its_rollback(job):
    steps = DEPLOY["jobs"][job]["steps"]
    up = _step_index(steps, "Pulumi up")

    assert _step_index(steps, "Remember what is running") < up
    smoke = steps[_step_index(steps, "Smoke check")]
    assert _step_index(steps, "Smoke check") > up
    assert "continue-on-error" not in smoke
    assert '"$SMOKE_CHECK"' in smoke["run"]
    assert "for path in /api/healthz /api/health;" in DEPLOY["env"]["SMOKE_CHECK"]
    rollback = steps[_step_index(steps, "How to roll this back")]
    assert rollback["if"].startswith("${{ always()")
    assert "gh workflow run deploy.yml" in rollback["run"]


def test_production_always_deploys_the_prod_branchs_program():
    job = DEPLOY["jobs"]["deploy-prod"]
    checkout = next(step for step in job["steps"] if step.get("uses", "").startswith("actions/checkout"))

    ref = checkout["with"]["ref"]
    assert evaluate(ref, github={"event_name": "push", "sha": "abc"}) == "abc"
    assert evaluate(ref, github={"event_name": "workflow_dispatch", "sha": "abc"}) == "prod"
    assert "GITHUB_SHA" not in json.dumps(job["steps"])


def test_a_prod_rollback_is_a_dispatch_tag_checked_before_it_reaches_a_command_line():
    job = DEPLOY["jobs"]["deploy-prod"]
    steps = job["steps"]

    assert job["env"]["ROLLBACK_TAG"] == "${{ inputs.imageTag }}"
    assert job["environment"]["name"] == "production"
    verify = _step_index(steps, "Verify the pinned images exist")
    assert "^sha-[0-9a-f]{40}$" in steps[verify]["run"]
    validate = steps[_step_index(steps, "Validate plan (CRD schemas + policy pack)")]
    assert all(key in validate["run"] for key in ("backendImage", "frontendImage", "webImage"))
    for name in ("Validate plan (CRD schemas + policy pack)", "Pulumi up"):
        index = _step_index(steps, name)
        assert index > verify
        assert 'pulumi config set imageTag "$ROLLBACK_TAG"' in steps[index]["run"]


def test_a_pull_request_must_not_take_away_what_a_rollback_reads():
    step = next(s for s in JOBS["release-notes"]["steps"] if "migration_contract.py" in s.get("run", ""))

    assert evaluate(step["if"], github={"event_name": "pull_request"})
    assert not evaluate(step["if"], github={"event_name": "push"})
    assert "migration:contract" in step["run"] and "labels" not in step["if"]
    labels = yaml.safe_load((WORKFLOWS.parent / "labels.yml").read_text(encoding="utf-8"))
    assert "migration:contract" in {label["name"] for label in labels}


def test_no_pull_request_can_skip_ci_on_its_merge_commit():
    code = load("pr.yml")["jobs"]["skip-markers"]["steps"][0]["run"]

    def verdict(title: str, body: str) -> bool:
        import os

        os.environ["TITLE"], os.environ["BODY"] = title, body
        try:
            exec(code, {})  # noqa: S102 - our own workflow's script
        except SystemExit:
            return False
        return True

    assert verdict("feat: a thing", "we skip CI flakes by fixing them")
    for marker in ("[skip ci]", "[ci skip]", "[no ci]", "[skip actions]", "[actions skip]", "skip-checks: true"):
        assert not verdict("fix: x", f"text {marker.upper()}")


def test_a_ci_triggered_deploy_of_what_staging_runs_applies_nothing():
    steps = DEPLOY["jobs"]["deploy"]["steps"]
    skip = _step_index(steps, "Skip a commit staging already runs")

    assert steps[skip]["if"] == "${{ github.event_name == 'workflow_run' }}"
    assert skip > _step_index(steps, "Resolve per-service image refs")
    for name in ("Validate plan (CRD schemas + policy pack)", "Pulumi up"):
        assert "env.ALREADY_DEPLOYED != 'true'" in steps[_step_index(steps, name)]["if"]
    assert '"$program" = "$DEPLOY_SHA"' in steps[skip]["run"]
    assert 'pulumi stack tag set deployed-commit "$DEPLOY_SHA"' in steps[_step_index(steps, "Pulumi up")]["run"]
    assert "if" not in steps[_step_index(steps, "Smoke check")]


def test_deploys_are_one_repository_variable_away_from_self_hosted():
    for name, job in DEPLOY["jobs"].items():
        assert job["runs-on"] == "${{ vars.DEPLOY_RUNNER || 'ubuntu-latest' }}", name


def test_source_maps_are_uploaded_after_ci_by_a_workflow_nothing_waits_on():
    workflow = load("sourcemaps.yml")
    job = workflow["jobs"]["upload"]

    assert workflow["on"]["workflow_run"]["workflows"] == ["CI"]
    green_push = {
        "event_name": "workflow_run",
        "repository": "acme/grid",
        "event": {
            "workflow_run": {"conclusion": "success", "event": "push", "head_repository": {"full_name": "acme/grid"}}
        },
    }
    assert evaluate(job["if"], github=green_push)
    for change in ({"event": "pull_request"}, {"conclusion": "failure"}, {"head_repository": {"full_name": "fork/x"}}):
        run = green_push["event"]["workflow_run"] | change
        assert not evaluate(job["if"], github=green_push | {"event": {"workflow_run": run}})
    assert "POSTHOG_CLI_API_KEY" not in json.dumps(JOBS)  # no job of CI holds the key any more


def test_the_upload_runs_the_cli_the_build_injected_with():
    package = json.loads((WORKFLOWS.parents[1] / "apps/workspace/package.json").read_text(encoding="utf-8"))
    steps = load("sourcemaps.yml")["jobs"]["upload"]["steps"]
    upload = next(s for s in steps if s.get("name") == "Upload to PostHog")
    fetch = next(s for s in steps if s.get("name") == "Fetch the run's source maps")
    assert "continue-on-error" not in fetch
    assert fetch["if"] == upload["if"] == "steps.maps.outputs.exported == 'true'"

    assert upload["env"]["POSTHOG_CLI_VERSION"] == package["devDependencies"]["@posthog/cli"]
    assert "--release-name workspace-ui" in upload["run"] and '--release-version "$RELEASE_VERSION"' in upload["run"]


def test_only_the_pushed_frontend_build_exports_its_source_maps():
    push = next(s for s in JOBS["image-push"]["steps"] if s.get("uses") == "./.github/actions/build-image")
    pull_request = next(s for s in JOBS["image"]["steps"] if s.get("uses") == "./.github/actions/build-image")

    assert push["with"]["export-sourcemaps"] == "${{ matrix.name == 'frontend' }}"
    assert "export-sourcemaps" not in pull_request["with"]


def test_every_ci_job_runs_the_node_version_the_repository_pins():
    pinned = (WORKFLOWS.parents[1] / ".node-version").read_text(encoding="utf-8").strip()

    assert re.fullmatch(r"\d+\.\d+\.\d+", pinned)
    for name, job in JOBS.items():
        for step in job.get("steps", []):
            if "actions/setup-node" in step.get("uses", ""):
                assert step["with"] == {"node-version-file": ".node-version"}, name


def test_no_job_posts_a_coverage_comment_or_instruments_the_ui_shards():
    text = (WORKFLOWS / "ci.yml").read_text()
    assert "pytest-coverage-comment" not in text and "vitest-coverage-report" not in text
    shard = next(s for s in JOBS["workspace-test"]["steps"] if s.get("name", "").startswith("All specs"))
    assert "COVERAGE=false" in shard["run"]


def test_claude_runs_only_where_a_mention_can_start_it_and_one_ai_review_remains():
    workflows = WORKFLOWS
    claude = yaml.safe_load((workflows / "claude.yml").read_text())
    assert set(claude[True]) == {"issue_comment", "issues"}
    assert not (workflows / "claude-code-review.yml").exists()


def test_dependabot_auto_merge_waits_for_ci_ok_and_starts_the_push_run():
    workflow = yaml.safe_load((WORKFLOWS / "dependabot-auto-merge.yml").read_text())
    job = workflow["jobs"]["enable"]
    assert "dependabot[bot]" in job["if"]
    assert workflow["permissions"] == {}
    steps = {step.get("name"): step for step in job["steps"]}
    enable = steps["Turn on auto-merge"]
    lines = [line.strip() for line in enable["run"].splitlines()]
    merge = next(i for i, line in enumerate(lines) if "gh pr merge --auto --squash" in line)
    guard = lines.index('if [ "$ci_ok_required" != "true" ]; then')
    assert "python3 ci/dependabot_merge.py rules" in lines[guard - 2]
    assert lines[guard + 2] == "exit 0" and lines[guard + 3] == "fi"
    assert guard < merge
    assert enable["env"]["MERGE_TOKEN"] == "${{ secrets.DEPENDABOT_MERGE_TOKEN }}"
    assert lines[merge].startswith('GH_TOKEN="$MERGE_TOKEN" gh pr merge')
    approve = next(line for line in lines if "gh pr review --approve" in line)
    assert approve.startswith('GH_TOKEN="$MERGE_TOKEN" gh pr review')
    assert enable["if"] == "steps.decide.outputs.merge == 'true'"
    disable = steps["Turn off auto-merge on an update a person must read"]
    assert disable["if"] == "always() && steps.decide.outputs.merge != 'true'"
    assert "gh pr merge --disable-auto" in disable["run"]


# --- Where a job runs: GitHub's runners, or the dev cluster's (ADR-0184) ---

CLUSTER = {"CI_RUNNER": "dev-cluster"}
ON_CLUSTER = "${{ vars.CI_RUNNER || 'ubuntu-latest' }}"
CLUSTER_WORKFLOWS = ["ci.yml", "testmon.yml", "sourcemaps.yml"]
ROOT = WORKFLOWS.parents[1]
SCRIPT = re.compile(r"\b((?:ci|scripts)/[\w./-]+\.sh)\b")
TASK = re.compile(r"\btask ([\w:-]+)")
DOCKER_OR_ROOT = re.compile(r"^(?!\s*#).*\b(docker|sudo)\b", re.M)
DOCKER_FREE_CALLS = ("ci/hatchet_engine.sh require-ran",)


def resolve(value: object, **context) -> object:
    text = str(value)
    return evaluate(text, **context) if text.startswith("${{") else text


def _tasks() -> dict[str, list]:
    tasks: dict[str, list] = {}
    for path in [ROOT / "Taskfile.yml", *sorted((ROOT / "taskfiles").glob("*.yml"))]:
        for name, task in (yaml.safe_load(path.read_text(encoding="utf-8")).get("tasks") or {}).items():
            tasks[name] = [*task.get("deps", []), *task.get("cmds", [])] if isinstance(task, dict) else []
    return tasks


TASKS = _tasks()


def _needs_docker(text: str, seen: frozenset = frozenset()) -> bool:
    for call in DOCKER_FREE_CALLS:
        text = text.replace(call, "")
    if DOCKER_OR_ROOT.search(text):
        return True
    scripts = [ROOT / name for name in SCRIPT.findall(text) if (ROOT / name).is_file()]
    if any(DOCKER_OR_ROOT.search(path.read_text(encoding="utf-8")) for path in scripts):
        return True
    for name in set(TASK.findall(text)) - seen:
        calls = [cmd["task"] if isinstance(cmd, dict) and "task" in cmd else str(cmd) for cmd in TASKS.get(name, [])]
        if any(_needs_docker(f"task {call}" if call in TASKS else call, seen | {name}) for call in calls):
            return True
    return False


def _may_run(step: dict, variables: dict) -> bool:
    condition = str(step.get("if", ""))
    if "vars." not in condition or re.search(r"\b(github|needs|matrix|steps|env)\.", condition):
        return True
    return bool(evaluate(condition, vars=variables))


def github_only(job: dict, variables: dict = CLUSTER) -> list[str]:
    reasons = []
    if "write" in (job.get("permissions") or {}).values():
        reasons.append("can write")
    if "secrets." in json.dumps(job):
        reasons.append("reads a secret")
    if any(resolve(service.get("image", ""), vars=variables) for service in (job.get("services") or {}).values()):
        reasons.append("a service container")
    if job.get("container") and resolve(job["container"].get("image", ""), vars=variables):
        reasons.append("a job container")
    return reasons + [reason for step in job.get("steps", []) for reason in _step_reasons(step, variables)]


def _step_reasons(step: dict, variables: dict) -> list[str]:
    if not _may_run(step, variables):
        return []
    uses = step.get("uses", "")
    if uses.startswith("./.github/actions/"):
        action = yaml.safe_load((ROOT / uses / "action.yml").read_text(encoding="utf-8"))
        return [reason for inner in action["runs"].get("steps", []) for reason in _step_reasons(inner, variables)]
    if uses.startswith("docker/"):
        return [f"builds images ({uses})"]
    no_docker = resolve(step.get("env", {}).get("NO_DOCKER", "false"), vars=variables) in (True, "true")
    if not no_docker and _needs_docker(step.get("run", "")):
        return [f"Docker or root in {step.get('name') or step['run'].splitlines()[0]!r}"]
    return []


@pytest.mark.parametrize("workflow", CLUSTER_WORKFLOWS)
def test_a_job_runs_on_github_exactly_when_it_needs_docker_root_a_secret_or_a_write_token(workflow):
    for name, job in load(workflow)["jobs"].items():
        reasons = github_only(job)
        if reasons:
            assert job["runs-on"] == "ubuntu-latest", f"{workflow} {name} could land on the cluster: {reasons}"
        else:
            assert job["runs-on"] == ON_CLUSTER, f"{workflow} {name} needs nothing the cluster lacks"


@pytest.mark.parametrize("workflow", CLUSTER_WORKFLOWS)
def test_with_ci_runner_unset_every_job_runs_on_github_as_before(workflow):
    for name, job in load(workflow)["jobs"].items():
        assert resolve(job["runs-on"]) == "ubuntu-latest", name
        for service in (job.get("services") or {}).values():
            assert resolve(service["image"]) == "qdrant/qdrant:v1.19.2", name
        cluster_only = {step["name"] for step in job["steps"] if not _may_run(step, {})}
        assert cluster_only <= {"Start Qdrant from its binary", "Secret scan (gitleaks, the runner image's binary)"}
    assert "pull_request_target" not in load(workflow)["on"]


def test_the_cluster_path_swaps_each_container_for_the_runner_images_binary():
    for name, job in [*JOBS.items(), *load("testmon.yml")["jobs"].items()]:
        if not job.get("services"):
            continue
        start = [step for step in job["steps"] if step.get("name") == "Start Qdrant from its binary"]
        assert len(start) == 1 and evaluate(start[0]["if"], vars=CLUSTER), name
        assert "QDRANT_HTTP_PORT=6333 bash scripts/qdrant-test-server.sh --start" in start[0]["run"]
        assert job["env"]["QDRANT_TEST_URL"].endswith(":6333"), name
        first_test = next(i for i, step in enumerate(job["steps"]) if "task " in step.get("run", ""))
        assert job["steps"].index(start[0]) < first_test, name
    assert evaluate(JOBS["semgrep"]["container"]["image"], vars=CLUSTER) == ""
    trivy = next(step for step in JOBS["trivy"]["steps"] if "trivy_scan.sh" in step.get("run", ""))
    assert evaluate(trivy["env"]["NO_DOCKER"], vars=CLUSTER) is True
    assert evaluate(trivy["env"]["NO_DOCKER"]) is False


def test_the_jobs_that_stay_on_github_are_the_ones_that_must():
    hosted = {name for name, job in JOBS.items() if job["runs-on"] == "ubuntu-latest"}

    assert hosted == {"packages", "hatchet", "image", "image-push", "publish"}
    assert load("sourcemaps.yml")["jobs"]["upload"]["runs-on"] == "ubuntu-latest"


def test_the_detector_sees_docker_inside_a_local_action():
    assert _step_reasons({"uses": "./.github/actions/build-image"}, CLUSTER)
    assert not _step_reasons({"uses": "./.github/actions/setup-python-env"}, CLUSTER)


def test_the_detector_sees_docker_behind_a_task_and_a_script():
    assert _needs_docker("task browser:test")
    assert _needs_docker("task runner:test")
    assert _needs_docker("bash ci/hatchet_engine.sh start")
    assert not _needs_docker("task db:test:rls")
    assert not _needs_docker("bash scripts/qdrant-test-server.sh --start")
    assert not _needs_docker("bash ci/hatchet_engine.sh require-ran report.xml")


def test_the_engine_report_check_runs_without_docker(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "docker").write_text('#!/bin/sh\necho called >> "$CALLS"\nexit 99\n', encoding="utf-8")
    (bin_dir / "docker").chmod(0o755)
    report = tmp_path / "report.xml"
    report.write_text('<testsuite tests="1" skipped="0"><testcase name="t"/></testsuite>', encoding="utf-8")
    env = {"PATH": f"{bin_dir}:/usr/bin:/bin", "CALLS": str(tmp_path / "calls.log")}

    subprocess.run(["bash", str(ROOT / "ci" / "hatchet_engine.sh"), "require-ran", str(report)], env=env, check=True)

    assert not (tmp_path / "calls.log").exists()


def test_the_trivy_scan_runs_the_binary_on_a_runner_without_docker(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for tool in ("trivy", "docker"):
        (bin_dir / tool).write_text(f'#!/bin/sh\necho "{tool} $*" >> "$CALLS"\n', encoding="utf-8")
        (bin_dir / tool).chmod(0o755)
    (tmp_path / "pins.txt").write_text("x@sha256:" + "0" * 64 + "\n", encoding="utf-8")
    calls = tmp_path / "calls.log"
    env = {"PATH": f"{bin_dir}:/usr/bin:/bin", "TRIVY_VERSION": "0.0.0", "NO_DOCKER": "true", "CALLS": str(calls)}

    subprocess.run(["bash", str(ROOT / "ci" / "trivy_scan.sh"), "pins.txt"], cwd=tmp_path, env=env, check=True)

    log = calls.read_text(encoding="utf-8").splitlines()
    assert log and all(line.startswith("trivy ") for line in log)
    assert f"--ignorefile {tmp_path}/.trivyignore.yaml" in log[-1]
