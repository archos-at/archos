# Code runner runbook

Turning on the agent's `execute` tool (real Word, Excel, PowerPoint and PDF files, exact calculation)
on a stack, checking it works, what its failures look like, and turning it off. What it is and how
its parts fit: [`agent-code-execution.md`](../design/agent-code-execution.md); the services:
[`apps/code-runner/README.md`](../../apps/code-runner/README.md),
[`apps/browser-renderer/README.md`](../../apps/browser-renderer/README.md).

The switch is one stack line, `grid-oib:codeRunnerEnabled: "true"`, in
`deploy/pulumi/Pulumi.<stack>.yaml`; that file is where to read whether a stack has it. It deploys the
`code-runner` Deployment, Service, PDB, KEDA ScaledObject and the NetworkPolicy
`code-runner-agent-only`, and sets `CODE_RUNNER_URL` on the chat tier and `agent-worker`. Off, the
tool answers "Code execution is not available in this deployment" and the agent answers without
files. The browser is a second switch on top of it ([The browser](#the-browser-puppeteer-in-a-run)).

## 1. The image exists, and the cluster may pull it

Once per image, before any stack turns it on: a stack with the runner on and no `code-runner` image
fails its deploy (`resolve-image-refs.sh`: "no image in the last 200 develop commits").

1. Merge the code to `develop` with the flag still off. CI's push run builds `code-runner` and, once
   every check passed, tags it `sha-<commit>` like the other images. The first push creates the GHCR
   package `ghcr.io/archos-at/code-runner`.
2. Open the package's settings (GitHub → archos-at → Packages → `code-runner` → Package settings):
   - **Manage Actions access** lists `archos-at/archos` with **Write**. A package first pushed by
     this repository's workflow gets that by itself. If the image job failed with
     `permission_denied: write_package` or `denied`, the package exists without the repository: add it
     here with Write and re-run the failed job.
   - **Inherit access from source repository** is on, and the visibility is private like the other
     images. The kubelet pulls with the stack's `registryUsername` / `registryPassword` (the
     registry pull Secret); that account must be able to read this package as it reads the others.
3. Check the tag exists, with any token that can read the org's packages:
   `docker manifest inspect ghcr.io/archos-at/code-runner:sha-<commit>`.

## 2. Turn it on for a stack

**Dev.** A PR to `develop` adding the line beside the replica bounds in `deploy/pulumi/Pulumi.dev.yaml`:

```yaml
  grid-oib:codeRunnerEnabled: "true"
  grid-oib:codeRunnerMinReplicas: "1"
  grid-oib:codeRunnerMaxReplicas: "3"
```

`npm run preview` in `deploy/pulumi` (against the dev stack) shows the new resources and the
`CODE_RUNNER_URL` env on the chat tier; nothing else changes. Merge. The staging deploy pins
`grid-oib:codeRunnerImage` to the commit's `sha-` tag and applies; the chat tier rolls, because its
environment changed. Then [check it](#3-check-it-works).

**Prod.**

1. A PR to `develop` adding the same line to `deploy/pulumi/Pulumi.prod.yaml`, beside the other
   `*Enabled` switches, in exactly this form (the prod deploy and **Promote to prod** read it with
   `sed`):

   ```yaml
     grid-oib:codeRunnerEnabled: "true"
   ```

   Prod keeps the default replicas, 2 to 10.
2. Run **Promote to prod** for a commit that carries the line. Its check, and the prod deploy's,
   verifies GHCR has `code-runner:sha-<commit>` whenever the line says `true`.
3. Merge the promotion PR; the prod deploy waits for the `production` reviewers. Then
   [check it](#3-check-it-works) on prod.

## 3. Check it works

Every command runs against the stack's namespace, `grid`.

1. **Pods.** `kubectl -n grid get deploy code-runner`: ready `1/1` or more, pods `Running`.
   `kubectl -n grid get scaledobject code-runner`: `READY True`.
2. **Health**, from a chat pod (the NetworkPolicy admits only the chat tier and `agent-worker`; `chat`
   is a StatefulSet, so `chat-0` exists):

   ```bash
   kubectl -n grid exec chat-0 -- python -c "import urllib.request; print(urllib.request.urlopen('http://code-runner:8080/health').read())"
   ```

   answers `b'ok'`, which means at least half the pod's slots are ready.
3. **A run**, from the same pod, without the agent:

   ```bash
   kubectl -n grid exec chat-0 -- python -c "import json, urllib.request as u; r = u.Request('http://code-runner:8080/run', json.dumps({'source': 'export default () => 6 * 7'}).encode(), {'content-type': 'application/json'}); print(u.urlopen(r).read())"
   ```

   answers `{"status":"ok","value":42,…}`.
4. **Logs.** `kubectl -n grid logs deploy/code-runner` shows `code runner listening` and no
   `slot exited while idle` or `slot restart failed` lines.
5. **From the app.** In a project chat, ask "Erstelle eine Excel-Tabelle mit drei Räumen und ihrer
   Summe und leg sie ins Projekt". Expect the file card for a `….xlsx`, then a filed draft that opens in
   the viewer. In Langfuse the turn's `chat-turn` trace carries the tag `feature:execute`, an
   `execute.run` step with `status: ok`, and the `execute-status` and `execute-files-made` scores.
6. **For a day.** `execute-status` scores of `unavailable` (their comment names `unreachable`, `busy`
   or `http_error`), runner pod restarts or OOM kills, and replicas sitting at the maximum. Alerts on
   these are not built yet.

## Known failures

| What you see | Why | Fix |
|---|---|---|
| Pods `ImagePullBackOff` | The cluster's pull account cannot read the GHCR package, or the tag does not exist | [Section 1](#1-the-image-exists-and-the-cluster-may-pull-it), steps 2 and 3 |
| Pod crash-loops at start: `TLS configuration: unexpected error: No CA certificates were loaded from the system`, then `workerd slot 0 did not become ready` | An image built without the system CA bundle, which workerd loads at start although a run has no network | The runner's `Dockerfile` installs `ca-certificates` and its build fails without the bundle, so deploy an image built from a commit that has it ([gotchas.md](../contributing/gotchas.md)) |
| `/health` answers `503` and the pod leaves the Service, then restarts after three failed liveness probes | Fewer than half its slots are ready: workerd processes keep dying | `kubectl -n grid logs deploy/code-runner` for `slot exited while idle` and `slot restart failed` with their error |
| `execute-status` `unavailable` with comment `busy`; the agent says nothing was run | Every slot of every pod was running a run past the tool's three retries, or every browser was in use | Replicas at `codeRunnerMaxReplicas` (or 3 browser pods): raise the maximum in the stack's file. Below it, KEDA has not scaled yet; `kubectl -n grid describe scaledobject code-runner` |
| `execute-status` `unavailable` with comment `unreachable` | No ready runner pod, or the NetworkPolicy does not admit the caller | Pods and health above; the caller must be the chat tier or `agent-worker` |
| A run answers `status: error` with `The run used more memory than allowed (768 MiB)`, the log `run stopped` with `reason: memory` | The run passed its slot's memory cap; the slot restarted and the others served on | The script's own doing, nothing to fix on the cluster. Many of them: [Memory per run](../../apps/code-runner/README.md#memory-per-run) |
| A run answers `status: timeout`, the log `run stopped` with `reason: timeout` | The run passed `timeoutMs` (60 s) plus the 10 s grace; its slot was killed and restarted | Nothing on the cluster |
| `browser-renderer` pod stays `Pending`, `Insufficient cpu` | No node has the pod's CPU request free | `kubectl describe nodes` for what is free; `grid-oib:cpuRequestScale` scales every CPU request of a stack |
| `browser-renderer` pod refused, `violates PodSecurity "baseline"` | A security context the namespace forbids, such as `seccompProfile: Unconfined` | Keep `containerSandboxSecurityContext()`; `index-pod-security.spec.ts` names the rule |
| Runs that launch a browser fail with `This runner has no browser` | `browserRendererEnabled` is off for the stack (`BROWSER_RENDERER_ADDR` unset on the runner) | Expected while it is off: the agent makes the PDF with Typst |

## Turning it off

- **For good, or on purpose:** set `grid-oib:codeRunnerEnabled: "false"` (or delete the line) in a PR
  to the stack's file. The deploy removes the runner and `CODE_RUNNER_URL`; files already filed stay in
  the projects, files in working directories stay there.
- **At once, without a deploy:** pause the runner at zero replicas,
  `kubectl -n grid annotate scaledobject code-runner autoscaling.keda.sh/paused-replicas="0"`. KEDA
  scales the Deployment to zero and keeps it there; the tool answers "the code runner could not be
  reached" and the agent answers without files. Undo with
  `kubectl -n grid annotate scaledobject code-runner autoscaling.keda.sh/paused-replicas-`. Follow up
  with the stack change above, or the next deploy is still on.

## The browser (Puppeteer in a run)

The switch is `grid-oib:browserRendererEnabled: "true"`, beside `codeRunnerEnabled` (the program
refuses it without the runner). It deploys the `browser-renderer` Deployment, Service, KEDA
ScaledObject (1 to 3 pods) and the NetworkPolicy `browser-renderer-code-runner-only`, opens the code
runner's egress to it on 9222, and sets `BROWSER_RENDERER_ADDR` on the code runner. No PDB: a single
replica never blocks a node drain. Off, a run that launches a browser fails with "This runner has no
browser" and the `office-html-pdf` skill sends the agent to Typst.

1. **The image.** As for the code runner (section 1): merge with the flag off, let CI publish
   `ghcr.io/archos-at/browser-renderer:sha-<commit>`, give the package the repository's Write access
   and private visibility, check the tag with `docker manifest inspect`.
2. **The sandbox.** Chromium runs `--no-sandbox`; the container is the sandbox (why:
   [threat model](../design/agent-code-execution.md#threat-model)). The container runs as 10042 with
   `seccompProfile: RuntimeDefault`, every capability dropped and a read-only root (declared in
   `deploy/pulumi/src/app/browser-renderer.ts`), which Pod Security `baseline` admits, and needs
   nothing from the nodes. `index-pod-security.spec.ts` checks every pod the program creates against
   its namespace's level. Never set `Unconfined`: `grid` refuses the pod and `pulumi up` hangs on the
   rollout.
3. **Dev.** `grid-oib:browserRendererEnabled: "true"` is in `Pulumi.dev.yaml`. Before merging a change
   to it, check `npm run preview` lists only the resources above and the env change on `code-runner`.
   The pod requests 500m CPU, times the stack's `grid-oib:cpuRequestScale` where that is set: if it stays `Pending` with `Insufficient cpu`, `kubectl describe nodes`
   shows what is free. Then:
   `kubectl -n grid get deploy browser-renderer` ready `1/1`; `kubectl -n grid logs deploy/browser-renderer`
   shows `"reason":"self-test"` and `browser renderer listening`. Health from a runner pod, the only
   pod its NetworkPolicy admits, answers `ok`:

   ```bash
   kubectl -n grid exec deploy/code-runner -- node -e "fetch('http://browser-renderer:9222/health').then((r) => r.text()).then(console.log)"
   ```

   In a project chat, ask for "einen
   Ablaufplan Entwurf, Einreichung, Bewilligung als Diagramm und PDF". Expect a PDF and a PNG, and in
   the renderer's log one `browser session ended` per launch with `refused: 0` unless the page tried
   the network.
4. **Prod.** The same line in `Pulumi.prod.yaml`, in exactly this form, which the prod deploy and
   **Promote to prod** read with `sed` to check the image exists:

   ```yaml
     grid-oib:browserRendererEnabled: "true"
   ```

6. **Watch:** pod restarts, OOM kills (the limit is 1.5 GiB for two browsers), replicas at 3, and
   runs answering `busy`.

**Chrome security fixes.** The base image `ghcr.io/puppeteer/puppeteer` is pinned by digest in
`apps/browser-renderer/Dockerfile`. Dependabot opens a pull request for a new digest every Monday
once a release is seven days old, the repository's cooldown for every ecosystem. Merge it within the
week. When the Chrome release notes name a security fix rated High or Critical, bump the digest by
hand the same day, after `task browser:test` passes. The build finds the new Chrome by itself; the
`node` and `oven/bun` build stages come in the same weekly pull requests. Between Puppeteer releases,
check monthly that the pinned Chrome is no more than one stable release behind.

**Off at once:** `kubectl -n grid annotate scaledobject browser-renderer autoscaling.keda.sh/paused-replicas="0"`;
runs that launch a browser then fail and the agent falls back to Typst. Undo with
`autoscaling.keda.sh/paused-replicas-`, and follow up with the stack change.
