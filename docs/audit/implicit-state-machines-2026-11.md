# Implicit state machines, November 2026

A sweep of the whole repository on 2026-11-11 for things that move through a
fixed set of states without their legal moves being declared in one place. The
decision it led to is [ADR-0178](../adr/0178-lifecycles-are-declared-as-statechart-tables.md);
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
| Persisted records (a status column, or timestamps read as one) | 43 | 3 | 8 |
| Background runs and their mirrors | 22 | 0 | 0 |
| UI flows | 41 | 0 | 0 |
| Wire and protocol vocabularies | 14 | 0 | 0 |

"Declared before" are the project (ADR-0098), the document version (ADR-0104)
and the platform change request (the trigger of migration 0218). "Declared now"
adds annotation, agent wake, agent ask, root-sort run and mail import.

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
| Document reading, `documents.status` | uploaded, pending, processing, completed, failed, quarantined, stored, cancelled | CHECK; one trigger edge (leaving quarantine); CAS only in reconcile | next (see order) |
| Screening hold (derived from five columns) | held, passed, in flight | same predicate in SQL and TS, kept equal by hand | |
| Inbound mail, `inbound_mails.status` | receiving, received, waiting, settled, dropped | CAS, many CHECKs, trigger freezes the sender verdict | |
| Inbound mail part, `inbound_mail_parts.state` | waiting, filing, filed, dismissed, expired | CAS on a claim, CHECKs | |
| Mail scan, `raw_scan_status` / `scan_status` | pending, clean, infected, failed, not_applicable | CHECKs | |
| Mail-thread follow | active, ended (eight reasons), expired by clock | CAS, CHECKs | |
| Proposed change, `proposed_changes.status` | proposed (+ apply lease), applied, partially_applied, failed, dismissed | CAS with a 5-minute lease, CHECKs | risk: lease without fencing |
| Deletion queue, `deletion_queue.status` | pending, purging, purged, restored, failed | partial unique index, CAS; no CHECK; two writers in two languages (`purger/db.js`) | risk: a row at the attempt cap can be left `pending` and never claimed |
| Folder in the bin (three columns) | living, in the bin, tombstone | CHECK on the combination | |
| Upload batch (two timestamps) | open, sealed, completed, reopened | CHECK, guarded UPDATEs | |
| Project intake, `project_intakes.status` | waiting, reading, ready, failed, completed | CAS on the job id, CHECKs | |
| Project profile key (JSON) | fact, assumption, unknown | app code; precedence repeated in three files | |
| Project memory, `project_memory.status` | proposed, active, superseded, dismissed | CAS for supersede; no CHECK | |
| Inbox item (four timestamps) | unread, read, resolved, archived, inert | WHERE clauses; no CHECK | |
| Mention request | open, answered, released, void | CAS; no CHECK | |
| Task run, `task_runs.status` | queued, running, succeeded, failed, interrupted, skipped, error | CHECK; CAS on close, none on the worker outcome | risk: a late success may overwrite a reconciled row |
| Report filing, `task_runs.filing_status` | queued, filed, refused, failed | CAS; two CHECKs disagree on `queued` | |
| Task definition schedule (four columns) | manual, once, schedule × enabled × due | row lock on the occurrence, CHECKs | |
| Background job, `bff_job_queue.status` | queued, claimed, dead | CAS on the holder, CHECKs | mirror of Hatchet |
| BIM model, `bim_models.status` | pending, extracting, ready, failed | none; no CHECK | risk: no attempt id, a slow run may land on a newer one |
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
| CMS social post (`apps/cms`) | draft, in_review, approved, scheduled, published, failed, archived | role matrix in a hook; enum | risk: hand-off sends before it records |
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
| Run ledger status | created, running, waiting, done, failed, cancelled, interrupted | `bff/runs/run-ledger-types.ts`, `common/run_ledger.py` | risk: no terminal guard on append; Python side writes plain strings |
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
| Turn socket | connecting, open, reconnecting, failed, incompatible, outdated, suspended, offline, closed | `adapters/api/turn-socket.ts` | statechart candidate |
| Realtime channel | connecting, live, offline | `features/realtime/connection.ts` | kept twice |
| Connection presence | connected, reconnecting, offline | `shared/hooks/use-connection-presence.ts` | |
| Dictation | checking, unavailable, idle, starting, recording, transcribing | `features/dictation/hooks/use-dictation.ts` | statechart candidate |
| Viewer action | held, pending, shown, offered, refused, failed, undone, kept | `features/chat/lib/viewer-actions.ts` | any status may overwrite any |
| Server proposal card | proposed + problem, busy, overtaken | `features/cards/hooks/use-server-proposal.ts` | |
| Card decision | accepted, rejected, saved, dismissed, partiallyApplied | `features/cards/card-decision.ts` | |
| Run block (four literal sets) | the ledger's | `features/runs/components/RunBlock.tsx` | |
| Task list filter | active, broken | `features/tasks/lib/task-view.ts` | `skipped` and `interrupted` in neither |
| Tracked upload row | uploading, ingesting, success, failed, deleting, canceled, held, stored | `features/documents/types.ts`, six writers | statechart candidate |
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

Ranked by what each fixes for a person, then by how safe the conversion is. Each
is one change: declare, replace the literals at the writers, register.

1. **Document reading (`documents.status`)**. Eight states, about twelve write
   sites in nine files, and the status every office looks at most. Declaring it
   also settles the open questions the scan raised (whether `uploaded` is only
   a birth state; the one writer with no compare).
2. **Task run and run ledger together.** Decide the one word for a stopped run
   (`interrupted`, `cancelled`, `canceled`) and give the ledger a terminal
   guard, so a late worker cannot move a run that has ended.
3. **Inbound mail and its parts.** The CHECKs are thorough; the edges exist only
   in the writers.
4. **Deletion queue.** Two writers in two languages and no CHECK. Verify the
   attempt-cap lead first; if it holds, it is a bug with data-retention weight.
5. **Proposed change.** Add `applying` as a state, or a fencing token, so a slow
   apply cannot be claimed a second time.
6. **The Python tier.** A `define_lifecycle` with the same shape, and the
   declarations generated into `contracts/` so the mirrored lists (job state,
   file status, run ledger, annotation, document version) have one source.
7. **The four UI statecharts** (turn socket, dictation, upload row, chat turn
   fold), on XState when v6 is stable; and one shared fetch-state hook for the
   twelve components with two booleans.
8. **The agent door.** A resource that serves the registry, so a calling agent
   can read which moves a record accepts before it asks for one.
