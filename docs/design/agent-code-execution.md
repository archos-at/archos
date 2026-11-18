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
   refused (read it with `read_file`). Together at most 50 MB.
4. The runner gives the run a free slot, a fresh Durable Object and a fresh isolate, runs the module
   with a 60 s limit (180 s maximum), and returns the module's value, stdout, stderr and only the files
   it created or changed under `/workspace/`.
5. The tool keeps those files in the working directory, except files under `/workspace/in/` and any
   that would take the conversation's files past 25 MB, and answers with the status, value, output and
   the files kept. The agent may fix and run again, at most three times per file.

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
  tier and `agent-worker`.
- **The libraries** are a fixed manifest (`libraries.json`): docx, exceljs, pdf-lib, unpdf, pptxgenjs,
  vega with vega-lite and vega-interpreter, mathjs, decimal.js, papaparse, date-fns, jszip, marked,
  Forme, and Typst 0.14.2 as WebAssembly with its fonts and diagram packages (fletcher, timeliney,
  chronos, cetz under LGPL-3.0, shipped unmodified as source).
  Each is bundled ahead of time and handed only to runs whose source names it; nothing else can be
  imported. Admission rules: the README.
- **Deployment**: a plain Deployment, KEDA on CPU and memory, at least 2 replicas (dev 1 to 3), 1 CPU
  and 1 GiB requested, 2 GiB limit: 4 × (190 MB per process + 128 MB isolate + 50 MB of files)
  ≈ 1.5 GB.

## Storage

The working directory is the draft store the Markdown drafts already used: a LangGraph store on the
agent's checkpoint database, namespaced by conversation. A file a run writes is kept as text when it
has a text suffix and is at most 64 KB, otherwise as base64; together a conversation's files take at
most 25 MB (Markdown drafts keep their own 256 KB cap). A binary file cannot be edited with
`edit_file`. The directory is deleted with its conversation (the agent host's drafts route).

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
| workerd per slot | 134 MB idle, about 190 MB after a run; about +100 MB per Typst run, restarted over `CODE_RUNNER_SLOT_MEMORY_MIB` (512) |

In production a run is visible as the `execute` tool span of its `chat-turn` trace in Langfuse: its
output starts `status: ok`, `error` or `timeout` with the duration, and names the files kept.

## Decisions

| Decision | State |
|---|---|
| Isolate engine: workerd with its dynamic loader | Taken 2026-11-13. It needs `--experimental`; if the loader goes away, isolated-vm is the fallback and only the runner changes |
| Where working files live: the draft store, 25 MB per conversation, base64 | Taken |
| Limits: 60 s / 180 s, 4 runs per pod, 50 MB in, 50 MB out | Taken |
| CSV not fileable; HTML kept in the working directory but not fileable | Taken |
| Shared runner pods across offices. An escaped script could read another run in the same pod (the other run's inputs) and copy it into its own files; it needs a bug in the isolate engine, and the output check sees types, not contents | Accepted for now; open: one runner deployment per organization |
| Memory per run: self-hosted workerd enforces none; the pod limit bounds it | Open |
| A cap on concurrent runs per organization | Open, not built |
| Whether runs count toward an office's credits (ADR-0053) | Open |
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
