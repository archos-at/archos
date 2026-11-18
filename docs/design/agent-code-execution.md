# The agent's `execute` tool: code in an isolate, nothing more

**Status:** implemented. A stack turns it on with `grid-oib:codeRunnerEnabled: "true"` and the
browser with `grid-oib:browserRendererEnabled: "true"`; `deploy/pulumi/Pulumi.<stack>.yaml` is
where each stack's switch lives (dev has the runner and no browser, prod neither). Without the
runner the tool stays bound and answers that code execution is not available; without the browser a
run's `puppeteer.launch` fails and the agent makes the PDF with Typst.

## The result

The chat agent has one tool, `execute`. It runs a short JavaScript (or TypeScript) module the agent
wrote, in a fresh V8 isolate with no network, and keeps the files the module wrote in the
conversation's working directory. From there `file_draft`, or the person with the card's
„Ins Projekt ablegen“, files a Word, Excel, PowerPoint, PDF, SVG or PNG file into the project as a
draft, checked and marked as made by AI.

So the agent computes instead of writing about computing: totals, ratios and comparisons come from
code that ran, and the office gets files it opens without explanation. Documents handed to a run are
processed in code, so only the findings reach the model, and so are the results of the agent's other
tools: a Raumbuch of 300 rooms is built from the model's own figures, not from figures the model
typed into the code.

## The parts

Start here; each row names the code and the page that owns its detail.

| Part | Code | Written down in |
|---|---|---|
| Tool: description, one run, status steps, trace | `packages/agent/src/agent/tools/execute/` (`register.py`, `run.py`, `runner_client.py`, `progress.py`, `trace.py`), bound to the chat agent in `configs/config_oib_openrouter.yml` | [One run](#one-run) below |
| Runner: workerd and `CodemodeBackend`, slots, limits, libraries | `apps/code-runner` | [its README](../../apps/code-runner/README.md), [the runner](#the-runner) below |
| Browser: Chromium for Puppeteer in a run | `apps/browser-renderer`, `apps/code-runner/src/browser/` | [its README](../../apps/browser-renderer/README.md), [the browser](#the-browser) below |
| Working directory: `/drafts/` to the model, `/workspace/` in a run | `packages/agent/src/agent/tools/documents/draft_store.py` | [Storage](#storage) below |
| Filing by the agent: `file_draft`, the output check, the AI marking | `apps/workspace/bff/documents/agent-file.ts`, `agent-file-check.ts`, `agent-file-marking.ts` | [Filing](#filing) below |
| The file in the chat: card, preview, download, the person's filing with folder and name, links in the answer | `apps/workspace/ui/features/cards/components/FileDraftCard.tsx`, `apps/workspace/app/api/conversations/[id]/draft/`, `apps/workspace/bff/conversations/draft-filing.ts`, `apps/workspace/ui/features/documents/save-to-project.ts`, `apps/workspace/ui/features/chat/lib/draft-links.ts` | [agent-made-files-ux.md](agent-made-files-ux.md) |
| The Herleitung: one row per file, in the office's words | `progress.py`, `apps/workspace/ui/features/chat/lib/file-work.ts`, `apps/workspace/ui/features/chat/components/reasoning/FileWorkList.tsx` | [In der Herleitung](agent-made-files-ux.md#in-der-herleitung) |
| How to write a file: the builtin skill collection `office`, offered, never required | `packages/agent/src/agent/skills/builtin/office/` | [The office skills](#the-office-skills) below |
| Deployment: Deployments, NetworkPolicies, KEDA, the stack switches | `deploy/pulumi/src/app/code-runner.ts`, `deploy/pulumi/src/app/browser-renderer.ts`, CI's images `code-runner` and `browser-renderer` | [code-runner-runbook.md](../deployment/code-runner-runbook.md): turning it on, checks, known failures |
| Observability: the `execute.run` step and four scores per run | `packages/agent/src/agent/tools/execute/trace.py` | [langfuse.md](../observability/langfuse.md) |
| Tests | `task runner:test`, `task browser:test`, `task runner:e2e` (CI's `packages` and `runner-e2e` jobs) | [the runner's README](../../apps/code-runner/README.md#running-and-testing), [ci.md](../contributing/ci.md#the-jobs) |

## One run

1. The model calls `execute(code, documents, data)`. The description says JavaScript module, no network,
   and "read the `office-files` skill first".
2. The tool takes the conversation's lock: one run at a time per conversation, so two calls in one
   response never write back from the same snapshot. Runs of different conversations run side by side.
3. It sends every file of the working directory (`/drafts/x` becomes `/workspace/x`) and the bytes of
   each named document (at most 10) under `/workspace/in/<file name>`. A document is resolved against
   the turn's inventory and read as the person, through the signed envelope; a base-corpus document is
   refused (read it with `read_file`). Together at most 50 MB. The file name is one path segment: a
   folder part is cut, an empty, `.` or `..` name becomes `document`, and a name already taken (by
   another document, or a working file under `/drafts/in/`) gets ` (2)`, ` (3)` before its extension
   (`unique_input_path` in `run.py`). A document named twice is sent once. The report's
   `documents read:` line names each document's path. Each tool result named in `data` (at most 10)
   goes in beside them, read-only, as JSON ([Tool results as data](#tool-results-as-data)).
4. The runner gives the run a free slot, a fresh Durable Object and a fresh isolate, runs the module
   with a 60 s limit (180 s maximum), and returns the module's value, stdout, stderr and only the files
   it created or changed under `/workspace/`.
5. The tool keeps those files in the working directory, except files under `/workspace/in/` and any
   that would take the conversation's files past 25 MB, and answers with the status, value, output and
   the files kept. An input the script changed, or a file it wrote under `/workspace/in/`, is dropped,
   and the report says so on a `not kept:` line. The agent may fix and run again, at most three times
   per file.

**What a document read leaves behind.** A named document is located through
`GET /api/internal/document-file` (`common/stored_file.py`), which checks the envelope's collection
scope and restricted-use clearance and answers only where the object is; the agent reads the bytes
from the object store itself. That read is **not** in the download log: the route is exempt in
`download-log/coverage-routes.spec.ts`, as every read the agent makes while answering is
([`download-log.md`](../user-guides/download-log.md), "Not recorded"). What it leaves is the
restricted-use record (`note_collections_read`, the collection only) and the `execute.run` step
(`documents_named`, `input_bytes`, never a name). A run differs from other agent reads in one way:
the script can copy an input's bytes into a working file, and that copy leaves through
`/draft/download` or `file_draft` without a row naming the original. The follow-up is in
[Decisions](#decisions).

A `503 busy` is retried three times with backoff; a runner that cannot be reached answers "nothing
was run", and the agent may try once more.

## Tool results as data

A tool whose answer is rows worth computing on keeps that answer whole and names it on the last line of
its text: `Data for execute: r3 (312 rooms, 41.2 KB). execute(data=["r3"]) reads every row of it
exactly, as JSON at /workspace/in/ifc_query-r3.json`. The model passes `data: ["r3"]`, and the run
reads `/workspace/in/ifc_query-r3.json` with `readFile`. The figures go from the tool to the script
without passing through the model, so a long list costs no tokens and cannot be mistyped, and the
text result can stay clipped (30 rooms per storey) while the file holds every row.

| Tool | Kept | Named in the Herleitung as |
|---|---|---|
| `ifc_query` | `schedule`, `elements`, `takeoff`, `aggregate`, `properties`, `compare`, `compliance`, `compliance-diff`, `profile`: the engine's whole result | „Raumdaten aus dem Modell“, „Bauteilliste …“, „Mengen …“, … (`tools/bim/handover.py`) |
| `ifc_measure` | every answer but `view` and `draw`: the engine's payload, and beside it `measurements`, the evidence values with provenance, method, unit, tolerance and the elements they were read from, as `measurement_sources.py` builds them | „Messwerte aus dem Modell“, „Raumdaten …“, „Bauteilliste …“ |
| `workspace__call` | `project-profile-get`, `project-get`, `project-overview-get`: the operation's structured answer | „Projektprofil“, „Projektdaten“, „Projektübersicht“ (`WORKSPACE_ABOUT`) |

A table in a document has no tool of its own: the document goes in through `documents` and the run
reads it (`unpdf`, `exceljs`, `papaparse`).

The file is `{reference, tool, operation, about, model, provenance, rows, result}`: `provenance` says
in a sentence what the values are (declared by the model's property sets, measured with a tolerance,
or as the workspace answered), so a script, and the file it writes, can state it. A measurement in
it is still not a source: it travels to the answer through `measurement_sources.py` as before.

**Kept for the conversation, not the turn.** Earlier turns' tool messages are in the next turn's
history, so the model can see `r3` there when the person says „mach daraus das Raumbuch“. A
`ContextVar` per turn would answer that with "unknown"; so a result is a row of the draft store's
LangGraph store under `("conversation", <id>, "tool-data")` (`tools/execute/tool_data.py`), beside
the working directory but not in it: it is not a file the person sees, files or downloads, and it
does not count against the 25 MB. References count up per conversation (`r1`, `r2`, …) under a
per-conversation lock, and only the latest 20 are kept; the agent host's drafts route deletes them
with the conversation. Erasure first writes an `erased` marker into the namespace and keeps it; a
tool still running then keeps nothing, because a write checks the marker before and after and removes
what it wrote when the conversation was erased meanwhile, whichever process it runs in. Deep research binds no `execute`, so a tool there keeps nothing and names
nothing (`current_step_scope() != "chat"`).

**Limits, said out loud.** A result over 8 MB is not kept, and the tool's text says so and asks
for a narrower query. A run takes at most 10 results; more is refused before anything runs. The
results count against the run's 50 MB of inputs. An unknown or dropped reference is refused with the
references the conversation holds and what to do: run the tool again and pass the reference it
names. The script's report has a `data read:` line; the Herleitung names each input in words under
„Grundlage:“ (the step's `documents`, with no document id), never the reference or the JSON.

**Files, not `input`.** The runner's contract has an `input` the default export receives. Files were
chosen instead: a run already reads its inputs from `/workspace/in/`, the read-only check and the
report's paths cover them unchanged, and a script reads several results by name rather than by
position in one argument.

## The runner

- **One workerd process per slot, 4 slots per pod** (`CODE_RUNNER_SLOTS`). Self-hosted workerd
  enforces no CPU limit on a loader isolate, and a synchronous loop stops its whole process (measured).
  So each slot holds one run, and a watchdog kills the slot's workerd at `timeoutMs` + 10 s, answers
  `timeout`, deletes the slot's storage and starts a new process. A looping run never delays another.
- **A fresh Durable Object per run** (`newUniqueId()`); `ctx.storage.deleteAll()` runs before the
  response leaves, and `bin/sweep.mjs` removes the emptied files every minute. The storage directory is
  a memory-backed `emptyDir`.
- **No network**: `globalOutbound: null` for the run, and the front worker's outbound allows nothing.
  The pod has no egress, no secrets and no service-account token; a NetworkPolicy admits only the chat
  tiers and `agent-worker`, and no other policy selects it (`code-runner.spec.ts` evaluates every
  selector against its labels).
- **The libraries** are a fixed manifest (`libraries.json`): docx, exceljs, pdf-lib, unpdf, pptxgenjs,
  vega with vega-lite and vega-interpreter, mathjs, decimal.js, papaparse, date-fns, jszip, marked,
  Forme, and Typst 0.14.2 as WebAssembly with its fonts and diagram packages (fletcher, timeliney,
  chronos, cetz under LGPL-3.0, shipped unmodified as source).
  Each is bundled ahead of time and handed only to runs whose source names it; nothing else can be
  imported. Admission rules: the README.
- **Deployment**: a plain Deployment, KEDA on CPU and memory, at least 2 replicas (dev 1 to 3), 250m CPU
  and 1 GiB requested (an idle pod uses a few millicores; dev's nodes had no full CPU free), 2 CPU and
  4 GiB limit: 4 slots at their 768 MiB memory cap and the front ([the budget](../../apps/code-runner/README.md#memory-per-run)).

## The browser

A run can drive headless Chromium with ordinary Puppeteer, written as Cloudflare documents it for
Workers: `import puppeteer from "@cloudflare/puppeteer"; puppeteer.launch(env.BROWSER)`. It turns HTML
and CSS into a designed PDF, renders Mermaid diagrams (which need a real DOM) and takes PNG
screenshots. The model writes Puppeteer fluently, which is why it is Puppeteer.

- **Where Chromium runs.** In its own Deployment `browser-renderer`, never in the code runner: one
  fresh `chrome-headless-shell` process per run, reached over a pipe, its profile in a memory volume
  deleted with it. A separate pod rather than a sidecar, so the browser's network namespace has nothing
  to reach (a sidecar shares the runner's loopback, where its HTTP front and workerd sockets listen),
  its NetworkPolicy can deny all egress and admit only the code runner, and Chromium's memory has its
  own limit and its own scaling (1 to 3 pods, 2 browsers each, then `busy`).
- **How the isolate reaches it.** The isolate stays `globalOutbound: null`. The library's entry builds
  `env.BROWSER` inside the isolate; its WebSocket is pumped through the host module `codemode:browser`,
  which runs in the run's Durable Object and holds the one real WebSocket to the renderer, through a
  service binding to the address Pulumi sets (`BROWSER_RENDERER_ADDR`, the Service's cluster IP). A
  `@cloudflare/puppeteer` that talked to a real Workers binding was not possible: `CodemodeBackend`
  hands a loader isolate no bindings, and a host module call carries values, not sockets.
- **What it may do.** The renderer's front checks every CDP command against an allowlist, allows
  navigation only to `about:blank` and `data:`, refuses anything naming `file://`, and intercepts
  every request at browser level: `data:` and `blob:` load, Mermaid comes from the image, everything
  else fails. Downloads are denied and windows a page opens are closed. Details: the renderer's README.

### Threat model

The page runs code the model wrote, on HTML that may carry text from an office's documents, so we
treat it as hostile. What it must not do: send anything out of the cluster, read another run's page
or files, or keep anything for the next run. Layers, each enough on its own for egress: the CDP guard
(allowlist, navigation, `file://`), Chromium's request interception (`BlockedByClient` for every
non-`data:` request), a loopback proxy that refuses everything and names that resolve to nothing, and
a NetworkPolicy that admits only the code runner and allows no egress at all. Against leaks between
runs: a process and a fresh profile per run, one run per Chromium, deleted at its end.

**The container is the sandbox.** Chromium runs with `--no-sandbox`. Its own sandbox needs
unprivileged user namespaces, and dev has none to give: the nodes (Ubuntu 24.04, kernel 6.8,
containerd 1.7) set `kernel.apparmor_restrict_unprivileged_userns=1`, so under `RuntimeDefault`
`unshare -Ur` fails and Chromium aborts with `No usable sandbox!` (probe, 2026-11-18); and the
namespace `grid` enforces Pod Security `baseline`, which refuses `seccompProfile: Unconfined`, the
earlier way around the runtime's filter. So the boundary is the pod: uid 10042, no capabilities,
`NoNewPrivs`, the runtime's default seccomp filter on every Chromium process, a read-only root, no
service-account token, no secret and no environment from one, no network but the code runner's
ingress, and a session that dies with its process group at 190 s. What Chromium's sandbox gave on top,
and is now gone: a renderer exploit no longer has to escape a second, stricter seccomp filter and its
own user, PID and network namespaces; it holds the browser process's rights in the pod, which reach
the other session's browser (two per pod) and nothing else. What would bring it back: a node AppArmor
profile that allows user namespaces for the Chrome binary plus a `Localhost` seccomp profile (the
runtime default plus the namespace calls), both files on every node, which the provider does not let
us place today; or gVisor as the pod's runtime class. Residual risks: the image's Chrome is only as
current as its pinned digest, which Dependabot proposes weekly. The allowlist is the 42 CDP methods
Puppeteer sends for the documented uses (input without drag and drop, which can carry a file into the
page); everything a run receives from the browser counts against 50 MiB, and the runner's host module
holds at most 56 MiB unread. Known follow-up: the 1.5 GiB memory limit for two browsers is set from
four measured documents, to be revisited with production peaks.

## Storage

The working directory is the draft store the Markdown drafts already used: a LangGraph store on the
agent's checkpoint database, namespaced by conversation. A file a run writes is kept as text when it
has a text suffix and is at most 64 KB, otherwise as base64; together a conversation's files take at
most 25 MB (Markdown drafts keep their own 256 KB cap). A binary file cannot be edited with
`edit_file`. The directory is deleted with its conversation (the agent host's drafts route).

**A run's file is kept unchecked.** The output check (`agent-file-check.ts`) runs at filing only, so
the working directory may hold an HTML page, an SVG with a script, or an Office file with a macro. The
file card reaches those bytes through two routes, and neither serves them as active content:
`/draft/download` answers an attachment with the type from the extension (HTML and XML as
`text/plain`, anything unknown as `application/octet-stream`), `nosniff` and
`default-src 'none'; …; sandbox` (`bff/conversations/draft-file.ts`); `/draft/rendition` answers only
a PDF draft or an Office draft converted to PDF, as `application/pdf` with `nosniff`, and refuses
every other type with 422 (`draft-rendition.ts`). Both specs pin it per type. A check at keep time
would add a BFF round trip per kept file and refuse what the agent may still be building toward
(an HTML report it renders to PDF next); the delivery headers are the boundary instead.

`/drafts/` stays the model's name for it; inside a run it is `/workspace/`, and the tool maps the two.
The rename to `/workspace/` everywhere is not done.

## Filing

`file_draft` with a path that is not `.md` sends `create_file` (or `update_file` for a draft it filed
before) with the bytes. The BFF:

- **checks the file** (`agent-file-check.ts`): Word, Excel, PowerPoint, PDF, SVG and PNG only, the
  bytes must be the declared type, at most 25 MB; refused are macros, embedded objects, external
  relationships, and content that runs when opened (scripts, DDE, PDF actions). CSV is refused with a
  pointer to Excel, because it has no place for the AI marking;
- **marks it as made by AI** in its own bytes (`agent-file-marking.ts`: OOXML custom properties, XMP
  in PDF, PNG and SVG), and files it as a generated draft (producer `agent_file`) under the person's
  session;
- **replaces** a draft only when the agent filed it with `create_file` and the type is the same.

The agent's `file_draft` files into the default folder `Berichte`. The person files the same draft
from its card („Ins Projekt ablegen“), choosing folder and name; that path goes through
`bff/conversations/draft-filing.ts` into the same `fileAgentFileDraft`, with the same check and
marking ([Filing, in the chat](agent-made-files-ux.md#what-this-change-ships)).

## The office skills

The builtin collection `office` holds `office-files` (the entry point: the run contract, libraries,
the office's number and date formats, exact calculation, reading the file back, filing) and
`office-word`, `office-excel`, `office-powerpoint`, `office-pdf` (typeset PDFs with diagrams, Typst),
`office-pdf-charts` and `office-html-pdf` (HTML and CSS to PDF, Mermaid, screenshots, through the
browser), one per file type with its
pitfalls and worked examples. They are offered to the chat agent by default. Each `js` fence is also a
file under the skill's `examples/` (`test_office_skills.py` holds the two equal), and
`apps/code-runner/test/skill-examples.test.mjs` runs every example in the isolate. Anthropic's
Apache-2.0 document skills were source material, rewritten for this runtime (`NOTICE`).

Deep research does not bind this `execute`; Deep Agents' own shell `execute` is hidden there while no
sandbox is configured, which production never does.

## What is measured

Times and memory per file type, per library and through the browser are measured in the runner's
[Measured](../../apps/code-runner/README.md#measured) and
[Memory per run](../../apps/code-runner/README.md#memory-per-run) and the renderer's
[Measured](../../apps/browser-renderer/README.md#measured). In order of size: a plain module about
15 ms warm, a Word or Excel file a few hundred ms, a Typst PDF 1 to 6 s, a Forme PDF with table and chart 1.2 to 1.6 s (measured
only here), a browser PDF under 1 s, an
endless loop `timeout` at its limit plus 10 s with the other slots serving. In production each run is
an `execute.run` step and four scores ([langfuse.md](../observability/langfuse.md)).

## Decisions

| Decision | State |
|---|---|
| Isolate engine: workerd with its dynamic loader | Taken 2026-11-13. It needs `--experimental`; if the loader goes away, isolated-vm is the fallback and only the runner changes |
| Where working files live: the draft store, 25 MB per conversation, base64 | Taken |
| Limits: 60 s / 180 s, 4 runs per pod, 50 MB in, 50 MB out | Taken |
| CSV not fileable; HTML kept in the working directory but not fileable | Taken |
| Run files are checked at filing, not when kept; until then they are served only as a sandboxed attachment or a PDF rendition ([Storage](#storage)) | Taken |
| Shared runner pods across offices. An escaped script could read another run in the same pod (the other run's inputs) and copy it into its own files; it needs a bug in the isolate engine, and the output check sees types, not contents | Accepted for now; open: one runner deployment per organization |
| Memory per run: self-hosted workerd enforces none, so the runner's front watches each slot's anonymous resident memory and stops a run above 768 MiB (`status: error`), restarting the slot; set by the largest run the 50 MB in / 50 MB out limits allow (up to 628 MiB measured). A smaller cap needs smaller input and output limits first | Taken 2026-11-18 |
| A cap on concurrent runs per organization | Open, not built |
| Whether runs count toward an office's credits (ADR-0053) | Open |
| An `execute` input read as a download-log row. Today no row is written (see [One run](#one-run)). The change: a kind `agent_run` in `download-log/kinds.ts`, recorded always like `download`; a migration widening `document_access_log_kind_check` and `document_access_log_open_needs_own_list` (the table is append-only, so its down migration refuses once a row exists); `GET /api/internal/document-file?handOver=execute` calling `recordDocumentAccess` as the envelope's person, refusing with 503 under an own access list when the row cannot be written; `stored_file.locate_stored_file` passing it for `execute` only; the kind's label in the download-log view and the user guide. `dxf_measure` and the canvas keep no row: their bytes stay in the agent and only a measurement or a rendering leaves | Open, not built |
| A run as a row of the Herleitung | Built for the person's view: one row per file or calculation, named by what the run made, never by its script ([In der Herleitung](agent-made-files-ux.md#in-der-herleitung)). Open: the script and its inputs with citation keys, for the developer view |
| A dedicated Langfuse step per run (`execute.run`: status, timings, input and kept files, never contents) and the scores `execute-status`, `execute-runs-to-file`, `execute-files-made`, `execute-files-filed` ([`langfuse.md`](../observability/langfuse.md)) | Taken. Alerts (failure rate, replicas at maximum) are open |
| Tool results reach a run as data: `ifc_query`, `ifc_measure` and the project-profile reads keep their structured answer per conversation (latest 20, 8 MB each) and `execute(data=[…])` puts it read-only at `/workspace/in/<tool>-<ref>.json` ([Tool results as data](#tool-results-as-data)) | Taken 2026-11-18 |
| Renaming `/drafts/` to `/workspace/` | Open |
| Background runs (Hatchet fan-out, a KEDA trigger on its backlog) | Open, not built |
| Showing an HTML output beside the chat (MCP Apps, ADR-0142), sandboxed on its own origin | Open |
| A browser for runs: self-hosted `chrome-headless-shell` on the Puppeteer team's image, one process per run, its own Deployment, reached through `@cloudflare/puppeteer` and a host-module binding. Not Cloudflare's hosted Browser Rendering (documents would leave the cluster), not Gotenberg, not browserless (SSPL) | Taken 2026-11-18 |
| The container is the browser's sandbox: Chromium runs `--no-sandbox` under `RuntimeDefault` seccomp, because dev's nodes forbid unprivileged user namespaces and `grid`'s Pod Security `baseline` refuses `Unconfined` ([Threat model](#threat-model)) | Taken 2026-11-18; revisit when the provider lets us place node AppArmor and seccomp profiles, or offers gVisor |

## Considered and dropped

- **Cloudflare Computer's durable workspace.** Its state lives in the runtime and brought a bucket,
  experimental cluster mode and a retention sweep. *Premise:* runs need state between calls; ours
  lives in the draft store.
- **A container per conversation with gVisor.** *Premise:* runs need Python, LibreOffice or a shell.
  If they do, it comes back as a second backend behind the same `execute`.
- **Hosted sandboxes** (Anthropic's code execution, E2B, Modal, Cloudflare Containers). *Premise:* no
  new processor receives an office's documents.
