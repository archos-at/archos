# CI: the north star, the measured baseline, and the slices

[`ci.md`](ci.md) is how the pipeline works today. This page is where it is
going and why, with the numbers each step was chosen by. Everything here was
measured from the Actions API on 2026-11-03 unless it says otherwise;
`ci/lead_time.py` (the **Lead time** workflow, weekly and on demand) is the meter
every later claim is checked against.

## The north star

You merge. Within five minutes your change is on staging, tested once, built
once, and the image that reaches production months later is the same bytes,
signed by the run that tested them. Develop is never red, because nothing lands
untested against the code it lands on. If a deploy breaks, the pipeline puts the
previous build back on its own, opens the incident and tells you which commit
and which migration stood in the way. Nobody waits on a check that duplicates
another, and the numbers that say so are on a page, every week.

The runners are self-hosted (Actions Runner Controller), so wall time is the
budget and runner-minutes are not: parallelism is cheap, and a job is removed
when it duplicates another or holds the critical path, not for its cost.

## Baseline (2026-10-28 to 11-03)

| | p50 | p90 | Source |
|---|---|---|---|
| Merge to staging | **17.5 min** | **82.3 min** | 60 develop pushes, `ci/lead_time.py` |
| of which waiting for CI (queued, or develop red) | 0.7 | 65.8 | |
| of which the CI push run | 10.7 | 16.0 | |
| of which the deploy | 5.7 | 10.5 | `pulumi up` alone 181 s median |
| Pull request push to green | 4.6 min | 6.9 min | 45 green PR runs |

Where the time went, and what made develop red:

- **The deploy waited for a job that checks nothing.** Deploy follows the CI
  run's `completed` event; the testmon job finished last, seven minutes after
  `CI OK`, and the next develop run queued behind it.
- **The frontend image was the push critical path** in 10 of 14 non-reused runs
  (median 536 s); 232 s of it was the PostHog source-map upload inside
  `next build`. A PR builds the image too but cannot push it, so the push builds
  it again.
- **Develop was red 3,252 minutes in a week**, and none of it from a semantic
  conflict between PRs. 2,657 minutes came from a test the PR's selection
  skipped (a Python test reading UI i18n, a Pulumi spec reading Python source),
  609 from checks only a push runs (trivy over every changed pin, gitleaks over
  the full history, the image push to a renamed registry owner), 388 from the
  runner's PostgreSQL changing under `ubuntu-latest`.
- **Repo checks were the PR critical path** in 21 of 45 runs: four tools in
  series. The PR frontend image build was in 18.
- **The push reused the PR's result** in only 8 of 32 runs: 14 misses because
  develop was red, 5 release-notes bot commits, 4 two-parent merge commits.

## What changed (pull request 1477)

| Change | Stage it shortens | Expected effect, to be measured |
|---|---|---|
| testmon in its own workflow, and only when Python changed | CI push run, queue behind it | reused merge: 8 min to ~1 min to `pulumi up`; no more 10-minute queue behind it |
| Source maps: injected offline in the build, uploaded after CI by `sourcemaps.yml` | frontend image build | −~230 s on every frontend-changing merge |
| Repo checks as three legs; the skill lockfile audit only when skills change | PR critical path | −~96 s on the 21/45 runs it led; −2 min on the 6/45 where apm stalled |
| Harness tests no longer run twice (shards `--ignore` them) | runner minutes | −526 tests per backend push |
| Changelog bot commits no longer fire the backend tier | CI push run on bot commits | −the backend lane, ~5–7 runner-minutes each |
| Deploy: blobless clone, skip a commit staging already runs, preview once | deploy | −25 s median clone (−414 s at worst), −3–4 min for each of the 19/78 duplicate deploys |
| Smoke check after every deploy, the rollback command in its summary, prod rollback by dispatch, prod always applies the `prod` program | recovery | rollback is one command; a dispatch can no longer apply develop's program to production |
| `ci/migration_contract.py`, label `migration:contract` | rollback safety | a migration that breaks a rollback is visible in its PR |
| No `[skip ci]` markers in PR text | develop | a marker can no longer skip the push run, its image tags and its deploy |
| `vars.CI_RUNNER`, `vars.DEPLOY_RUNNER` | runners | moving to Actions Runner Controller is a variable |
| `ci/lead_time.py` and the weekly **Lead time** workflow | all | the numbers above, every week |

Projected merge to staging at p50: about 1 min of CI for a reused merge plus
about 5 min of deploy, so roughly 6–7 minutes, against 17.5. The p90 is set by
red develop; the next slices are about that.

One cost moved the other way: a PR frontend build now emits and injects source
maps as a push build does, so both are the same build. Measure its effect on
the PR image job (median 242 s before) with the Lead time report.

## Next slices, ranked

Ranked by minutes off the critical path; runner cost is not a criterion
(self-hosted). "Plan" marks a dependency on the repository's GitHub plan once
it is private.

1. **Close the selection gaps that made develop red** (2,657 of 3,252 red
   minutes). A Python test that reads a TypeScript or i18n file, and a Pulumi
   spec that reads Python, must run when that file changes:
   `scripts/check_ci_filter_reads.py` already finds such reads for the path
   filters; teach `ci/pr_selection.py` the same map so a PR in select mode adds
   those tests. Cost: none extra. No plan dependency.
2. **Merge queue** (`merge_group`): the queue runs the push job set before the
   merge, and the push only tags and deploys. Catches the selection gaps and
   push-only checks before develop (~3,088 red minutes) and makes the push a
   reuse every time, so merge to staging is tag plus `pulumi up`. Needs `merge_group` in `ci.yml` and `pr.yml`, a `ci-release-<tree>`
   marker the push accepts, and `release-notes.yml` opening a PR instead of
   pushing. **Plan**: on a private repository the merge queue needs GitHub
   Enterprise Cloud.
3. **Build once, verified.** Today a same-repo PR can grant its own run
   `packages: write` and push bytes under the `inputs-<hash>` tag its merge
   will produce; `publish` would then tag them for deploy. Close it with a
   registry credential only a protected branch's environment holds (GHCR
   package access read-only for Actions, writes through a GitHub App token in an
   environment restricted to `develop` and `release/**`), then let the push
   adopt an image the queue built. Artifact attestations
   (`actions/attest-build-provenance`, verified before `publish`) are the
   stronger form. **Plan**: attestations on a private repository need
   Enterprise Cloud; the environment-token form does not.
4. **Deploy by digest**: `publish` asserts `sha-X` and `inputs-H` share a
   digest, the resolver pins `ref@sha256:…`, prod promotion pins digests. Fix
   `commit_of()` in `resolve-image-refs.sh` to strip `@…` first.
5. **Failure report in `CI OK`**: JUnit from every test step, one summary with
   the failing test ids and a one-line repro each, annotations an agent can read
   from the check run. Then flaky detection (re-run the failed ids once, record
   a pass as `flaky`, a tracked and time-boxed `ci/quarantine.json`, never a
   silent skip) and a retry of infrastructure failures only.
6. **Promotion bot**: after a green staging deploy has soaked (no error-rate
   rise in PostHog), keep one "Promote sha-X" PR to `prod` current, with the
   release notes, migrations and program diff since the last pin. A person
   merges it in a release window. A `DEPLOY_FREEZE` variable stops promotions,
   never rollbacks.
7. **Bounded automatic rollback**: on a red smoke check, re-apply the previous
   tag once (not for a rollback, not across a `migration:contract` PR), end
   red, open a `deploy-incident` issue. Prod only if change management allows
   it.
8. **DORA**: deployment frequency, lead time to prod, change failure rate and
   time to restore from Deployments, the incident issues and the runs API,
   beside `ci/lead_time.py`.
9. **Warm, persistent caches on the self-hosted runners.** A BuildKit that
   outlives the job removes the registry cache round trip from every image
   build (cache import plus a ~60 s `mode=max` export on the frontend), and
   keeps `.next/cache` for an incremental `next build`; a persistent venv and
   bun store remove most of the ~21 s each job spends on setup. Then larger
   runners for the two critical-path jobs (the frontend image, the UI shards)
   and more shards where a shard is the floor. Needs the ARC scale set; the
   workflows already read `CI_RUNNER`.
10. **Pin what drifts**: the runner image (or the PostgreSQL major the RLS suite
   installs), so a GitHub image update cannot turn develop red overnight.
11. **Staging rolls in parallel**: `chromaMigration` is still `true` on dev, so
    the API and chat tiers wait for the migrate Job (~80 s of the serial
    `pulumi up` chain); prod has it off. Turning it off is a stack config
    change after the Qdrant import is verified on staging.

Not adopted, with the reason: shorter readiness soaks on staging (staging is the
prod rehearsal); canary or blue-green (at one to two replicas a canary is half
the traffic, and both colours share one schema; PostHog feature flags separate
deploy from release for now, Argo Rollouts with a PostHog analysis is the star
once prod runs three or more replicas).

## Decisions only an owner can make

Repository settings and plan questions. None of them is a code change, and each
is on the critical path of something above.

| Decision | Why | Where |
|---|---|---|
| Make `CI OK` and `Conventional PR title` required checks | The `protect-develop` ruleset requires no status check: a red PR can merge, and the docs said otherwise | Settings → Rules → `protect-develop` |
| Squash merges only | 4 of 32 push runs missed reuse on two-parent merge commits, and their subjects break Conventional Commits on develop | the same ruleset, allowed merge methods |
| Turn off CodeQL default setup | It duplicates Semgrep, which replaced it; it holds 3 jobs per PR push and up to 447 s per develop push, and on a private repository it needs GitHub Advanced Security | Settings → Code security |
| One AI reviewer per PR | `claude-code-review.yml` and the CodeRabbit app both review every PR | the workflow, or the app's installation |
| GitHub plan once private | The merge queue and artifact attestations on a private repository need Enterprise Cloud; without it slices 2 and 3 take their plan-independent forms | billing |
| The ARC scale set | Set `CI_RUNNER` to it when it exists, and `DEPLOY_RUNNER` to runners outside the cluster they deploy to. Its runner image needs Docker, python3, jq, gh, curl and git, and persistent volumes for the caches in slice 9 | `vars.CI_RUNNER`, `vars.DEPLOY_RUNNER` |
| Turn `chromaMigration` off on dev | Unblocks parallel rollouts on staging (slice 11) once the Qdrant import is verified there | `deploy/pulumi/Pulumi.dev.yaml` |

## How to tell whether it worked

Run **Lead time** (Actions → Lead time → Run workflow, `days: 7`) a week after
each slice lands and compare with the baseline table. A slice that does not move
its stage gets reverted or explained here.
