---
status: proposed
date: 2026-11-03
decision-makers: Platform
consulted: product owner
informed: everyone working in this repo
---

# A file is read in steps, with one task per page that needs a model

## Context and Problem Statement

ADR-0117 kept one document on one worker and proposed a bounded page pipeline
inside it; ADR-0150 moved the job onto Hatchet as two steps, `index` then
`settle`, and named "finer ingest steps and page fan-out" as future work that
needs the parsed document persisted between steps. Four changes since have
built most of what such steps would need, inside the one step:

1. one streaming page-read pool per file (`page_reads.py`): 14.9 s became 4.3 s
   for the 52 page reads of the measurement file below;
2. the summary, tags, topics and dossier off the path to searchable
   (`ingest_enrichment.py`);
3. deterministic chunk ids and an embedding cache (`chunk_identity.py`);
4. the parsed document stored per version (`parsed_store.py`, `_text/parsed.json`).

The owner asked for the last step of that plan as well: a restartable workflow
whose pages fan out as tasks of their own, so a crash repeats one page and a
document's pages can spread over machines. The assessment that ordered the work
said to build it last and keep it only if a measurement shows it beats step 1.
This record is that measurement and the decision it supports.

## Decision Drivers

* Time to searchable and wall time per document, on the file the earlier steps
  were measured on.
* What a crash in the middle of page reads costs on its retry.
* Whether more ingest workers make one document faster.
* The fleet-wide vision ceiling (`VLM_FLEET_CONCURRENCY`) and per-office
  fairness hold as they do now.
* No document text in the orchestrator; step functions free of the SDK (ADR-0150).
* Complexity: every step boundary is a persisted hand-off, a retry policy and a
  failure mode.

## Considered Options

1. **Keep `index` as one step** (ADR-0150 with steps 1 to 4).
2. **Read a file in steps, one task per page** (`INGEST_PAGE_FAN_OUT=on`):
   `extract`, a `read-page` task per page that needs a transcription or a
   drawing's reading, `assemble-write`, the enrichment calls as steps of their
   own, `settle`.

## Decision Outcome

**Proposed, not accepted.** Option 2 is built behind `INGEST_PAGE_FAN_OUT`
(default `off`) and measured below. On one worker it is slower than option 1;
its gains are the cost of a crash mid-file and, projected, one document's pages
over two workers, and neither is worth the complexity at our load. The switch
stays for exactly one deploy, so the comparison can be read on staging; the next
change deletes whichever shape loses, the one-step path included if this record
is accepted then.

### What option 2 is, as built

* `ingest-document` keeps its name and its workflow-level idempotency and
  priority; heavy files keep `ingest-document-heavy`. Its steps
  (`ingest_hatchet._declare_fan_out`; SDK-free bodies in `ingest_steps.py`, which
  reach the knowledge layer through an ingestor port, `page_fan_out_port.py`
  (ADR-0072), implemented by `llamaindex/fan_out_steps.py` over `extract.py`,
  `read_page.py`, `assembly.py` and `enrich.py`):
  `extract` → durable `read-pages` → `assemble-write` → `enrich-summary`,
  `-tags`, `-topics`, `-dossier` at once → `enrich-permit` (only when the tags
  typed the document) → `enrich-write` → `settle`.
* Step outputs are references and counts only. What a step hands the next is
  stored beside `parsed.json` (`llamaindex/step_outputs.py`):
  `_text/page-reads/<n>.json` (the vision-cache answers a page task got, keyed as
  the pipeline asks for them), `_text/enrichment.json` (the enrichment's inputs)
  and `_text/enrichment/<name>.json`, through the same BFF presign, whose closed
  set of parts gains a closed pattern (`STEP_OUTPUT_PART_PATTERN`).
* The write is the existing pipeline: `_ingest_job` runs inside the assembly,
  which hands the stored answers to the file's page-read pool
  (`page_reads.answers_read_elsewhere`), so no page a task read is asked again,
  and defers the enrichment to its steps (`ingest_enrichment.deferred`). The
  same chunk ids are written as with the switch off.
* **The tenant-scoped limits are on tasks.** The engine refuses a tenant-scoped
  limit at the level of a workflow of several tasks (`put_workflow`,
  INVALID_ARGUMENT, seen in CI run 41645998459). `ingest-org` and
  `ingest-supersede`, in `ingest-document`'s order, sit on `extract` and
  `assemble-write`; named, they are one limit across both.
* `read-page` is its own workflow, under `ingest-page-read-fleet` (one constant
  key at `VLM_FLEET_CONCURRENCY`) and `ingest-page-read-org` (round robin on the
  organization), both named and tenant-scoped. The Dragonfly lease pool still
  caps the calls inside it. A failed page is retried alone (two retries), then
  stored as not read with its reason, and counted in the file's coverage
  (`transcription_failed`, `vision_failed`); the file goes on.
* **The deadlock.** A parent that waits for its children in an ordinary slot
  holds a slot its children need; on a full pool no child runs. `read-pages` is
  a durable task: it waits on a durable slot, which the SDK keeps apart from the
  ordinary ones, the engine may evict it while it waits, and a replay finds the
  children it already started. The page tasks also get a pool of their own,
  `ingest-page-reader` (`ingestPageReaderSlots`, KEDA on the `read-page`
  backlog), so one file's pages spread over its pods. The durable wait alone
  removes the deadlock; the pool is what lets the fan-out spread.

### Measurements

The offline harness of step 1 (`knowledge_layer_testing.page_fan_out_bench`):
the 52-page PDF of 12 CAD sheets (`build_drawing_sheets_pdf`) and 40 scanned
pages, every model call stubbed to 1 s (52 page reads, four enrichment calls,
one permit extraction), Qdrant, the object store and the vision cache in memory,
the production code otherwise. The orchestrator is emulated: 50 ms per task
start (an assumption, not a measurement of hatchet-lite), Hatchet's backoff for
a retried page, the page tasks 16 or 32 at once. Six runs each on 2026-11-03;
medians, ranges in brackets. Two later runs, after the page task entered the
job's data-policy and cost scope (`read_page.model_call_scope`) and on a busier
machine, gave the same picture a little slower on both sides (`off` 9.0 and
9.2 s, `on` with 16 slots 10.6 s twice).

| Scenario | Wall | Searchable at | Model calls |
|---|---|---|---|
| `off`, one step | 8.85 s [8.79–8.93] | 6.55 s [6.51–6.69] | 57 |
| `on`, one page worker (16 slots) | 10.25 s [10.12–10.59] | 7.35 s [7.21–7.50] | 57 |
| `on`, two page workers (32 slots, emulated in one process) | 8.6 s [8.44–9.44] | 6.15 s [5.89–6.85] | 57 |

Where `on` spends it: `extract` 0.7 to 0.8 s; the page reads end at 5.8 s with 16
slots (four rounds of 1 s, plus every page rendered under one process's PDFium
lock); the assembly renders each page again to find its answer's key (about
1.5 s to the write); the enrichment steps follow the write instead of overlapping
it (about 2.9 s after it, against 2.3 s).

A crash in the middle of page reads, after 26 of the 52 page answers:

| Scenario | What the retry costs | Calls redone |
|---|---|---|
| `off`: the worker dies; Hatchet runs `index` again | the lost attempt (3.4 s, 14 calls in flight lost), then a retry of 5.9 s [5.72–6.05]: the parse is read back, the 26 answered pages come from the vision cache, the other 26 pages and the enrichment run | 31 |
| `on`: the page worker dies with its tasks | the 11 to 14 tasks it held run again elsewhere; the run ends 0.3 to 0.6 s later than a clean one | 11–14 |
| `on`: one page raises once | that page alone, after a 2 s backoff, hidden by the other pages | 0 extra |

Both shapes pay the engine's detection of a dead worker before the retry starts;
it is not in these numbers.

**Two ingest workers.** With the switch off, a second worker does not make one
document faster: a document is one run on one worker. With it on, the 32-slot
row above runs two workers' pages in one process, whose renders share one PDFium
lock; on two machines the renders overlap, and the projection from the measured
phases is pages done at about 3.4 s instead of 4.6 s, so about 5.0 s to
searchable and 7.4 s wall (15 to 25 % under `off`). For many documents at once
neither shape gains: both are bound by the 32 vision slots the fleet shares,
which `off` already fills from 16 documents in flight.

### Why proposed

* On one worker, the shape most stacks run, `on` is 16 % slower end to end and
  12 % later to searchable, because a step boundary costs a render, a store and
  a task start per page, and the enrichment stops overlapping the write.
* The crash case is where `on` wins (about 5.4 s and 18 calls saved), and it is
  rare: step 4 already made a retry cheap, because the parse, the page answers
  and the embeddings are all read back.
* The multi-machine gain is projected, not measured, and it buys single-document
  latency only, against a new pool, a durable task, nine steps, three kinds of
  stored hand-off and a switch that must be flipped with nothing in flight.

### Consequences

* Good, because the fan-out exists and is measured, so the next decision is made
  on staging numbers rather than on a design.
* Good, because the pieces that make a retry cheap with the switch off are
  unchanged by it; the only shared change is that `_ingest_job` and the page
  tasks resolve the vision endpoint through one function (`read_page.vision_settings`).
* Bad, because the switch is a second shape of one workflow name: a run needs the
  steps it was started with, so flipping it with runs in flight strands them.
  The runbook says to flip it on an empty queue.
* Bad, because two things the one-step enrichment does are not carried over: the
  Fassung change line is told against the fallback summary, and the dossier does
  not see the replaced version's. And a reader may settle the document between
  the write and the enrichment steps, before its tags land.
* Bad, because a page task's vision calls are generations of their own in
  Langfuse, not nested under the file's `ingest-file` trace, and the page tasks'
  fleet cap reads `VLM_FLEET_CONCURRENCY` a second time (`ingest_steps.fleet_vision_cap`;
  a test holds it to the lease pool's).

### Confirmation

* `tests/knowledge_layer_tests/test_page_fan_out.py`: the steps write the chunk
  ids the one step writes, with the same 57 calls; the write asks no model for a
  page a task read; a page that keeps failing is recorded unread and counted in
  coverage while the file completes; a lost page task is the only work redone.
* `packages/agent/tests/knowledge/test_ingest_page_fan_out.py`: the declaration
  (limits on tasks, none on the workflow; the durable parent; the fleet and
  organization limits on `read-page`; which shape a trigger and a pool pick).
* `packages/agent/tests/knowledge/test_ingest_page_fan_out_engine.py`, in CI's
  `Hatchet engine tests` job: the engine accepts the declaration, a page is
  retried alone, and `read-page` never runs past its fleet cap. **Unverified**
  until that job runs: no engine is reachable where this record was written.
* `deploy/pulumi/src/app/ingest-worker.spec.ts`: the page-read pool, its KEDA
  prefix, and the refusal of more slots than the fleet cap.

## More Information

* Would supersede ADR-0117 (its page pipeline inside one worker) if accepted.
  Related: ADR-0150 (Hatchet; its "page fan-out is future work" is this record),
  ADR-0076, ADR-0081.
* Reproduce: `python -m knowledge_layer_testing.page_fan_out_bench` (PYTHONPATH
  with the worktree's `knowledge_layer`, its `testing/` and `packages/agent/src`).
* Revisit when staging shows ingest latency per document, not fleet throughput,
  as the complaint; when a measured crash rate makes retries a cost; or when one
  document's pages routinely exceed what one worker's 16 slots read in a round.
