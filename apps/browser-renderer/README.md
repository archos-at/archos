# Browser renderer: `apps/browser-renderer`

Headless Chromium for the code runner. A run of the agent's `execute` tool writes ordinary Puppeteer
(`import puppeteer from "@cloudflare/puppeteer"; puppeteer.launch(env.BROWSER)`) to turn HTML and CSS
into a PDF, render a Mermaid diagram, or take a screenshot. This service is the browser behind that
call: one fresh `chrome-headless-shell` process per run, reached over the DevTools protocol (CDP),
with no network at all. Why it exists and how it fits: [`agent-code-execution.md`](../../docs/design/agent-code-execution.md);
turning it on: [`code-runner-runbook.md`](../../docs/deployment/code-runner-runbook.md).

## Contract

| Call | Answer |
|---|---|
| `GET /health` | `200 ok`, once the self-test browser started with its sandbox |
| `POST /v1/devtools/browser` | `200 {sessionId}`: a new Chromium process with a new profile; `503 {error: "busy"}` when the pod runs `BROWSER_RENDERER_SESSIONS` already |
| WebSocket `/v1/devtools/browser/<sessionId>` | CDP, one JSON message per frame, through the guard below. One socket per session; closing it ends the session |
| `DELETE /v1/devtools/browser/<sessionId>` | ends the session |

The paths are the ones `@cloudflare/puppeteer` 2.x speaks to a Workers browser binding, so the code
runner's binding (`apps/code-runner/src/browser/`) only forwards them.

## What a session is

- **A process, not a tab.** Each session starts `chrome-headless-shell` with `--remote-debugging-pipe`
  (no debugging port exists) and `--user-data-dir` in a new directory under `BROWSER_RENDERER_WORK_DIR`.
  When the socket closes, the browser exits, the session passes 190 s, or no socket connects within
  10 s, the whole process group is killed with `SIGKILL` and the directory deleted. Nothing of one run
  survives into the next.
- **Chromium's sandbox stays on.** No `--no-sandbox`. Renderers run in their own user, PID and network
  namespaces under Chromium's seccomp-bpf filter (the container suite checks `Seccomp: 2` and the
  namespaces). The sandbox needs unprivileged user namespaces: the container runs with
  `seccompProfile: Unconfined` and every capability dropped (see the design doc). If the sandbox
  cannot start, Chromium refuses to run and the service exits at its self-test: it fails closed.
- **Limits:** 2 sessions per pod (`BROWSER_RENDERER_SESSIONS`), 10 pages per session, 190 s per
  session, 50 MiB of messages from the browser to the client per session (every byte counts, so with
  base64 a run's PDFs and screenshots stay under about 37 MB; past it the session ends), 72 MiB per
  CDP message.
- **Orphans are reaped.** The front runs under `tini` as PID 1, so the processes a killed Chromium
  leaves behind do not pile up as zombies (the container suite counts them).

## The guard (`src/cdp-guard.mjs`, `src/cdp-allowlist.mjs`)

Every command the client sends is checked before it reaches Chromium:

- **An allowlist of 42 CDP methods** (`src/cdp-allowlist.mjs`): exactly what `@cloudflare/puppeteer`
  sends for `setContent`, `pdf`, `screenshot`, `evaluate`, `waitForSelector`, the viewport and fonts,
  recorded from real runs, plus `Input.dispatchKeyEvent`, `dispatchMouseEvent`, `dispatchTouchEvent`
  and `insertText` for clicks and typing. `Browser.close` is answered by ending the session; `IO.read`
  and `IO.close` work only on the stream of a PDF this session printed. Every other method of the
  protocol is refused with a reason; the guard suite walks the whole protocol (`devtools-protocol`) to
  prove it. Drag and drop is refused in particular: `Input.dispatchDragEvent` can carry a file of the
  renderer into the page.
- **Navigation:** `Page.navigate` only to `about:blank` or a `data:` URL, `Target.createTarget` only
  to `about:blank`. A command whose parsed parameters name a `file:` URL anywhere, in any spelling, is
  refused, and what is forwarded is the parsed command serialised again, never the raw text.
- **Request interception** is the guard's own: at session start it attaches to the browser target and
  enables `Fetch` for every URL, so every request of every page, frame and worker pauses there. It
  fulfils `http://assets.local/mermaid.min.js` from the image and fails everything else
  (`BlockedByClient`). `data:` and `blob:` never reach the network stack. Downloads are denied at
  browser level, and a window a page opens is closed.
- **Behind it:** Chromium's proxy is a loopback server that answers 403 to everything (also for
  loopback addresses, `--proxy-bypass-list=<-loopback>`), host resolution maps every name to nothing,
  WebRTC may not use UDP outside the proxy, and the pod's NetworkPolicy denies all egress.

## Fonts and Mermaid

The house fonts come from Adobe's npm packages `source-sans` 3.52 and `source-code-pro` 2.42 (OFL-1.1,
their licences ship in the image) and are the fontconfig defaults for `sans-serif`, `system-ui` and
`monospace`. Mermaid 12.3 (MIT) is served to pages from the image only.

## Image

`Dockerfile` starts from the Puppeteer team's image `ghcr.io/puppeteer/puppeteer:25.16.0`, pinned by
digest, which holds Node and Chrome for Testing's `chrome-headless-shell` (156.0.8078.47 at this
digest), and adds the front (`src/`), `ws`, the assets and `tini`. The build links the one
`chrome-headless-shell` the base holds to `/app/chrome-headless-shell` and fails if it finds none or
two, so a new base needs no path change. The `node` and `oven/bun` build stages are pinned by digest
too. It runs as `pptruser` (10042). About 3.0 GB, nearly all of it the base. Dependabot proposes new
digests for all three weekly (`.github/dependabot.yml`, `docker` for this directory).

| Environment variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `9222`, `0.0.0.0` | where the front listens |
| `BROWSER_RENDERER_CHROME` | `/app/chrome-headless-shell`, linked at build | the `chrome-headless-shell` binary |
| `BROWSER_RENDERER_SESSIONS` | `2` | sessions per pod |
| `BROWSER_RENDERER_WORK_DIR` | `/tmp/browser-renderer` | profiles and the fontconfig cache; a memory `emptyDir` |

## Testing

```bash
task browser:install   # bun install --frozen-lockfile
task browser:test      # builds browser-renderer:test, then the guard suite and the container suite
```

The container suite (`test/renderer.test.mjs`) runs the image with the pod's hardening
(`test/container.mjs`: read-only root, tmpfs `/tmp`, all capabilities dropped, `no-new-privileges`,
non-root, an internal Docker network with no route out) and checks the sandbox, the pipe, the fonts,
Mermaid, each refused request, `file://`, downloads, windows, cleanup and `busy`. It needs Docker and,
on Ubuntu 23.10 or later, `kernel.apparmor_restrict_unprivileged_userns=0` (CI sets it). The code
runner's `test/browser.test.mjs` drives the same image from inside a run.

## Measured

Shared 4-core development container, 2026-11-18, through the code runner (wall time of `POST /run`):

| What | Time | Pod memory peak |
|---|---|---|
| Browser start with sandbox (self-test) | 190 to 340 ms | |
| One-page A4 report to PDF | 390 to 570 ms | 108 MiB |
| Mermaid flowchart to SVG, PNG and a .docx | 1.1 to 1.4 s | 191 MiB |
| Two Mermaid runs at once | 2.4 s | 329 MiB |
| Idle | | 33 MiB |
