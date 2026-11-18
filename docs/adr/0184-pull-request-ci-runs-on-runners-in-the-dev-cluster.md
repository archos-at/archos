---
status: proposed
date: 2026-11-18
decision-makers: engineering
consulted: platform owner
informed: everyone working in this repo
---

# CI runs on runners in the dev cluster, with no Docker and no credentials

Drafted as ADR-0119 on archos-at/archos#1114 (2026-10-20), which never merged; this is that
decision brought onto today's CI, with what the ci-shadow trial on the dev cluster
(2026-11-04 to 11-07, branch `tb/ci-shadow`) measured.

## Context and Problem Statement

Every CI job runs on GitHub's `ubuntu-latest`: about 6,700 job-minutes a day on 2026-11-18. A
full run on a push to `develop` is about 30 jobs and 55 to 65 runner-minutes; a light pull
request run is 7 to 14 jobs and about 15. The repository is public, so those minutes are free,
and that is also why runners in the dev cluster were put on hold on 2026-10-31: a pull request
from a fork would run its code inside the cluster that runs staging. Making the repository
private is under discussion, and on the organisation's GitHub Team plan a private repository's
minutes beyond 3,000 a month are billed: 6,700 a day is about 200,000 a month.

The hosted image also decides things nobody chose. Its PostgreSQL is Ubuntu's 16, production
runs CloudNativePG's 17, and `scripts/rls-test-db.sh` takes whatever server binaries it finds.

Every CI job runs the code of a pull request. The question is whether CI should run in the dev
cluster, and how, without that code reaching anything of ours.

## Decision Drivers

* A pull request's code must not reach staging's data, the cluster API or a secret.
* Results stay in GitHub: checks, logs, re-runs and required status checks, where they are now.
* Staging comes first. Its four 4-vCPU app nodes were fully requested at idle before
  `cpuRequestScale` (#1813); a runner must never take a staging pod's place.
* Turning it off is one change, because the day the dev cluster is down CI must still run.
* The toolchain CI tests with is production's, and a test notices when it drifts.

## Considered Options

* GitHub's runners as they are
* A managed runner provider (Blacksmith, Namespace, Ubicloud)
* actions-runner-controller in the dev cluster, Docker-in-Docker mode
* actions-runner-controller in the dev cluster, Kubernetes (container hooks) mode
* actions-runner-controller in the dev cluster, plain mode, with the jobs that move made
  Docker-free

## Decision Outcome

Chosen option: "actions-runner-controller in the dev cluster, plain mode", because it keeps
GitHub as the place results live, takes the pull request minutes off the bill, and needs
neither a privileged pod nor a Kubernetes credential where a pull request's code runs.

* **The controller and one runner scale set**, GitHub's own charts at one pinned version,
  installed by the Pulumi program when `ciRunnersEnabled` is set
  (`deploy/pulumi/src/platform/ci-runners.ts`). The scale set registers with a GitHub App,
  scales from zero to `ciRunnersMaxRunners`, and its name (`dev-cluster`) is what `runs-on`
  names.
* **Plain mode.** No Docker daemon, no container hooks. The runner pod has no service-account
  token, runs as a non-root user, drops every capability and cannot escalate. Its namespace,
  `arc-runners`, enforces the Baseline Pod Security Standard.
* **Staging first.** The runners' PriorityClass is below every other pod's and never preempts:
  a staging pod that needs the room evicts a runner, and a runner waits for room. They request
  250m CPU and use up to 3, and run on their own worker group when `ciRunnersNodeGroup` is set.
* **A NetworkPolicy** that lets the runners reach the internet and cluster DNS and nothing
  else: no RFC 1918, CGNAT, link-local or loopback address, so not Postgres, not SeaweedFS,
  not Qdrant, not the metadata endpoint. Nothing may connect to a runner. The program refuses
  to plan the runners without `networkPolicies`.
* **Off the node disks.** Each runner works on its own ephemeral volume of
  `ciRunnersScratchStorageClass`, gone with the pod, under `eatmydata`. In the trial one synced
  write took 22 to 651 ms on staging's node disks and 0.6 ms on such a volume, and the synced
  writes timed the Postgres suite out.
* **A runner image of our own**, `deploy/ci-runner/Dockerfile`: GitHub's runner image plus
  production's Postgres server binaries, Qdrant, gitleaks, trivy and Semgrep as binaries,
  Chromium's system libraries, `gh`, and Python, Node, task and Bun where the setup steps look
  before downloading. `tests/test_ci_toolchain_pins.py` holds each version to the one CI and
  production use. It is built by `ci-runner-image.yml` on a pull request that changes it and
  pushed when that workflow is dispatched on `develop`; the scale set runs it by digest only.
* **One switch.** A job that may run on the cluster says
  `runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}`, and with the repository variable set it
  starts Qdrant from its binary (`scripts/qdrant-test-server.sh`) and runs the scanners from
  the image instead of from containers. With the variable unset every job runs as before.
* **What stays on GitHub's runners:** every job that holds a secret or can write the registry
  (`image-push`, `publish`, the source-map upload, `deploy.yml`, the runner image's own push),
  and every job that needs a Docker daemon or root: the image builds, the Hatchet engine
  tests (`hatchet-lite` in a container) and the standalone packages (the browser renderer's
  hardened-container suite and its `sysctl`). `tests/test_ci_workflows.py` fails when one of
  them could land on the cluster.

### Consequences

* Good, because pull request jobs stop spending hosted minutes, and an outage of those minutes
  no longer stops merges.
* Good, because the RLS and claim-queue suites run on production's Postgres major on the
  cluster, and the pins test fails when the image's Qdrant, Postgres, scanners or toolchains
  move away from production's or CI's.
* Good, because developers get the Qdrant command CI uses, with no Docker.
* Bad, because the dev cluster now carries CI's load, and it has little to spare: up to
  `maxRunners` pods of 4 GiB requested each. Three runners, the trial's number, turn a full run
  of about 45 movable runner-minutes into at least 20 minutes of wall time; matching today's
  wall time needs a worker group of its own (`ciRunnersNodeGroup`), about 24 vCPU for eight
  runners.
* Bad, because an evicted runner's job fails, after GitHub's ten-minute timeout for a lost
  runner. Re-running it is the remedy; staging keeps its room.
* Bad, because a runner can still reach the internet. A pull request can exfiltrate what it
  can read, which is its own checkout and its read-only token, the same as on GitHub's runners.
* Bad, because on a public repository a fork's pull request can name the scale set in its own
  copy of a workflow, and only the approval GitHub asks for outside contributors stands
  between its code and the cluster. The runners are switched on only once the repository is
  private.
* Bad, because Docker Hub rate-limits by IP and every runner shares the cluster's egress
  addresses. A pull-through mirror is the remedy when pulls start failing.
* Bad, because GitHub's runners keep running Postgres 16 until a setup step installs 17 there
  too, so the two runner kinds test the RLS suite on different majors.
* Bad, because we now own an image and a controller upgrade: the runner image when GitHub's
  runner moves (old runner versions stop being accepted), and the ARC charts.

### Confirmation

* `deploy/pulumi/src/platform/ci-runners.spec.ts`: plain mode, no service-account token, no
  privilege, the PriorityClass that never preempts, the egress rule, the deny-all ingress,
  Baseline namespaces, a digest-pinned image, both charts at one version, and the config
  refusing to plan without NetworkPolicies, the GitHub App or a digest.
* `tests/test_ci_toolchain_pins.py`: the versions above.
* `tests/test_ci_workflows.py`, with the workflow change: a job that may run on `CI_RUNNER`
  reads no secret, cannot write, and asks for no service container, container job,
  `docker run`, `sudo` or image build once the variable is set.

## Pros and Cons of the Options

### GitHub's runners as they are

* Good, because there is nothing to run.
* Bad, because going private bills the minutes, and the Postgres drift stays.

### A managed runner provider

* Good, because it is the least work and nothing to operate.
* Bad, because it is still minutes on a bill, and the toolchain is still the provider's image.
* Neutral: the right fallback if operating the controller costs more than it saves. The
  `CI_RUNNER` switch takes a provider's label as easily as ours.

### ARC, Docker-in-Docker mode

* Good, because every job runs unchanged.
* Bad, because the Docker daemon is a privileged container in a pod running a pull request's
  code, on the cluster that runs staging.

### ARC, Kubernetes mode

* Good, because `services:` and `container:` keep working, each in a pod of its own.
* Bad, because the runner needs a service account that can create pods in its namespace.
* Bad, because a job's services land in a separate pod from its steps unless the job has a
  container of its own, so `localhost:6333` stops reaching Qdrant.

## More Information

**Rolling it out.** Each step is a person's, in this order:

1. Make the repository private (an organisation admin).
2. Dispatch `CI runner image` on `develop`; make the `ci-runner` package public (it carries no
   secret) or give the scale set a pull secret; set the digest from the run's summary as
   `grid-oib:ciRunnersImage` in `Pulumi.dev.yaml`.
3. Create a GitHub App on the organisation, installed on this repository, with Actions and
   Administration read/write. Set `ciRunnersGithubAppId`, `ciRunnersGithubAppInstallationId`
   and, as a secret, `ciRunnersGithubAppPrivateKey`. Optionally add a CI worker group and set
   `ciRunnersNodeGroup`.
4. Set `ciRunnersEnabled: true` and deploy dev. The scale set appears under Settings →
   Actions → Runners.
5. Set the repository variable `CI_RUNNER=dev-cluster`. Unset it to move back.

**Image builds, not moved.** A runner without a Docker daemon builds through a BuildKit
service, and every BuildKit release scanned on 2026-10-20 failed the trivy gate on fixable
HIGH findings. Rootless BuildKit also needs seccomp and AppArmor unconfined. Both are a call
for whoever owns the trivy policy.
