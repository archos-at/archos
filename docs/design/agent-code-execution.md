# The agent's `execute` tool: code in an isolate, nothing more

**Status:** implemented, off until a stack sets `grid-oib:codeRunnerEnabled: "true"`
(how: [`code-runner-runbook.md`](../deployment/code-runner-runbook.md)). Without the runner the
tool stays bound and answers that code execution is not available.

## The result

The chat agent has one tool, `execute`. It runs a short JavaScript (or TypeScript) module the agent
wrote, in a fresh V8 isolate with no network, and keeps the files the module wrote in the
conversation's working directory. From there `file_draft` files a Word, Excel, PowerPoint, PDF, SVG
or PNG file into the project as a draft, checked and marked as made by AI.

So the agent computes instead of writing about computing: totals, ratios and comparisons come from
code that ran, and the office gets files it opens without explanation. Documents handed to a run are
processed in code, so only the findings reach the model.

| | As built |
|---|---|
| Runtime | `apps/code-runner`: self-hosted workerd with `@cloudflare/computer`'s `CodemodeBackend` ([README](../../apps/code-runner/README.md)) |
| Tool | `packages/agent/src/agent/tools/execute/` (`run.py`, `runner_client.py`), bound to the chat agent in `configs/config_oib_openrouter.yml` |
| Working directory | the LangGraph draft store (`tools/documents/draft_store.py`), `/drafts/` to the model, `/workspace/` inside a run |
| Filing | `file_draft` → `POST /api/internal/document-versions` with `op: create_file` / `update_file` (`apps/workspace/bff/documents/agent-file*.ts`) |
| How to write a file | the builtin skill collection `office` (`packages/agent/src/agent/skills/builtin/office/`) |
| Deployment | `deploy/pulumi/src/app/code-runner.ts`, CI's image `code-runner` |

## One run

1. The model calls `execute(code, documents)`. The description says JavaScript module, no network,
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
   `documents read:` line names each document's path.
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
- **Deployment**: a plain Deployment, KEDA on CPU and memory, at least 2 replicas (dev 1 to 3), 1 CPU
  and 1 GiB requested, 4 GiB limit: 4 slots at their 768 MiB memory cap and the front ([the budget](../../apps/code-runner/README.md#memory-per-run)).

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

## The office skills

The builtin collection `office` holds `office-files` (the entry point: the run contract, libraries,
the office's number and date formats, exact calculation, reading the file back, filing) and
`office-word`, `office-excel`, `office-powerpoint`, `office-pdf` (typeset PDFs with diagrams, Typst)
and `office-pdf-charts`, one per file type with its
pitfalls and worked examples. They are offered to the chat agent by default. Each `js` fence is also a
file under the skill's `examples/` (`test_office_skills.py` holds the two equal), and
`apps/code-runner/test/skill-examples.test.mjs` runs every example in the isolate. Anthropic's
Apache-2.0 document skills were source material, rewritten for this runtime (`NOTICE`).

Deep research does not bind this `execute`; Deep Agents' own shell `execute` is hidden there while no
sandbox is configured, which production never does.

## What is measured

`task runner:test`, shared 4-core container, 2026-11-18 (full table in the README):

| What | Time |
|---|---|
| Word file, cold slot / warm slot | 328 ms / 117 to 234 ms |
| Excel with a `SUM` formula, first use | 376 ms |
| PDF made and read back, first use | 1004 ms |
| Bar chart to SVG, first use | 360 to 430 ms |
| Typst PDF with table and diagrams, fresh slot / warm slot | 3 to 6 s / 1 to 2.5 s |
| Forme PDF with table and chart | 1.2 to 1.6 s |
| Plain module, warm | 13 ms (16 ms as TypeScript) |
| Endless loop, `timeoutMs` 2000 | `timeout` after 5 s, other slots serving |
| workerd per slot | 134 MB idle, about 190 MB after a run; a slot ending a run above 128 MiB is restarted; a run above `CODE_RUNNER_SLOT_MEMORY_MIB` (768 MiB) is stopped |

In production a run is visible as the `execute` tool span of its `chat-turn` trace in Langfuse: its
output starts `status: ok`, `error` or `timeout` with the duration, and names the files kept.

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
| A run as a row of the Herleitung (script, inputs with citation keys, outputs) | Open, not built |
| A dedicated Langfuse step per run (`execute.run`: status, timings, input and kept files, never contents) and the scores `execute-status`, `execute-runs-to-file`, `execute-files-made`, `execute-files-filed` ([`langfuse.md`](../observability/langfuse.md)) | Taken. Alerts (failure rate, replicas at maximum) are open |
| Renaming `/drafts/` to `/workspace/` | Open |
| Background runs (Hatchet fan-out, a KEDA trigger on its backlog) | Open, not built |
| Showing an HTML output beside the chat (MCP Apps, ADR-0142), sandboxed on its own origin | Open |

## Considered and dropped

- **Cloudflare Computer's durable workspace.** Its state lives in the runtime and brought a bucket,
  experimental cluster mode and a retention sweep. *Premise:* runs need state between calls; ours
  lives in the draft store.
- **A container per conversation with gVisor.** *Premise:* runs need Python, LibreOffice or a shell.
  If they do, it comes back as a second backend behind the same `execute`.
- **Hosted sandboxes** (Anthropic's code execution, E2B, Modal, Cloudflare Containers). *Premise:* no
  new processor receives an office's documents.
