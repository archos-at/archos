"""How the workflows fit together, pinned by evaluating their own conditions.

Each test below is a rule CI used to break silently, because a skipped job
counts as passed and a workflow that runs nothing still reports green:

- a push diffed against the previous push, so a red commit's tier stopped
  running as soon as an unrelated commit landed on top of it;
- a reused pull request result counted on top of a red parent;
- images were tagged for a commit whose checks had failed, or not at all;
- the deploy ran for something other than a green push to develop.

The job conditions are evaluated, not string-matched, so a new job that forgets
the plan fails here instead of running on every merge (or never).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
import yaml

WORKFLOWS = Path(__file__).resolve().parents[1] / ".github" / "workflows"


def load(name: str) -> dict:
    data = yaml.safe_load((WORKFLOWS / name).read_text(encoding="utf-8"))
    # YAML 1.1 reads the bare key `on` as True.
    if True in data:
        data["on"] = data.pop(True)
    return data


class Ctx(dict):
    """An expression context: dotted access, and a falsy empty value for anything unset, like Actions."""

    def __getattr__(self, key):
        value = self.get(key, {})
        return Ctx(value) if isinstance(value, dict) else value

    __getitem__ = __getattr__


def evaluate(expression: str, **context) -> object:
    """Evaluate the small subset of Actions expressions these workflows use."""
    text = " ".join(str(expression).split())
    if text.startswith("${{"):
        text = text[3:-2]
    text = text.replace("&&", " and ").replace("||", " or ")
    text = re.sub(r"!(?!=)", " not ", text)
    # `steps.green.outputs.parent-is-green`: a hyphenated name is an index.
    text = re.sub(r"\.(\w+(?:-\w+)+)", r"['\1']", text)
    # `needs.*.result`: every needed job's result.
    text = text.replace("needs.*.result", "[job.result for job in needs.values()]")
    names = {key: Ctx(value) if isinstance(value, dict) else value for key, value in context.items()}
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
TIERS = ["backend", "workspace", "site", "infra", "packages", "sast", "hatchet", "skills"]
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
) -> dict:
    """The plan job's outputs, given what each of its scripts would answer."""
    github = {"event_name": event}
    steps: dict = {}
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


# Jobs that check the change. A reused push skips all of them.
CHECKS = [job for job in JOBS if job not in ("changes", "ci-ok", "publish", "image", "image-push")]
# The full Python suite, and the selection a pull request runs instead of it.
FULL_PY = ["backend", "backend-coverage", "backend-suites"]


# --- What a run diffs against ------------------------------------------------


def test_a_pull_request_diffs_its_whole_base_and_a_push_its_last_green_commit():
    base = STEPS["filter"]["with"]["base"]
    pins = STEPS["pins"]["env"]["BASE"]

    assert base == pins == "${{ github.event.pull_request.base.sha || steps.green.outputs.sha }}"


def test_no_workflow_diffs_against_the_previous_push():
    # `github.event.before` is the commit before THIS push: after a red commit,
    # or a dropped queued run, it hides a tier that still owes a run.
    for path in WORKFLOWS.glob("*.yml"):
        assert "github.event.before" not in path.read_text(encoding="utf-8"), path.name


def test_the_last_green_lookup_runs_on_push_and_may_not_fail_quietly():
    green = STEPS["green"]

    assert evaluate(green["if"], github={"event_name": "push"})
    assert not evaluate(green["if"], github={"event_name": "pull_request"})
    # Its script falls back to the root commit itself; a crash must be loud,
    # not an empty base.
    assert "continue-on-error" not in green
    assert green["run"] == "python3 ci/last_green.py"


# --- Concurrency -----------------------------------------------------------------


def test_a_branch_coalesces_its_pushes_and_a_pull_request_cancels_its_older_run():
    concurrency = CI["concurrency"]

    # One group per branch, not per commit: a queued push is replaced by the
    # newer one, which diffs against the last green commit and so covers it.
    assert "github.sha" not in concurrency["group"]
    assert "github.ref" in concurrency["group"] and "github.event_name" in concurrency["group"]
    # A running push is never cancelled, so a merge train cannot starve CI.
    assert concurrency["cancel-in-progress"] == "${{ github.event_name == 'pull_request' }}"


def test_closing_a_pull_request_cancels_its_ci_run():
    # Concurrency groups span workflows, so the cancel workflow cancels CI's
    # pull request run only while the two group names are the same string.
    cancel = load("ci-cancel.yml")

    assert cancel["concurrency"] == {"group": CI["concurrency"]["group"], "cancel-in-progress": True}
    assert cancel["on"]["pull_request"]["types"] == ["closed"]
    assert cancel["on"]["pull_request"]["branches"] == CI["on"]["pull_request"]["branches"]
    assert "closed" not in CI["on"]["pull_request"].get("types", [])


# --- Reusing a pull request's green result ----------------------------------------


def test_a_reused_push_skips_every_check_but_still_publishes():
    outputs = plan(event="push", parent_green=True, hit="true")

    assert outputs["reused"] == "true"
    assert {outputs[tier] for tier in TIERS} == {"false"}
    assert outputs["pins"] == "[]"
    assert [job for job in CHECKS if runs(job, event="push", outputs=outputs)] == []
    # The pull request built its images and pushed none, so the push must.
    assert runs("image-push", event="push", outputs=outputs)


def test_a_pull_request_result_counts_only_on_a_green_parent():
    # The PR run skipped every tier it did not touch. On a red parent those
    # tiers are exactly the ones that are broken.
    outputs = plan(event="push", parent_green=False, hit="true")

    assert outputs["reused"] == "false"
    assert [job for job in CHECKS if not runs(job, event="push", outputs=outputs) and job != "semgrep"] == [
        "backend-affected",
    ]


@pytest.mark.parametrize("hit", ["false", None])  # a miss, and a lookup step that failed
def test_a_miss_runs_every_check_the_filter_selects(hit):
    outputs = plan(event="push", parent_green=True, hit=hit)
    skipped = [job for job in CHECKS if not runs(job, event="push", outputs=outputs)]

    # Diff-aware SAST and the selected Python run have nothing to do on a
    # push: a push runs the full suite.
    assert skipped == ["semgrep", "backend-affected"]


def test_a_pull_request_runs_every_check_the_filter_selects():
    outputs = plan(event="pull_request")

    # No selection answer reads as full.
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
    # A selection against the whole pull request is sound only measured from
    # develop's database: from the pull request's own, a test reaching a file
    # an earlier push changed would not be selected again.
    outputs = plan(event="pull_request", py_mode="select", reference=reference)
    step = next(s for s in JOBS["backend-affected"]["steps"] if s.get("id") == "own-db")
    needs = {"changes": {"outputs": outputs}}

    assert bool(evaluate(step["if"], matrix={"suite": "api"}, needs=needs)) is own
    assert not evaluate(step["if"], matrix={"suite": "core", "shard": 1}, needs=needs)


def test_a_push_always_runs_the_full_python_suite():
    # Even if a selection answer leaked into a push plan, the push runs it all:
    # that is what catches a test a pull request's selection missed.
    outputs = plan(event="push", py_mode="select")

    assert all(runs(job, event="push", outputs=outputs) for job in FULL_PY)
    assert not runs("backend-affected", event="push", outputs=outputs)


def test_the_test_database_follows_every_develop_push_and_holds_nobody_up():
    # Not a job in CI: the staging deploy follows the CI run as a whole, so a
    # job there that checks nothing still held every deploy for its seven
    # minutes, and the next develop run queued behind it.
    testmon = load("testmon.yml")
    job = testmon["jobs"]["backend-testmon"]

    assert testmon["on"]["push"]["branches"] == ["develop"]
    # A merge that changes no Python cannot change which test runs which function.
    assert "**/*.py" in testmon["on"]["push"]["paths"] and "uv.lock" in testmon["on"]["push"]["paths"]
    assert "backend-testmon" not in JOBS
    assert not any("be:test:testmon" in json.dumps(other) for other in JOBS.values())
    assert testmon["concurrency"]["group"] != CI["concurrency"]["group"]
    # Saved by a step after the tests, so a red run saves nothing.
    steps = job["steps"]
    run = next(i for i, step in enumerate(steps) if step.get("run") == "task be:test:testmon")
    save = next(i for i, step in enumerate(steps) if step.get("uses", "").startswith("actions/cache/save"))
    assert save > run and "if" not in steps[save]
    # Under the key and path the pull request lanes restore.
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
    # Lint, types and tenant isolation are not selected: they always run.
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
    assert PLAN["permissions"] == {"contents": "read", "actions": "read", "packages": "read"}


def test_the_marker_is_uploaded_only_by_a_passing_pull_request_gate():
    steps = JOBS["ci-ok"]["steps"]
    check = next(i for i, step in enumerate(steps) if "Require needed jobs" in step.get("name", ""))
    uploads = [i for i, step in enumerate(steps) if step.get("uses", "").startswith("actions/upload-artifact")]

    assert JOBS["ci-ok"]["if"] == "always()"
    # Every job gates the marker.
    assert set(JOBS["ci-ok"]["needs"]) == set(JOBS) - {"ci-ok"}
    assert len(uploads) == 1 and uploads[0] > check
    upload = steps[uploads[0]]
    # No status function: the implicit success() keeps a failed check from uploading.
    assert not re.search(r"always\(\)|failure\(\)|cancelled\(\)", upload["if"])
    assert "github.event_name == 'pull_request'" in upload["if"]
    assert upload["with"]["name"] == "ci-green-${{ steps.tree.outputs.tree }}"
    assert int(upload["with"]["retention-days"]) <= 7
    for other in WORKFLOWS.glob("*.yml"):
        if other.name != "ci.yml":
            assert "ci-green-" not in other.read_text(encoding="utf-8")


# --- Images ------------------------------------------------------------------------


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
    # And the gate waits for it, so a green push run means tagged images.
    assert "publish" in JOBS["ci-ok"]["needs"]


# --- The Hatchet engine -------------------------------------------------------------


def test_the_engine_suites_run_on_the_engine_production_runs():
    # The engine tests prove the SDK against one engine; a CI pin that drifts
    # from production's proves it against another.
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
    assert JOBS["hatchet"]["if"] == "needs.changes.outputs.hatchet == 'true'"
    assert not runs("hatchet", event="pull_request", outputs=plan(event="pull_request") | {"hatchet": "false"})


# --- Release notes ------------------------------------------------------------------


def test_a_push_lints_its_release_notes_and_a_pull_request_must_add_one():
    steps = JOBS["release-notes"]["steps"]
    lint = next(step for step in steps if step.get("name") == "Release notes (lint)")
    require = next(step for step in steps if "require_release_note.py" in step.get("run", ""))

    assert "if" not in lint
    # The house rules on every run; reno's history-walking lint whenever the
    # notes, reno's config or its pin change, and on every push.
    assert "task release:lint:house" in lint["run"]
    assert "task release:lint\n" in lint["run"]
    assert "releasenotes/ Taskfile.yml taskfiles/repo.yml" in lint["run"]
    assert evaluate(require["if"], github={"event_name": "pull_request"})
    assert not evaluate(require["if"], github={"event_name": "push"})
    # The label is read live, so labelling and re-running is enough.
    assert "labels.*.name" not in require["if"]
    assert "no-release-note" in require["run"]


@pytest.mark.parametrize("job", ["repo", "release-notes"])
def test_a_pull_requests_repo_checks_fetch_only_down_to_the_merge_base(job):
    """Full history was ~75 s of every PR's critical path (docs/audit/blast-radius-2026-10.md §7)."""
    steps = JOBS[job]["steps"]
    checkout = steps[0]
    depth = checkout["with"]["fetch-depth"]
    assert evaluate(depth.removeprefix("${{").removesuffix("}}"), github={"event_name": "pull_request"}) == 1
    # A push's gitleaks scan reads its whole history.
    assert evaluate(depth.removeprefix("${{").removesuffix("}}"), github={"event_name": "push"}) == 0

    fetch = steps[1]
    assert evaluate(fetch["if"], github={"event_name": "pull_request"})
    assert 'ci/fetch_merge_base.sh "$BASE_SHA" "$HEAD_SHA"' in fetch["run"]
    assert ". ci/git_auth.sh" in fetch["run"]
    # Before every step that reads the merge base.
    readers = [
        i
        for i, step in enumerate(steps)
        if "require_release_note.py" in step.get("run", "") or "gitleaks" in step.get("run", "")
    ]
    assert readers and min(readers) > 1


def test_repo_checks_run_as_legs_side_by_side_and_all_gate():
    # One job ran them in series and finished last in 21 of 45 pull request runs.
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


def test_semgrep_finds_its_own_merge_base_from_a_shallow_clone():
    steps = JOBS["semgrep"]["steps"]
    checkout = steps[0]
    assert "fetch-depth" not in checkout.get("with", {})
    scan = next(step for step in steps if "semgrep ci" in step.get("run", ""))
    # The API lookup semgrep tries before deepening the clone.
    assert scan["env"]["GH_TOKEN"] == "${{ github.token }}"


# --- Security -----------------------------------------------------------------------


def test_the_pr_secret_scan_reads_only_the_history_under_test():
    # A full-depth checkout fetches every branch, and gitleaks scans `--all`
    # unless told otherwise, so one PR's fixture used to fail everyone's run.
    # A pull request reads the commits it adds; a push its own history.
    scan = next(step for step in JOBS["repo"]["steps"] if "gitleaks" in step.get("run", ""))

    assert scan["env"]["BASE_SHA"] == "${{ github.event.pull_request.base.sha }}"
    assert 'range="$BASE_SHA..HEAD"' in scan["run"]
    assert 'range="--full-history HEAD"' in scan["run"]
    assert '--log-opts="$range"' in scan["run"]


def test_security_is_surveillance_and_the_gate_lives_in_ci():
    triggers = set(load("security.yml")["on"])

    assert triggers == {"schedule", "workflow_dispatch"}
    assert "gitleaks" in json.dumps(JOBS["repo"])
    assert JOBS["semgrep"]["container"]["image"].split(":")[1][0].isdigit()  # pinned


# --- Deploy -------------------------------------------------------------------------

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
        # A pull request whose head branch is called `develop` passes the
        # `branches` filter; it must not reach a job holding stack credentials.
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
    # GitHub's default is 360 minutes. Runner slots are capped, so one hung job
    # holds a slot for six hours while every queued run waits behind it.
    jobs = load(workflow)["jobs"]
    missing = [name for name, job in jobs.items() if "uses" not in job and "timeout-minutes" not in job]
    assert not missing, f"{workflow}: no timeout-minutes on {missing}"


def test_every_action_is_pinned_to_a_commit():
    # A tag can be moved to other code after review; tj-actions/changed-files
    # was, in March 2025, and leaked the secrets of every workflow using it.
    # Dependabot (github-actions ecosystem) bumps the SHA and the comment.
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

    # What ran before is read before the apply changes it.
    assert _step_index(steps, "Remember what is running") < up
    smoke = steps[_step_index(steps, "Smoke check")]
    assert _step_index(steps, "Smoke check") > up
    assert "continue-on-error" not in smoke
    assert '"$SMOKE_CHECK"' in smoke["run"]
    # Inline, so an older checkout cannot lack it (docs/contributing/gotchas.md).
    # The frontend's liveness route, and the backend's health behind it.
    assert "for path in /api/healthz /api/health;" in DEPLOY["env"]["SMOKE_CHECK"]
    rollback = steps[_step_index(steps, "How to roll this back")]
    assert rollback["if"].startswith("${{ always()")
    assert "gh workflow run deploy.yml" in rollback["run"]


def test_production_always_deploys_the_prod_branchs_program():
    # A dispatch checked out the ref it ran from, so `target=both` from develop
    # applied develop's program to production.
    job = DEPLOY["jobs"]["deploy-prod"]
    checkout = next(step for step in job["steps"] if step.get("uses", "").startswith("actions/checkout"))

    ref = checkout["with"]["ref"]
    # A push applies the pushed commit, not prod's tip at approval time.
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
    assert "vector-store-floor.sh" in steps[verify]["run"]
    validate = steps[_step_index(steps, "Validate plan (CRD schemas + policy pack)")]
    # A per-service ref would override the rollback tag for that service.
    assert all(key in validate["run"] for key in ("backendImage", "frontendImage", "webImage"))
    for name in ("Validate plan (CRD schemas + policy pack)", "Pulumi up"):
        index = _step_index(steps, name)
        assert index > verify
        # An unqualified key is the project's own: the stack file's imageTag.
        assert 'pulumi config set imageTag "$ROLLBACK_TAG"' in steps[index]["run"]


def test_a_pull_request_must_not_take_away_what_a_rollback_reads():
    step = next(s for s in JOBS["release-notes"]["steps"] if "migration_contract.py" in s.get("run", ""))

    assert evaluate(step["if"], github={"event_name": "pull_request"})
    assert not evaluate(step["if"], github={"event_name": "push"})
    # Read live, like no-release-note: label, then re-run the job.
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
    # The same program, not only the same images: an operator rollback leaves
    # this commit's images under a newer program.
    assert '"$program" = "$DEPLOY_SHA"' in steps[skip]["run"]
    assert 'pulumi stack tag set deployed-commit "$DEPLOY_SHA"' in steps[_step_index(steps, "Pulumi up")]["run"]
    # A skipped apply is still checked from outside.
    assert "if" not in steps[_step_index(steps, "Smoke check")]


@pytest.mark.parametrize(
    ("workflow", "variable"), [("ci.yml", "CI_RUNNER"), ("testmon.yml", "CI_RUNNER"), ("deploy.yml", "DEPLOY_RUNNER")]
)
def test_the_runner_is_one_repository_variable_away_from_self_hosted(workflow, variable):
    # Moving to Actions Runner Controller is a variable, not an edit per job;
    # deploys get their own, so they need not run inside the cluster they change.
    for name, job in load(workflow)["jobs"].items():
        assert job["runs-on"] == f"${{{{ vars.{variable} || 'ubuntu-latest' }}}}", name


# --- Source maps -------------------------------------------------------------------


def test_source_maps_are_uploaded_after_ci_by_a_workflow_nothing_waits_on():
    # Inside `next build` the upload was ~232 s of every frontend build, and a
    # job in ci.yml would hold the deploy, which follows the CI run as a whole.
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
    # A failed download of maps the run did export fails the job; only a run
    # that exported none is skipped.
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
    # `node-version: "22"` took whatever 22.x the runner image had cached; an
    # older image in the pool had one Astro refuses (run 41725318204).
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
    # A review comment cannot be filtered by body before a run starts, so each
    # bot inline comment left a skipped check behind.
    assert set(claude[True]) == {"issue_comment", "issues"}
    assert not (workflows / "claude-code-review.yml").exists()
