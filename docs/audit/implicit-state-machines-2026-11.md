# Implicit state machines, November 2026

A sweep of the whole repository on 2026-11-11 for things that move through a
fixed set of states without their legal moves being declared in one place. The
decision it led to is [ADR-0179](../adr/0179-lifecycles-are-declared-as-statechart-tables.md);
the machines already declared are drawn in
[`architecture/lifecycles.generated.md`](../architecture/lifecycles.generated.md).

## How it was made, and how far to trust it

Fourteen scanning agents on the smallest model each read one area and reported
what they found with file and line. Two further agents mapped the Hatchet usage
and read XState's current documentation.

**A row marked "read" was re-checked in the code by the author of this page. A
row not marked is a scanner's report and may be wrong.** Two reported defects
were re-read and were not defects (the inbound-mail attachment's fall-through to
`waiting` is exhaustive by type; the root sort's two cancel rules are one rule
and a narrower caller). Treat every unmarked "risk" below as a lead to verify,
not as a finding.

The scanners did not open everything. Named gaps: most of
`ui/components` (about 170 files), `ui/features/documents/components/review`,
the bodies of `use-ifc-viewer-canvas-controller.tsx` and
`use-shared-thread.ts`, `packages/ifc-spatial-py`, `packages/tavily-web-search`,
and most of `packages/agent/src/agent/common` beyond the claim queue.

## What it found

| Kind | Count | Declared before | Declared now |
|---|---|---|---|
| Persisted records (a status column, or timestamps read as one) | 43 | 3 | 12 |
| Background runs and their mirrors | 22 | 0 | 1 |
| UI flows | 41 | 0 | 2 |
| Wire and protocol vocabularies | 14 | 0 | 0 |

"Declared before" are the project (ADR-0098), the document version (ADR-0104)
and the platform change request (the trigger of migration 0218). "Declared now"
adds annotation, agent wake, agent ask, root-sort run, mail import, document
reading, task run, deletion queue and BIM model, the run ledger among the
background runs, and the CMS social post in its own package.

Four patterns account for most of the risk:

1. **Membership is guarded, moves are not.** Most status columns have a CHECK
   listing the legal values and writers that compare-and-set on the old value.
   Nothing says which pairs are legal, so the rule is the sum of the writers.
2. **One lifecycle, several vocabularies.** A document being read is
   `completed` in `documents.status`, `success` in the file status, `citable` on
   the surface and `ready` in the upload tray. A stopped run is `interrupted` in
   `task_runs`, `cancelled` in the run ledger and `canceled` in an agent ask.
3. **State as several fields.** Three booleans for a turn fence, six for the
   thinking header, two timestamps for an upload batch, three columns plus a
   queue row for a folder in the bin.
4. **A catch-all default.** An unknown server state shown as `pending`
   (`knowledge/service.ts`), `done = phase !== 'running'` (`SpectatedTurn.tsx`),
   everything that is not `pending` counted as done (`knowledge-ingest-watch.ts`).

## Persisted records

Paths are under `apps/workspace/` unless they start with a package.

| Record | States | Guard today | Status |
|---|---|---|---|
| Project, `projects.status` | active, paused, closed | table, CAS, CHECK | declared (read) |
| Document version, `document_versions.state` | draft, in_review, changes_requested, approved, published, superseded, rejected | rows table, CHECK, unique indexes | declared (read) |
| Annotation, `document_annotations.status` | proposed, open, resolved, dismissed | was an `if` chain; CHECKs | declared (read) |
| Agent wake, `agent_wakes.status` | queued, started, answered, stopped, suppressed, refused, failed | CAS, CHECKs | declared (read) |
| Agent ask, `agent_asks.state` | submitted, working, completed, canceled, failed, rejected | CAS, CHECKs | declared (read) |
| Root-sort run, `root_sort_runs.status` | judging, grouping, ready, applying, applied, undoing, undone, cancelled, failed | CAS with cursor, CHECK, one-in-work index | declared (read) |
| Mail import, `mail_imports.status` | uploading, queued, importing, completed, failed, cancelled | CAS, CHECKs | declared (read) |
| Platform change request, `knowledge_change_requests.status` + `second_review` | draft, submitted, approved, rejected, published, rolled_back | trigger (0218) holds every edge | declared in SQL only; TS has a list |
| Document reading, `documents.status` | uploaded, pending, processing, completed, failed, quarantined, stored, cancelled | CHECK; one trigger edge (leaving quarantine); CAS only in reconcile | declared (read by its converter). Dense: it mirrors the ingest backend; it rules out leaving quarantine except by release. Fixed on the way: a stale sweep or job failing a row it no longer owned |
| Screening hold (derived from five columns) | held, passed, in flight | same predicate in SQL and TS, kept equal by hand | |
| Inbound mail, `inbound_mails.status` | receiving, received, waiting, settled, dropped | CAS, many CHECKs, trigger freezes the sender verdict | |
| Inbound mail part, `inbound_mail_parts.state` | waiting, filing, filed, dismissed, expired | CAS on a claim, CHECKs | |
| Mail scan, `raw_scan_status` / `scan_status` | pending, clean, infected, failed, not_applicable | CHECKs | |
| Mail-thread follow | active, ended (eight reasons), expired by clock | CAS, CHECKs | |
| Proposed change, `proposed_changes.status` | proposed (+ apply lease), applied, partially_applied, failed, dismissed | CAS with a 5-minute lease, CHECKs | risk: lease without fencing |
| Deletion queue, `deletion_queue.status` | pending, purging, purged, restored, failed | partial unique index, CAS; no CHECK; two writers in two languages (`purger/db.js`) | declared. The stuck-row lead was real, in three forms, and is fixed; CHECK added (0223) |
| Folder in the bin (three columns) | living, in the bin, tombstone | CHECK on the combination | |
| Upload batch (two timestamps) | open, sealed, completed, reopened | CHECK, guarded UPDATEs | |
| Project intake, `project_intakes.status` | waiting, reading, ready, failed, completed | CAS on the job id, CHECKs | |
| Project profile key (JSON) | fact, assumption, unknown | app code; precedence repeated in three files | |
| Project memory, `project_memory.status` | proposed, active, superseded, dismissed | CAS for supersede; no CHECK | |
| Inbox item (four timestamps) | unread, read, resolved, archived, inert | WHERE clauses; no CHECK | |
| Mention request | open, answered, released, void | CAS; no CHECK | |
| Task run, `task_runs.status` | queued, running, succeeded, failed, interrupted, skipped, error | CHECK; CAS on close, none on the worker outcome | declared. The late-overwrite lead was real and is fixed: the first ending to close the row stands |
| Report filing, `task_runs.filing_status` | queued, filed, refused, failed | CAS; two CHECKs disagree on `queued` | |
| Task definition schedule (four columns) | manual, once, schedule × enabled × due | row lock on the occurrence, CHECKs | |
| Background job, `bff_job_queue.status` | queued, claimed, dead | CAS on the holder, CHECKs | mirror of Hatchet |
| BIM model, `bim_models.status` | pending, extracting, ready, failed | none; no CHECK | declared. The overlap lead was real and is fixed with a run id (0222) |
| Knowledge index run | requested, queued, failed | CHECK | |
| Platform lesson | candidate, active, retired | CHECK on the value; read-then-write | risk: check-then-act |
| Product feedback (external ticket) | new, open, pending, on_hold, resolved | PostHog is the authority | |
| Address register release | loading, active, retired | CHECK, one-active index | |
| LLM credential | active, revoked | one-active index, CAS | |
| Agent change undo (`undone_at`) | applied, undone | CAS; the stamp is also the lease | |
| Legal hold (`released_at`) | open, released | CAS, trigger on delete | |
| Budget policy, pricing version | active, superseded | one-active index / CHECK | |
| Platform skill | draft, published (a boolean) | none | |
| Folder card | fresh, stale, failed | CHECK | |
| Push subscription (failure count) | active, failing(n), deleted | SQL increment | |
| CMS social post (`apps/cms`) | draft, in_review, approved, scheduled, published, failed, archived | role matrix in a hook; enum | declared locally (`SOCIAL_MOVES`). The double-send lead was real and is fixed: the hand-off claims `sending` before it sends |
| CMS post (`_status`, `stage`) | draft, published; writing, in_review | hook; enum | two unlinked axes |
| OIB corpus file (four columns, `packages/agent`) | ingested, stale, pending, failed | CAS on the hash | ingested and failed at once is storable |
| Quarantine decision audit | owed, sent, deleted | at least once | |

## Background runs and their mirrors

| Run | States | Where | Note |
|---|---|---|---|
| Ingest job, `JobState` | pending, processing, completed, failed, cancelled | `packages/agent/.../knowledge/schema.py` | unconditional upsert by design; mirrored by hand in two TS files |
| Ingest file, `FileStatus` | uploading, ingesting, success, failed | same | a stopped file is recorded `failed` |
| Ingest lease (owner, heartbeat, hold) | live, held, stale, settled | `ingest_status_store.py` | three timers gate one state |
| Ingest attempt and credit wait | attempt n of 12, credit wait, superseded, timed out | `ingest_workflow.py` | Hatchet's; two outcomes stored nowhere |
| Claim queue (retiring) | queued, claimed, dead, cancelled, retired | `common/claim_queue.py` | trigger-guarded; only the cutover uses it |
| Failure category | transient, configuration, deterministic, quarantined, unknown | `ingest_failures.py`, mirrored in `retry-policy.ts` | already a table |
| Research job, `job_info.status` | submitted, running, success, failure, interrupted | `apps/agent-host/.../jobs/` | the enum is the runtime vendor's; terminal set repeated four times |
| Run ownership verdict | taken, alive, gone | `run_ownership.py` | |
| Run ledger status | created, running, waiting, done, failed, cancelled, interrupted | `bff/runs/run-ledger-types.ts`, `common/run_ledger.py` | declared. The missing terminal guard was real: every salvaged run was stored `done`. Fixed |
| Run ledger phase | planning, researching, checking, writing, filed | same | |
| Reconcile verdict | closed, already-closed, waiting, failed | `bff/runs/reconcile.ts` | settles the ledger before the row's CAS |
| Post-answer stage | ready, empty, skipped, failed, timeout, disabled | `packages/agent/.../stages/spec.py` | six states, three on the wire |
| Intake run session (four flags) | running, finished, stale, held | `agents/intake/tools.py` | |
| Deep-research cutoff | completed, four cutoff causes | `deep_researcher/cutoff.py` | |
| Commission refusal | six reasons | `turn/commission.py` | |
| Memory judge verdict | drawn, none, failed | `memory/restriction.py` | |
| Receive-job fault retry (payload counters) | in flight, waiting, held, dropped | `bff/inbound-mail/receive-faults.ts` | |
| Headless turn start | started, duplicate, busy, refused, rejected, unavailable | `bff/turns/headless-turn.ts` | |
| Push send decision | ten reasons, typed `string` | `bff/push/inbox-push-job.ts` | |
| Storage alert outcome | five outcomes | `bff/storage/alerts.ts` | |
| Project clear-out and creation sagas | steps with compensation, nothing persisted | `bff/projects/cleanup-service.ts` | a crash between steps leaves no record |
| Knowledge ingest watch (client poll) | working, done, missing | `ui/features/platform/.../knowledge-ingest-watch.ts` | a failed file reads as done |

## UI flows

| Flow | States | Where (`ui/` unless noted) | Note |
|---|---|---|---|
| Chat turn view | running, finished, failed + streaming, interaction, outcome | `features/chat/lib/turn-fold.ts` | statechart candidate |
| Composer flags (two definitions of "streaming") | stop, sending, send | `messages-store.ts`, `turn-projection.ts` | |
| Thinking header | nine labels from six inputs | `features/chat/components/ChatThinking.tsx` | a priority ladder |
| Turn socket | connecting, open, reconnecting, failed, incompatible, outdated, suspended, offline, closed | `adapters/api/turn-socket-machine.ts` | on XState since this sweep (read) |
| Realtime channel | connecting, live, offline | `features/realtime/connection.ts` | kept twice |
| Connection presence | connected, reconnecting, offline | `shared/hooks/use-connection-presence.ts` | |
| Dictation | checking, unavailable, idle, starting, recording, transcribing | `features/dictation/lib/dictation-machine.ts` | on XState since this sweep (read) |
| Viewer action | held, pending, shown, offered, refused, failed, undone, kept | `features/chat/lib/viewer-actions.ts` | any status may overwrite any |
| Server proposal card | proposed + problem, busy, overtaken | `features/cards/hooks/use-server-proposal.ts` | |
| Card decision | accepted, rejected, saved, dismissed, partiallyApplied | `features/cards/card-decision.ts` | |
| Run block (four literal sets) | the ledger's | `features/runs/components/RunBlock.tsx` | |
| Task list filter | active, broken | `features/tasks/lib/task-view.ts` | `skipped` and `interrupted` in neither |
| Tracked upload row | uploading, ingesting, success, failed, deleting, canceled, held, stored | `features/documents/types.ts`, six writers | tried and withdrawn, see below (read) |
| Upload pollers (three loops) | polling, session poll, watching | `features/documents/orchestrator.ts` | a stored `isPolling` kept by hand |
| Canvas ask | composing, thinking, answered, declined, handedOff, stopped, failed | `features/documents/hooks/use-canvas-ask.ts` | a stored projection of the turn |
| Root-sort dialog phase | loading, intro, working, review, done, undone, failed, cancelled | `features/documents/lib/root-sort-phase.ts` | already one pure function |
| Held-upload decision | five fields | `components/held-upload-decision.tsx` | |
| Review composer | idle, typing, approving | `components/document-review-controls.tsx` | two fields |
| Mail-import send | sending, joining; failure stage | `features/documents/lib/mail-import-send.ts` | |
| Upload summary | loading, ready, not-found, error | `features/uploads/hooks/use-upload-summary.ts` | |
| Folder bin panel | busy, purging, loading more | `components/folder-bin-panel.tsx` | |
| Bulk re-read | idle, running | `hooks/use-bulk-reingest.ts` | |
| Document selection | inactive, active | `hooks/use-document-selection.ts` | |
| Project lifecycle hook and close dialog | the server's; three steps | `features/projects/` | cleanup runs before the close |
| Intake reading phase | waiting, reading, ready, failed, completed | `features/project-intake/` | |
| Intake setup step | project, filing, reading, questions, profile | same | an ordered list |
| Filing step mode | empty, chosen, uploading, project | same | one ternary |
| Participants overlays | four slots | same | |
| BIM model poll | pending, extracting, ready, failed | `features/bim/hooks/use-bim-model.ts` | |
| IFC viewer load | idle, downloading, parsing, ready, error | `features/bim/components/` | cancel kept outside the phase |
| IFC compare | idle, loading, error | same | |
| Inbound attachment case | nine statuses | `features/inbound-mail/lib/attachment-case.ts` | exhaustive by type (read) |
| Mail suggestion by clock | pending, skipped, none | `features/inbound-mail/lib/suggestion.ts` | |
| Quarantine batch | pending, dialog | `features/organization/` | |
| Mark answer | sent, resolved, conflict, failed | `features/collaboration/hooks/use-mark-answer.ts` | shows `resolved` before the write |
| Spectated turn | running, anything else | `features/collaboration/` | catch-all |
| Diagram filing | idle, filing, filed, partial, failed | `features/diagrams/use-diagram-filing.ts` | |
| Skill editor and review verdict | steps; idle, running, done, unavailable | `features/skills/` | |
| Change-request review ladder | the server's | `features/platform/components/change-request-review.tsx` | repeats a server list |
| Schedule wizard | task, schedule, review | `features/jobs/components/schedule-wizard.tsx` | |
| Fetch state | at least seven shapes, about twelve components with a `loading` and a `failed` boolean | `features/platform`, `search`, `knowledge`, `product-feedback` | no shared hook |

### The upload row: why a status guard is the wrong fix

A guard was written for this row (a declared lifecycle, and one function that
refuses a report moving a settled row back to `uploading` or `ingesting`) and
withdrawn before it was committed. What it taught:

* The row mirrors the server, so almost every move between its states is one
  the server really makes. A table of its legal moves is close to the complete
  graph and constrains nothing.
* The status alone cannot tell a stale report from a true one. A read-again
  started in another tab, or from the document menu, reaches this row only as
  a listing that says `ingesting` on a row that says `success`: the same write
  as a poll that is one answer behind. Refusing it hides a read that is
  running. A job that retries reports `failed` and then `ingesting` under one
  job id (`ingest_execution.reopen`), and refusing that shows a failure the
  retry is about to undo.
* The flicker the comment in `use-settle-tracked-uploads.ts` names is prevented
  today by a rule about who writes (the settle hook takes only rows without a
  job). No sequence that produces it now was found.
* Two facts about the vocabulary: `deleting` is drawn but never written (a
  delete removes the row), and no writer moves a `failed` row back to
  `uploading` (a retry removes the row and adds a new one).
* What would fix the class: the row carries the id or the time of the report it
  last took, and a report older than that is dropped. That needs the server to
  send one, so it is a change to the listing and the job status, not to the
  store.
* Three narrow defects on this row were fixed instead, none by reading the
  status as a guard: a cancelled row was drawn as uploading in the chat's file
  sources (`mapToDisplayStatus` is exhaustive over the status now); a row this
  session just created could take a same-named file's status from a job
  already being polled (`lib/job-file-match.ts`: a row that still holds its
  local file and has no id is never matched by name); and a stop wrote
  `canceled` over a read that had finished meanwhile (`lib/stop-reading.ts`
  re-reads the row). The stop route still does not say whether the document
  ended cancelled; the client asks once in the rare case it needs to know.

## Wire and protocol vocabularies

Generated from one Python source already, so their *membership* cannot drift
(`contracts/wire/v2.schema.json`, `contracts/cards/schemas.json`). None declares
an order.

| Vocabulary | Values | Note |
|---|---|---|
| Run finished outcome | answered, refused, handed_off, cancelled | the BFF says `stopped` for `cancelled`, mapped in `chat_socket.py` (read) |
| Turn outcome (BFF) | answered, refused, handed_off, stopped, failed | |
| Tool step, action step | running, ok, error (+ empty) | two sets |
| Skill step phase | offered, activated, loaded | `loaded` has no writer the scan found |
| Quote check, confidence check | verbatim, not_found, unchecked; judged, unavailable | |
| Stage value | ready, empty, failed | |
| Routing decision | meta, shallow, deep, error | |
| Plan decision and outcome | approved, shallow, cancelled, feedback | |
| Interaction prompt | pending, answered, cancelled, expired | |
| Conversation running marker | unheld, held, lost | a cache key with a 12 s lifetime |
| Turn fence (three booleans) | live, tripped, released | `turn_fence.py` |
| Agent presence in a room | here, gone; reading, idle | |
| Malware scan verdict | clean, infected, failed (seven reasons) | |
| Site resolution | verified, unverified; decided, undetermined | pure, nothing stored |

## The order to convert the rest in

Five of the first list were done in the change that wrote this page: document
reading, the run's ending (task run and ledger), the deletion queue, the BIM
model and the CMS social post. Each began by verifying its lead, and all five
leads held. Three independent reviews before the merge found nothing blocking.

What those two rounds left open was decided and closed in the change after
(November 2026). Each fix began by reproducing the defect, and two decisions
were corrected by the code on the way:

* **Re-screening a quarantined upload** works (migration 0225). The rule first
  decided, "the write lifts nothing", was unsafe: no CHECK ties the status to
  the screening outcome, so a quarantined row still carrying an earlier `clean`
  would have been shown to the office. The trigger lets a quarantined row
  return to `uploaded` only when the new row says its outcome is `quarantined`
  and its three hashes are unchanged, and the re-screen writes that outcome.
* **Archiving a document stops its running read first**, and the pipeline's
  `document-exists` check answers "gone" for an archived document, so a job the
  cancel could not reach removes its own chunks.
* **The stop route says what state the document ended in.**
* **An extraction job knows its row by its own job id** as well as the bytes.
* **The kill switch interrupts only what it stopped.** The decision first aimed
  at a run whose block already reads `done`; tracing the worker showed the
  block reads `done` only after the outcome was delivered or given up on, and
  the real window is a run that owns SUCCESS in the job store while its outcome
  report is still in flight. Every row the backend does not report as killed is
  closed by the job store's verdict.
* **Recording a submission cannot reopen an ended run** or take a started one
  back to waiting.
* **A run's close is stamped by the database's clock**, so the heal's predicate
  does not depend on a pod's.
* **A deletion's claim is a token** (`claimed_at`): every closing write matches
  the claim it took, so a holder whose claim was taken over changes nothing. A
  folder already purged whose bookkeeping failed is closed `purged`
  (`closeErased`).
* **A connection attempt is bounded** in preparing (10 s) and dialing (15 s);
  a thread holds one live connection error; the "restoring" line also shows
  when the first connect after a tab returns is slow; a recorder that hung on a
  recording the meter heard speech in says it could not be saved.
* **Migration 0223 has its Postgres check**, and a spec holds the schema's
  CHECK text, the migration and the script to the status tuple.

Still open after that, each for a stated reason:

* **Nothing records that a scheduled social post went out at Buffer.** No
  Buffer account exists yet to test a status poll against.
* **A chat whose erasure completed but whose bookkeeping failed still reads
  `failed`.** Nothing durable records whether its traces were erased, so the
  purger cannot tell the two apart. The same holds for a folder that owes
  trace erasure.
* **An old extraction job's success path is not fenced**, only its failure
  write; and between marking a row processing and stamping the new job's id an
  old job's failure can still land. Closing both needs the enqueue and the
  stamp in one transaction.
* **The review canvas exposes the "restoring" fact but shows nothing**: there
  is no place or copy for a connection note on the canvas yet.
* **Sliced recording is on for WebM only.** Safari's MP4 slices have not been
  sent through the transcription, so a hung recorder there still holds nothing.
* **After the kill switch, a run can stay live for a while**: one whose job the
  store still holds as running (its stop failed, or it lay past the batch), or
  one the store has lost, is left for the reconciler, which ends a lost one
  `failed` after its grace. The platform console shows the interrupted count
  only; the answer also carries `runsSucceeded`, `runsFailed` and
  `runsWaiting`, which the console does not draw yet.
* **A re-read with screening switched off** leaves a re-screened file
  `completed` with outcome `quarantined`: held, in the reviewers' queue, with
  no reason listed.

Still to convert, by what each fixes for a person:

1. **Inbound mail and its parts.** The CHECKs are thorough; the edges exist only
   in the writers. Do it when that flow next changes.
2. **Proposed change.** Add `applying` as a state, or a fencing token, if applies
   can run longer than the five-minute lease. Check the timings first.
3. **The Python tier.** A `define_lifecycle` with the same shape, and the
   declarations generated into `contracts/` so the mirrored lists (job state,
   file status, annotation, document version) have one source. The run ledger's
   moves are mirrored by hand today and held by a fixture.
4. **The chat turn fold** on XState, if a defect ever calls for it; and one
   shared fetch-state hook for the twelve components with two booleans.
5. **The agent door.** A resource that serves the registry, so a calling agent
   can read which moves a record accepts before it asks for one.
