# CI: what it is for, and how it decides what to run

This page is the design of the GitHub Actions setup. The workflow files carry
the details next to the code they explain; this is the map, and the reasons.
Where it is going, with the numbers: [ci-north-star.md](ci-north-star.md).

## What CI is for

| Job to do | When | Where | Gate? |
|---|---|---|---|
| Prove a pull request, applied to its base, keeps every check its change could break | every push to a PR | `ci.yml` | **Yes: `CI OK`**, meant as the one required status check. On 2026-11-03 the `protect-develop` ruleset required none, so a red pull request could merge: [ci-north-star.md](ci-north-star.md#decisions-only-an-owner-can-make) |
| Prove the merged result, build its images, tag them for the commit | every push to `develop` and `release/**` | `ci.yml` | It is what the deploy waits for |
| Put a green `develop` commit on staging | after a green push run of CI | `deploy.yml` | Staging only ever runs a commit CI passed |
| Put the pinned commit on production | push to `prod`, with reviewers | `deploy.yml` | The `production` environment's reviewers |
| Notice what turns red without a code change: new CVEs, a secret in history, external links, model drift, WorkOS drift | weekly | `security.yml`, `docs-links.yml`, `turn-shapes-live.yml`, `workos-drift.yml` | No. A red run is a finding to triage |
| PR hygiene: Conventional title, closing keywords, labels | PR events | `pr.yml` | The title check |
| Publish the changelog | merge touching `releasenotes/` | `release-notes.yml` | No |
| Merge Dependabot's minor and patch updates once `CI OK` passes | Dependabot pull requests | `dependabot-auto-merge.yml` | `CI OK`, through auto-merge ([setup](testing-and-verification.md)) |

Everything else (`claude.yml`, `labels.yml`) is assistance, not verification. Pull requests are reviewed by the CodeRabbit app; the `claude-code-review.yml` workflow that reviewed them a second time was removed on 2026-11-04.

## How a CI run decides what to run

The `changes` job (named **Plan**) answers three questions before any check
starts, and every other job reads its answers.

**1. What did this change touch?** `dorny/paths-filter` over
[`.github/filters.yml`](../../.github/filters.yml), against a base:

- a pull request diffs against its base branch, the whole PR on every push;
- a push diffs against the **last commit CI passed on that branch**
  ([`ci/last_green.py`](../../ci/last_green.py)), never against the previous
  push. When there is no such commit, or the lookup fails, it diffs against the
  root commit and everything runs.

A skipped tier counts as passed, so a path no tier names is a path whose
change merges untested. [`tests/test_ci_filter_coverage.py`](../../tests/test_ci_filter_coverage.py)
fails on any tracked path outside every test tier unless its `UNFILTERED` list
says why no tier needs it; moving a directory without moving its filter line
turns Repo checks red. It matches with wcmatch and checks that against
picomatch, which is what `dorny/paths-filter` uses, wherever node is installed.

The second rule is what makes the rest safe. A push that diffed only against
its parent let a red commit's tier stop running as soon as an unrelated commit
landed on top of it, and the deploy shipped the broken code under a green run.

**2. Was this exact tree already tested?** A squash merge onto a `develop` that
did not move lands the tree the PR's last run tested. If that run was green
*and* the pushed commit's parent is the last green commit, every check skips
([`ci/reuse_green_run.py`](../../ci/reuse_green_run.py)). The parent condition
matters: a PR run that skipped the backend because it did not touch it proves
nothing about a backend that was already red on `develop`.

**3. Which images does this run build?** Each image is named by a hash of the
files its Dockerfile copies, plus the ISO week
([`ci/image_inputs.py`](../../ci/image_inputs.py)). A PR builds the images
whose hash its change moves, and pushes nothing. A push builds the images GHCR
does not have yet under `inputs-<hash>`, and re-tags the rest. The week is in
the hash because base images (`node:22-slim`, `debian:bookworm-slim`) are
floating tags: every image is rebuilt at least weekly, so a patched base
reaches production without anyone asking.

It also lists the third-party image pins the change adds or moves
([`ci/pinned_images.py`](../../ci/pinned_images.py)), for trivy.

## The jobs

| Job | Runs when | What it does |
|---|---|---|
| Plan (`changes`) | always | the three answers above, written to the run summary with the reason for each |
| Repo checks, three legs side by side | unless reused | **lint, secrets** (`repo`): pre-commit on all files, ruff, gitleaks over the commits a PR adds (a push: its full history). **CI machinery tests** (`repo-tests`): `task be:test:harness`, the tests of `ci/`, the workflows and the release-note pipeline. **Release notes, skills, migrations** (`release-notes`): release-note lint and (PRs) the requirement, the agent-skill lockfile when the `skills` tier changed, and (PRs) the expand/contract check on added migrations (`ci/migration_contract.py`, label `migration:contract`). As one job they ran in series and finished last in 21 of 45 PR runs (2026-11-03) |
| SAST (`semgrep`) | PRs touching code | Semgrep, diff-aware: blocks findings the PR introduces |
| Backend affected tests (`backend-affected`) | PRs, backend tier, selection possible | per suite (core, agent_host, `sources`, the Python packages), only the tests the change reaches (`task be:test:affected`), plus the claim queues on Postgres |
| Backend core (`backend`) | backend tier: pushes, and PRs testmon cannot select for | the core suite in 4 shards (`task be:test:shard`), each writing coverage data |
| Backend coverage gate (`backend-coverage`) | backend tier | combines the shards' data, the 65% gate, the PR comment |
| Backend suites (`backend-suites`) | backend tier | three jobs side by side: the agent_host suite, the Python packages' suites (`sources`), and the migration test with the claim-queue suites on a real Postgres (`task be:test:postgres`) |
| Workspace (`workspace`) | workspace tier | card schema check, lint, types, and the tenant-isolation suite against a real Postgres |
| Workspace tests (`workspace-test`) | workspace tier; on a PR, unless nothing a UI spec reads changed | the vitest suite in 8 shards, split by recorded time (`tests/vitest-durations.json`, refreshed with `task workspace:test:durations`, read by `config/vitest/duration-sequencer.ts`); on a PR whose change a selection can see, only the specs it reaches (`task workspace:test:related`) |
| Workspace accessibility (`task workspace:a11y`) | not in CI yet: run it locally, a shard at a time | axe-core, WCAG 2.2 AA, over every `/dev` preview route except those still listed in `apps/workspace/scripts/a11y-pending-routes.json` (not yet audited; the list only shrinks), light and dark, 1440 and 390 (`task workspace:a11y -- --shard i/4`). The script starts `next dev` itself with placeholder WorkOS settings; fails on a violation not in `apps/workspace/scripts/a11y-baseline.json` and on an entry that is gone. The CI job follows in a separate PR: its first run (4 shards) failed shards 1, 3 and 4 while the same shards pass locally, so the baseline does not yet hold on the runner. On GitHub Actions the script writes each difference as an `::error` annotation, which the check-run API returns where job logs cannot be fetched |
| Workspace coverage | PRs, workspace tier | merges the shards' coverage into the PR comment. Not in `CI OK` |
| Website, Infra, Standalone packages | their tier | `task website:verify`; `task infra:types` + `infra:test`; `task pkg:test:*` |
| Hatchet engine tests (`hatchet`) | `hatchet` tier: the ingest, folder card and research Hatchet code, the BFF's jobs and scheduler, the SDK pins | starts `hatchet-lite` at production's tag and its Postgres, makes an API token in the container (`ci/hatchet_engine.sh`), and runs every suite that otherwise skips without an engine: `test_ingest_workflow_engine.py`, `test_folder_card_workflow_engine.py`, `test_research_workflow_engine.py` and each `bff/*/orchestrator.integration.spec.ts` over the RLS script's database. Fails when one of them ran no test or skipped one |
| Image vulns (`trivy`) | a pin added or moved | trivy on those pins |
| Image build (`image`) | PRs that change an image's inputs | builds it, read-only token, no push. For the UI this IS the production build check: `workspace:build` is not run separately |
| Image build + push (`image-push`) | pushes, image not in GHCR | builds and pushes `inputs-<hash>` and the layer cache |
| Tag images (`publish`) | pushes, after every check passed | `sha-<commit>` on all three images, and `latest` on `develop` |
| `CI OK` (`ci-ok`) | always | fails unless every needed job passed or was skipped; on a green PR, records the tested tree for reuse |

One more workflow runs on a push to `develop` and is not CI:
**Test database** (`testmon.yml`) records which test runs which code
(`task be:test:testmon`) and caches it when green, for `backend-affected` to
select from. It checks nothing, so it lives outside `ci.yml`: the staging deploy
follows the CI run's `completed` event, and as a job in CI it was the last to
finish. On 2026-11-03 a reused push had `CI OK` after one minute and its run
completed after eight, every minute of the difference this job, and the next
develop run queued behind it (a run created at 17:56 started at 18:06). A job
that "holds nobody up" belongs in CI only if nothing waits on the run as a
whole; the deploy does. It runs only when Python, a `pyproject.toml`, the lock
or its own harness changed: a docs or UI merge cannot change which test runs
which function, and the run is the full backend suite, seven runner-minutes.

The core shards (`task be:test:shard`) leave out the 17 files of
`be:test:harness` (the Taskfile variable `HARNESS_TESTS`), which the CI
machinery leg runs on every run that runs the shards. They used to run twice.

`task verify` runs the same checks locally, minus the image builds, the RLS
suite and `packages/` (see
[testing-and-verification.md](testing-and-verification.md)).

## Images and deploys

The contract, end to end:

1. A push builds content-addressed images (`inputs-<hash>`) beside its checks.
   An image tag of that kind claims nothing about any commit.
2. Only when every check on the push has passed does `publish` put
   `sha-<commit>` on **all three** images. A commit CI failed has no `sha-` tag.
3. `CI OK` needs `publish`, so a push run concludes `success` only with the
   tags in place.
4. `deploy.yml` runs on `workflow_run` of CI, for a successful **push** run of
   this repository on `develop`, and pins all three services to
   `sha-<commit>`. No polling, no per-service guessing.
5. A prod promotion pins any `develop` commit CI passed. All of them have all
   three images.

What this replaced, and why it had to go: Publish Images rebuilt each image
only when its own paths changed since the previous push, from two hand-written
path lists that disagreed with the Dockerfiles. On 2026-10-09 a merge train of
nine commits ran Publish Images nine times; seven runs were dropped as
superseded while queued, and the last one diffed only against its own parent,
a changelog commit. It built the web image. The frontend and backend changes of
five merged pull requests were never built, and staging kept running the old
images until someone dispatched a rebuild by hand.

`GIT_SHA` inside an image is the commit that *built* it. An image whose
inputs did not change is re-tagged, not rebuilt, so a container reports the
commit its code came from.

## PostHog releases and source maps

Error tracking and the self-driving inbox date a regression by asking which
commit an exception came from and when the cluster started running it. Three
pieces of CI answer that. All are off until the secret and variable below
exist, so a fork, a pull request and a repository without PostHog build and
deploy exactly as before.

| Piece | Where | What it does |
|---|---|---|
| Source maps and release | The frontend Docker build (inject, offline) and `.github/workflows/sourcemaps.yml` (upload, after CI) | The build emits maps and injects a chunk id into each shipped chunk; `image-push` exports the maps as an artifact; the Source maps workflow uploads them for release `workspace-ui` at the commit that built the image, the `GIT_SHA` the container reports |
| Backend release | `deploy.yml` (staging), before the plan (`PostHog/resolve-release`) | Finds or creates release `grid-agent` at the backend image's commit and hands its id to the Python tiers as `POSTHOG_RELEASE_ID` (below) |
| Deploy marker | `deploy.yml`, after each `Pulumi up` (`deploy/pulumi/scripts/posthog-annotate.sh`) | A project annotation `deploy dev <sha>` or `deploy prod <sha>` at the time the apply finished. `continue-on-error`: a PostHog outage never turns a deploy red |

| Name | Kind | Value |
|---|---|---|
| `POSTHOG_CLI_API_KEY` | secret | A personal API key with scopes `error_tracking:write`, `organization:read` and `annotation:write`, created at PostHog → Settings → User API keys. Repository-level; the Source maps workflow and the deploy jobs read it. The image build never does |
| `POSTHOG_PROJECT_ID` | variable | The numeric project id (269895 for the EU staging project). Not secret |
| `POSTHOG_CLI_HOST` | variable, optional | The PostHog **app** host. Default `https://eu.posthog.com`. Not the ingestion host `eu.i.posthog.com` |

Why it is built this way:

- **Inject inside the build, upload after CI.** The injection rewrites the files
  the image ships, so it runs in the Dockerfile's build RUN; a step after the
  build would inject into files the image never contained. The upload only
  reads the maps, so it does not belong there: done by `@posthog/nextjs-config`
  inside `next build`, it took ~232 s of every frontend build (4360 chunks,
  run 41688820888), on the path every deploy waited for. Now the build keeps
  maps and injected chunks in a `sourcemaps` stage, `image-push` exports it
  (`build-image`'s `export-sourcemaps`, seconds from the warm builder), and the
  Source maps workflow uploads it when CI completes, beside the deploy. It is a
  workflow of its own and not a job in `ci.yml` because the deploy follows the
  CI run as a whole.
- **No key in the build, so every build is the same build.** `posthog-cli
  sourcemap inject` without a release name contacts nobody; it only insists
  that credentials exist, and the Dockerfile gives it placeholders (measured on
  0.18.11: with `--release-*` it calls the API, without them it logs "injecting
  chunk ids only"). A pull request build therefore injects exactly as a push
  does, and an image no longer differs by whether its builder held the secret.
  The release is linked at upload (`--release-name workspace-ui --release-version
  <commit>`), so unmerged code still never creates one.
- **The maps are kept aside and not served.** Next serves `.next/static/**/*.map`,
  original source included, to anyone. `next.config.ts` turns browser and
  server maps on only for the image build (`EMIT_SOURCE_MAPS=1`); the RUN
  copies them out, deletes every `.map` under `.next/static` and `.next/server`
  with the `sourceMappingURL` comments that pointed at them, and fails if a map
  survives or a chunk carries no id. The `sourcemaps` stage sits before the
  runner, which stays the default target.
- **`symbol-set` release mode**, the CLI's default: the maps are bound to the
  release. The newer `event` mode injects a release id for posthog-js to send
  per event, which the pinned posthog-js is not known to read.
- **Why the release is a build commit.** An image whose inputs did not change is
  re-tagged, not rebuilt (above), and its run exports no maps: its chunks kept
  their ids, and PostHog has their maps from the build that made them. The
  deploy marker carries the commit that was deployed. Read the pair together:
  the release says where the code came from, the annotation says when users got
  it.
- **The release is `workspace-ui`**, named for what it is (ADR-0149); it was
  `grid-ui` until the upload moved out of the build, and releases made before
  then keep that name in PostHog.
- **Chunk ids are content-addressed** (UUIDv5 of the chunk), so a rebuild of
  unchanged files yields the same ids and a re-run cannot orphan an upload.
- The CLI is `@posthog/cli`, an exact devDependency of the workspace, and the
  Source maps workflow installs that same version (a test holds the two
  together). Its npm package downloads the binary on first use (`bun install
  --ignore-scripts` skips its postinstall), which happens inside the build RUN,
  and the same RUN deletes the binary: `bun install --production` over an
  existing `node_modules` does not prune devDependencies (measured with bun
  1.3.11), so the later production install would let it ship.

An image already in GHCR under its `inputs-<hash>` is not rebuilt when the
secret is added later, so its maps are never uploaded. Wait for the weekly
rebuild, or bump `SCHEME` in `ci/image_inputs.py`.

Python (`agent`) has no source maps; PostHog links its exceptions to a
release through `POSTHOG_RELEASE_ID`, which the SDK (`posthog>=7.59`) sends as
`$release_id`. The staging deploy runs
[`PostHog/resolve-release`](https://posthog.com/docs/error-tracking/link-releases/python)
before the plan, for release `grid-agent` at the commit the backend image was
built from (the sha in `BACKEND_IMAGE_REF`), and sets its `release-id` output as
the stack key `grid-oib:posthogReleaseId`; the program injects it as
`POSTHOG_RELEASE_ID` on every Python tier, beside `POSTHOG_HOST` and the token
and never without them. The image's commit rather than the deployed one, so a
re-deploy of the same image resolves the same release and the pods do not roll.
Without the secret the action outputs an empty id and the key is not set; the
step is `continue-on-error`, so PostHog never blocks a deploy. Prod is not
wired: its stack has no PostHog configured, so it would have nowhere to send
the id.

A check that guards the whole repository (a ratchet, a naming or brand
check, a doc-path check) runs in **Repo checks**, never inside a suite a path
filter selects. The brand-names check's test was first written into the
backend's core suite, which a UI-only or docs-only pull request never reaches,
so those got a green run that never asked it; it moved to `be:test:harness`,
which Repo checks runs on every pull request.

## Quick merges one after another

A branch has one concurrency group. A running push run is never cancelled; a
queued one is replaced when a newer push arrives. A train of nine merges
therefore costs the run in progress plus one more, and the survivor diffs
against the last green commit, so it covers every commit that was dropped. A
dropped run concludes `cancelled`, which the deploy reads as superseded.

A pull request's newer push cancels its older run, since every PR run diffs
the whole PR. Merging or closing a pull request cancels its run too
(`ci-cancel.yml` joins the same concurrency group): the squash merge's push run
tests the merged tree, and the PR run's slots go back to the queue.

What this does not give you is a test of each PR against the PR merged just
before it. GitHub's merge queue does that, by testing the merge group before it
lands; the push run here is what catches a semantic conflict after the fact,
and it does catch it before staging. Enabling the queue is a repository setting
(and for a private repository, a plan question); `ci.yml` would need a
`merge_group` trigger, and the reuse marker would then hit on every merge.

## Runner slots are the budget

The repository's runners are capped. Before this design, a full-stack PR push
started about 33 jobs across CI (19), Security (6), Docker Build (4), PR (3) and
CodeQL (3), and a merge train ran a full CI per commit. Measured on
2026-10-08/09 over 100 PR runs of CI: the median successful run took **43
minutes** from push to green (p90 53) for about five minutes of work. One run's
jobs sat queued for 20 to 29 minutes, and its three-second `CI OK` job waited
nine minutes for a runner.

So the rule is: work that shares a toolchain shares a job, unless splitting it
shortens the critical path. Lint, the release-note checks and gitleaks share the
Python job; tenant isolation rides with UI lint and types. Security scans that
cannot be caused by a change moved to the weekly run.

Splitting does shorten the critical path for the two test suites, and by
2026-10-19 the slots were no longer the constraint: in eleven runs measured
then, no job waited more than three seconds for a runner. So the backend core
suite runs in four shards and the UI suite in six (it had four, and they had
grown to 7 to 11 minutes each); see [The backend lane](#the-backend-lane).

GitHub's **CodeQL default setup**, which ran three analysis jobs on every PR
push and a five-to-ten minute analysis on every `develop` push beside Semgrep,
was turned off on 2026-11-04. The organization's security configuration had
enforced it ("Blocked by organization" on the repository's page), so it is
switched off in that configuration, under the organization's Settings →
Advanced Security → Configurations, not in the repository. Semgrep in `ci.yml`
is the SAST gate.

## Runners and cost

Every CI job runs on `${{ vars.CI_RUNNER || 'ubuntu-latest' }}`, every deploy
on `${{ vars.DEPLOY_RUNNER || 'ubuntu-latest' }}`. Moving to self-hosted runners
(Actions Runner Controller) is setting the variable to the scale set's name.
The runner image must carry what the hosted image gives these jobs for free:
Docker (service containers, buildx, gitleaks), python3, jq, gh, curl and git.
Deploys have their own variable because a runner inside the cluster it deploys
to dies with a rollout that takes the cluster down, halfway through
`pulumi up`. `tests/test_ci_workflows.py` fails a job that names a runner of
its own.

The runners are self-hosted, so the budget is wall time, not runner-minutes:
a job that shortens the critical path is worth its runner, a second runner for
a shard is cheap, and a job that duplicates another is removed because it
holds a slot and a person's attention, not because of its bill. Self-hosting
also allows what hosted runners cannot: warm caches that outlive a job (a
persistent BuildKit, the venv, bun's store, `.next/cache`). What that buys,
ranked: [ci-north-star.md](ci-north-star.md).

## The backend lane

Measured on 2026-10-19: CI runs took 13 to 15 minutes, and the one `backend`
job was 13 to 14 of them. It ran the core suite (7:30 to 8:00), then agent_host
(1:20), then the Python packages (`sources`, 3:30), in one job, while every other check was done by
minute three. Job-level queueing was under three seconds in every run looked at,
so the runner cap was not what made the run long; this one job was.

What it was made of, and what was done about each:

- **The core suite is CPU, spread thin.** ~410 worker-seconds on a 4-core
  sandbox, ~900 on a 2-vCPU runner. No test, import or fixture dominates
  (the slowest is 15s; collection is ~12s per worker; coverage on Python 3.14
  uses `sys.monitoring` and costs ~6%; `--dist` modes are within noise). The
  only lever is more CPUs, so it runs as four shards. `pytest-split` assigns
  tests by their recorded time in `tests/.test_durations`
  (`task be:test:durations` refreshes it); a test missing from the file counts
  at the average, so a stale file unbalances the shards and never drops a test.
  Each shard writes coverage data and `backend-coverage` combines it and
  applies the 65% gate, so the gate still sees the whole suite.
- **The shards drift apart when `tests/.test_durations` goes stale.** On
  2026-11-11 the file held 13,280 of 19,120 tests, some at times recorded under
  a slower machine, and the four test steps took 111 to 166 seconds in one run
  (121 to 169 and 120 to 158 in two others). Weighed with fresh times the old
  split was 41 to 64 units and the new one 52 each. `task be:test:durations`
  records every test and keeps only the tests of that run; it needs
  `QDRANT_TEST_URL`, because a test that skips is stored at the milliseconds
  its skip took. Run it when the shard times in a run differ by more than
  about 20 seconds.
- **What a shard is made of** (2026-11-11, 4 cores, a Qdrant server, no
  coverage; coverage adds 2 to 4%). Collection is about 20 s in every worker,
  of every shard, whatever share it then runs: about 8 s of imports
  (`hatchet_sdk` 1.3 s, `qdrant_client` 0.6 s, the agent runtime 0.5 s) and
  about 12 s of pytest building 19,120 items. Three tests each build the tool
  catalog in a fresh interpreter, 10 to 13 s apiece. A job spends about 30 s
  before pytest starts (containers 3 to 7 s, checkout 3 to 7 s, the venv 15 to
  24 s).
- **The end-to-end ingest tests were most of the core suite, and only with a
  Qdrant server.** Without one they skip, so a local run (84 to 99 s) hid
  them; with one the suite took 228 s. Two causes, both removed:
  `_release_memory` ran a full `gc.collect()` after every ingested file, about
  0.28 s in a suite process and two or three times per test in some 200 tests
  (stubbed for tests by `knowledge_layer_testing.ingest_fixtures`), and the
  service container kept Qdrant's storage on the container disk, where each
  of a collection's forty payload indexes is a sync (now `--tmpfs
  /qdrant/storage`). 228 s, then 144 s with the stub, then 104 s with both.
  Measure the suite with `QDRANT_TEST_URL` set, or the number is not CI's.
  The tmpfs has no size of its own, so it is the kernel's default, half the
  runner's memory (about 7.8 GiB on the 16 GB runner), and an empty test
  collection takes about 300 MiB of it. The testmon run, the whole core suite
  in one job, kept every test module's pair until its process exited, filled
  it at 27 collections, and failed every push to `develop` from 2026-11-11 to
  11-12 (`No space left on device: WAL buffer size exceeds available disk
  space`). The fixture now holds one module's pair per process.
- **The `sources` suite (the Python packages) is Qdrant collection setup.** About 130 tests each create and
  drop collections, and each collection was ~47 sequential payload-index
  calls. It runs in its own job beside the shards.
- **Most PRs ran the lane without touching backend code.** The backend filter
  listed `releasenotes/**`, `ci/**` and every workflow because ~10 seconds of
  tests read them, and most PRs carry a release note. Those tests now run in
  Repo checks as `task be:test:harness`, and the filter no longer lists them.
- **Plan's checkout fetched 1.1 GB.** Full history with every blob, ~29s on the
  job every other job waits for. It is now blobless (`filter: blob:none`,
  16 MB); the steps that read a file at the base fetch it on demand, with the
  job token handed to git through that step's env (`ci/git_auth.sh`) rather
  than written to `.git/config`.
- **Repo checks and SAST cloned the whole history**, ~75 s and ~72 s of every
  PR's critical path (`docs/audit/blast-radius-2026-10.md` §7). A pull
  request's Repo checks now start at depth 1 and `ci/fetch_merge_base.sh`
  deepens them only down to the merge base, which the release-note rule and
  gitleaks read; reno's own lint, which walks the whole history, runs only
  when the notes, reno's config or its pin change (`release:lint:house` is the
  rest). A push keeps the full clone. `semgrep ci` finds its merge base itself,
  from the GitHub API (`GH_TOKEN`) or by deepening the shallow clone.

**A pull request runs only the Python tests its change reaches.** Sharding
made the full suite ~5 minutes; a typical change reaches a few dozen tests.
Every push to `develop` that changes Python records, with pytest-testmon, which test executed which
function, one database per suite, and caches it when every test passed. A pull
request restores it and runs the tests whose recorded functions it changed,
plus every test file that names a changed non-Python file (a config, a prompt,
a schema), which coverage cannot connect to anything. The full sharded suite
and the 65% coverage gate run on every push to `develop`, which the deploy
waits for, so a test a selection missed turns `develop` red before staging,
not production. [`ci/pr_selection.py`](../../ci/pr_selection.py) decides, and
runs the full suite on a pull request whenever testmon cannot see the change:
a conftest, a Python fixture, the lockfile or a `pyproject.toml`, how the
backend jobs run, Python outside the tested packages (tests load `scripts/` and
`deploy/` by path or in a subprocess), package data or a fixture
no test names, or no recorded database. A data fixture under `tests/fixtures/`
adds the tests that name it or one of its directories, as tests read whole
fixture directories. A non-Python file that a helper or conftest reads (a
quoted name) runs the full suite, since nothing says which tests load it. Known blind spot: a test that only exercises
code in a subprocess is selected when its own file changes, not when the code
it spawns does; the push run is what catches that.

**The UI suite selects the same way, by import graph.** `vitest related`
keeps the specs whose imports reach a changed file, split over the same eight
shards. A spec that reads the tree from disk instead of importing it (the
route, key and migration walkers; ~120, found by what they call, not by a
list) has inputs no import graph sees, so it declares them in its first line,
`// @disk-inputs: src/app/api/**, ../../contracts/wire/v2/**` (globs relative to
`apps/workspace`), and runs when a changed path matches one, wherever in the
repository it is. `config/vitest/disk-inputs.ts` records what every declaring
spec reads while it runs and fails it on a path the line leaves out; `node
scripts/declare-disk-inputs.mjs <spec>` rewrites the line from a recorded run.
A spec that declares nothing runs on every selection, as all of them used to:
one that starts a process (the recorder cannot see the child's reads), one
that reads from a file list (over 60 inputs: `english-names.spec.ts`), and one
that read nothing in the recording run. Changes to what every spec loads (the manifest, the vitest config and
setup, the mocks the setup installs, tsconfig) run the whole suite. A median
squash commit that touches the UI still selected 815 of 1,644 specs, 86% of
the suite's time, in October 2026: half of them change a dictionary string,
which reaches ~720 specs, and the rest mostly touch a module behind
`lib/api/errors.ts` or the schema barrel. A leaf change reaches a handful.
`task workspace:blast-radius` holds each hub to the specs it reached when recorded;
the hubs, and the splits that would cut them, are in
[`docs/audit/blast-radius-2026-10.md`](../audit/blast-radius-2026-10.md). Coverage
is measured on the backend only (the 65% gate, total in the job summary); the
UI shards run without instrumentation, since nothing gates on UI coverage.

**What a later push to the same pull request re-runs.** Two references are
sound, and the Plan job takes the one that forces fewer full suites, then the
one with fewer files. One is the whole pull request against its base: a test
that reaches none of its files answers on the merge commit what it answers on
`develop`, whose own full run is the deploy gate. The other is the pull
request's last green run: the tests that ran passed, so the next push owes the
pull request's own diff since that run's head, plus every file the base branch
changed since an hour before that run started (the merge commit CI tests
carries both). The second wins while `develop` stands still. When it moved, the
hour of `develop` it adds (a median 83 files) used to force the full Python
suite on 90 of 113 re-runs, where the pull request's own diff forces it on 27.
The first holds only measured from `develop`'s testmon database, so when it
wins (`reference: base`) the api and sources suites restore that one instead
of their own. The backend keeps its testmon database per pull request for the
same reason, so tests that failed keep running until they pass. A push that
only answers a review comment runs the few tests that comment touched, and one
that touches nothing a UI spec reads runs no UI spec at all.

Not done, and why: a prebuilt container with the toolchain and venv baked in
saves ~28s of setup per backend job and costs 20 to 30s to pull and unpack on
a fresh runner, and it goes stale on every `uv.lock` change.

## What GitHub offers, and what we use

Checked against GitHub's feature set on 2026-10-09.

| Feature | Status | Why |
|---|---|---|
| Concurrency groups | Used | One group per PR and per branch; see above. Groups span workflows, which is how closing a PR cancels its run |
| `workflow_run` chaining | Used | Deploy follows a green CI push run, no polling |
| Job outputs, dynamic matrix | Used | The Plan job's answers; the image matrix is the plan's `build` list |
| Path filtering | Used, in a job | `on.paths` cannot skip a *required* check (it never reports), so the Plan job filters and every job skips through `if:` |
| Job timeouts | Used | Every job has one, a few times its measured run. The default is 360 minutes, and a hung job holds a capped slot for all of them. A test fails on a job without one |
| Annotations | Used | oxlint (`--format=github`), ruff (`--output-format=github`) and vitest (`github-actions` reporter) put findings on the PR's diff |
| Run summaries | Used | Plan's decisions, Semgrep findings, the deploy's URL and image refs |
| Environments, deployments | Used | `staging` and `production`, with the stack's `appUrl` as the deployment URL; production has required reviewers |
| Actions pinned by commit SHA | Used | A tag can be moved after review (tj-actions/changed-files, March 2025). Dependabot bumps the SHA and its version comment, workflows and composite actions both. A test and Semgrep's `github-actions-mutable-action-tag` rule refuse a tag |
| Job-scoped `GITHUB_TOKEN` permissions | Used | Read-only by default; only `image-push` and `publish` can write packages |
| Caching | Used where measured | pre-commit envs, uv, npm, Astro assets, trivy layers. Not `bun install`: 8 seconds cold, so a cache restore would buy nothing |
| Merge queue | **Not used: plan** | Would test each PR on top of the one merged before it. Needs the `merge_group` trigger and, for a private repository, GitHub Enterprise Cloud |
| Artifact attestations | **Not used: plan** | Signed provenance for the images. Private repositories need GitHub Enterprise Cloud |
| OIDC to Pulumi Cloud | **Not used: your setting** | Would replace the stored `PULUMI_ACCESS_TOKEN` with a short-lived token per job. [cd.md](../deployment/cd.md#3-github-environments-settings--environments) has the steps |
| Environment branch policies | **Your setting** | `staging` deploys only from `develop`, `production` only from `prod`, and the token is an environment secret, not a repository one. [cd.md](../deployment/cd.md#3-github-environments-settings--environments) |
| Larger or third-party runners | **Not used: cost** | The cap on runner slots is this design's main constraint. More slots, or faster ones, shorten every run; nothing in the workflows has to change for it |

## Repository settings this design expects

- Required status checks on `develop`: **`CI OK`** and **`Conventional PR
  title`**. Not `Security OK`: that job no longer exists, and a required check
  that never reports blocks every PR.
- The `staging` and `production` environments as in
  [cd.md](../deployment/cd.md).
- Optional: the secret `POSTHOG_CLI_API_KEY` and the variable
  `POSTHOG_PROJECT_ID` (`POSTHOG_CLI_HOST` to override the EU default), for
  source maps and deploy markers
  ([above](#posthog-releases-and-source-maps)).

## Changing CI

The surfaces are the workflows (`.github/workflows/`), the composite actions
(`.github/actions/`), the tier filter (`.github/filters.yml`), the scripts the
workflows run (`ci/`), the hooks (`.pre-commit-config.yaml`) and review routing
(`.github/CODEOWNERS`). Every one of them gates every pull request, so a change
that does not serve one of the jobs in the first table needs a reason.

- Every job has a `timeout-minutes` of a few times its measured run, and every
  action is pinned by commit SHA with a `# vX.Y.Z` comment. Both are tested.
- A new job takes its `if:` from a `changes` output, or it runs on every merge
  including the reused ones. [`tests/test_ci_workflows.py`](../../tests/test_ci_workflows.py)
  evaluates every job's condition and fails on one that does not skip.
- A new job that must pass before images are tagged goes into `publish`'s
  `needs` as well as `CI OK`'s; the same test checks that.
- A push diffs against the last green commit (`steps.green.outputs.sha`), never
  `github.event.before`: the previous push hides a red tier.
- Only `image-push` and `publish` write to GHCR, and only on a push. No pull
  request job gets `packages: write`.
- Image inputs come from the Dockerfiles' `COPY` lines
  ([`ci/image_inputs.py`](../../ci/image_inputs.py)). Do not hand-list paths.
- A finding the change did not cause (a new CVE in an untouched pin) belongs in
  the weekly run, not in a check that blocks every pull request.
- Make CI pass by fixing the cause. Widening the `.gitleaks.toml` allowlist,
  loosening auth gating or code-owner review is a design discussion first.
- A `CODEOWNERS` change goes with the paths it routes, or reviews go to the
  wrong people.

Verify a change before you push it:

```bash
actionlint                                  # go install github.com/rhysd/actionlint/cmd/actionlint@v1.7.7
.venv/bin/pre-commit run --files <changed>
.venv/bin/pytest tests/test_ci_workflows.py tests/test_reuse_green_run.py \
  tests/test_last_green.py tests/test_image_inputs.py tests/test_pinned_images.py \
  tests/test_plan_summary.py -q
```

`pre-commit` is not the whole gate: the backend suites run in the `backend` job,
not in a hook, so run `task be:verify` when you touch what they cover. Run the
job's own `task` too, and `bash -n` any `run:` block you edited. When a run
fails, read the job's log for the failing line rather than the summary, and
exercise an external call (a registry, an API) against the real service before
saying the fix works. Some paths only run after the merge, on a push; say
plainly which ones your change could not prove.
