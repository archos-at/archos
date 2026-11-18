# Code runner runbook

Turning on the agent's `execute` tool (real Word, Excel, PowerPoint and PDF files, exact calculation)
on a stack, checking it works, and turning it off. What it is:
[`agent-code-execution.md`](../design/agent-code-execution.md); the service:
[`apps/code-runner/README.md`](../../apps/code-runner/README.md).

The switch is one stack line, `grid-oib:codeRunnerEnabled: "true"`. It deploys the `code-runner`
Deployment, Service, PDB, KEDA ScaledObject and the NetworkPolicy `code-runner-agent-only`, and sets
`CODE_RUNNER_URL` on the chat tier and `agent-worker`. Off, the tool answers "Code execution is not
available in this deployment" and the agent answers without files.

## 1. The image exists, and the cluster may pull it

Do this once, before any stack turns the runner on: a stack with the runner on and no `code-runner`
image fails its deploy (`resolve-image-refs.sh`: "no image in the last 200 develop commits").

1. Merge the code runner to `develop` with the flag still off. CI's push run builds `code-runner`
   and, once every check passed, tags it `sha-<commit>` like the other images. The first push creates
   the GHCR package `ghcr.io/archos-at/code-runner`.
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

## 2. Dev

1. A PR to `develop` adding the line beside the replica bounds in `deploy/pulumi/Pulumi.dev.yaml`:

   ```diff
   +  grid-oib:codeRunnerEnabled: "true"
      grid-oib:codeRunnerMinReplicas: "1"
      grid-oib:codeRunnerMaxReplicas: "3"
   ```

   `npm run preview` in `deploy/pulumi` (against the dev stack) shows the new resources and the
   `CODE_RUNNER_URL` env on the chat tier; nothing else changes.
2. Merge. The staging deploy pins `grid-oib:codeRunnerImage` to the commit's `sha-` tag and applies.
   The chat tier rolls, because its environment changed.
3. Watch:
   - `kubectl -n grid get deploy code-runner` and its pods: `Running`, ready `1/1`. `ImagePullBackOff`
     means step 1.2.
   - `kubectl -n grid get scaledobject code-runner`: `READY True`.
   - Health from a chat pod (the only pods the NetworkPolicy admits):
     `kubectl -n grid exec chat-0 -- python -c "import urllib.request; print(urllib.request.urlopen('http://code-runner:8080/health').read())"`
     answers `b'ok'` (`chat` is a StatefulSet).
   - `kubectl -n grid logs deploy/code-runner`: four slots started, no restarts. A JSON line
     `run stopped` with `reason: memory` is a run that passed the 768 MiB slot cap and was answered
     `status: error`; `slot exited while idle` is a workerd that died on its own and was restarted.
     A pod that keeps failing `/health` has fewer than half its slots ready.
4. A first run from the app: in a project chat, ask "Erstelle eine Excel-Tabelle mit drei Räumen und
   ihrer Summe und leg sie ins Projekt". Expect a kept `/drafts/….xlsx`, then a filed draft that opens
   in the viewer. In Langfuse the turn's `chat-turn` trace carries the tag `feature:execute`, an
   `execute.run` step with `status: ok`, and the `execute-status` and `execute-files-made` scores.
5. Watch for a day: `execute-status` scores of `unavailable` (their comment names `unreachable`,
   `busy` or `http_error`), runner pod restarts or OOM kills, and replicas sitting at the maximum.
   Alerts on these are not built yet.

## 3. Prod

1. A PR to `develop` adding the same line to `deploy/pulumi/Pulumi.prod.yaml`, beside the other
   `*Enabled` switches, in exactly this form (the prod deploy and **Promote to prod** read it with
   `sed`):

   ```yaml
     grid-oib:codeRunnerEnabled: "true"
   ```

   Prod keeps the default replicas, 2 to 10.
2. Run **Promote to prod** for a commit that carries the line. Its check, and the prod deploy's,
   verifies GHCR has `code-runner:sha-<commit>` whenever the line says `true`.
3. Merge the promotion PR; the prod deploy waits for the `production` reviewers. Then repeat the
   checks of dev step 3 and 4 on prod.

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
   The pod requests 500m CPU: if it stays `Pending` with `Insufficient cpu`, `kubectl describe nodes`
   shows what is free. Then:
   `kubectl -n grid get deploy browser-renderer` ready `1/1`; `kubectl -n grid logs deploy/browser-renderer`
   shows `"reason":"self-test"` and `browser renderer listening`; in a project chat, ask for "einen
   Ablaufplan Entwurf, Einreichung, Bewilligung als Diagramm und PDF". Expect a PDF and a PNG, and in
   the renderer's log one `browser session ended` per launch with `refused: 0` unless the page tried
   the network.
4. **Prod.** The same line in `Pulumi.prod.yaml`, in exactly this form, which the prod deploy and
   **Promote to prod** read with `sed` to check the image exists:

   ```yaml
     grid-oib:browserRendererEnabled: "true"
   ```

5. **Watch:** pod restarts, OOM kills (the limit is 1.5 GiB for two browsers), replicas at 3, and
   runs answering `busy`.

**Chrome security fixes.** The base image `ghcr.io/puppeteer/puppeteer` is pinned by digest in
`apps/browser-renderer/Dockerfile`. Dependabot opens a pull request for a new digest every Monday
once a release is seven days old, the repository's cooldown for every ecosystem. Merge it within the
week. When the Chrome release notes name a security fix rated High or Critical, do not wait for it:
bump the digest by hand the same day, after `task browser:test` passes. The build finds the new
Chrome by itself; the `node` and `oven/bun` build stages come in the same weekly pull requests. Between Puppeteer releases, check
monthly that the pinned Chrome is no more than one stable release behind.

**Off at once:** `kubectl -n grid annotate scaledobject browser-renderer autoscaling.keda.sh/paused-replicas="0"`;
runs that launch a browser then fail and the agent falls back to Typst. Undo with
`autoscaling.keda.sh/paused-replicas-`, and follow up with the stack change.
