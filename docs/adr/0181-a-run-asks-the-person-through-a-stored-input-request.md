---
status: proposed
date: 2026-11-11
decision-makers: Grid engineering; the product owner asked for the groundwork of a more direct agent-human interface on 2026-11-11
consulted: MCP specification 2025-11-25, client/elicitation (fetched 2026-11-11); MCP Tasks extension SEP-2663, stable 2026-07-28 (fetched 2026-11-11); AG-UI concepts/interrupts and concepts/events (docs.ag-ui.com, undated, fetched 2026-11-11); A2A 1.0.0 task states (fetched 2026-11-11)
informed: everyone working on runs, the run block, the research worker and the agent door
---

# A run asks the person through a stored input request, and the answer is a row the run reads

## Context and Problem Statement

The product owner wants a more direct agent-human interface: a card the agent
works in, whose events arrive live, and where the person can answer or correct
the agent while it works.

Most of that card exists. A run (a research run, a task run) is one assistant
message whose **run ledger** is the account every surface renders (ADR-0062):
phases, steps, the documents each step reached. The run block follows the run's
own event stream, survives a reload, and shows the same thing to every reader of
the thread. A person can already act on a live run: cancel it, hand it a
document, tell it to write now.

One half is missing, and the code says so. The ledger has a `waiting` status with
the moves `ask` and `resume` around it, the inbox has a `task_run.waiting` row,
and the run block handles both. `run-ledger-types.ts` records the gap:
„`waiting` has no producer today: the worker's fold never sends it and no code
here derives it.“ A run cannot ask anything, because there is nowhere for its
question to live and no door for the answer.

The chat turn has a way to ask (`ask_user`, an `interaction_request` on the
socket), and ADR-0140 proposes to make that a pause and a resume. Neither covers
a run: a turn's question lives in one socket connection for thirty minutes, and
a run outlives the tab, the connection and often the working day.

## Decision Drivers

* **A wait on a person is a row** (ADR-0179). It must survive a deploy, a reload
  and a week, be visible to the people who may answer it, and say who answered.
* **The standard's shape before ours.** A question with a typed answer has a
  standard form in every protocol we speak.
* **One primitive, every client** (ADR-0055): the run block, the inbox, an
  outside agent on the door and the worker are equal clients of one HTTP API.
* **The first final word stands**, as for a proposal, an agent ask and a ledger.
* **The worker is stateless about people.** It must not hold a connection open
  to learn the answer.

## Considered Options

1. **A stored input request per run**, in the BFF's database, asked through an
   internal route, answered through a person route, read back by the worker.
2. **Extend the turn's `interaction_request`** to runs.
3. **A proposed change** (`proposed_changes`, ADR-0105) of a new kind.
4. **LangGraph `interrupt()` inside the worker**, as ADR-0140 proposes for turns.

## Decision Outcome

Chosen option 1: **a run's question is a row in `run_input_requests`, shaped as
the standards shape it, and its answer is written on that row once.**

The record:

* **What is asked** follows MCP form elicitation: a `message` and a
  `requestedSchema`, a flat object of primitive properties (string, optionally
  from an enum; number or integer with bounds; boolean). Flat on purpose, as in
  MCP: it renders as a small form anywhere, and the same request can later be
  put to a person through an outside agent's client unchanged.
* **Why it is asked** follows AG-UI's interrupt: `reason` is `input_required` or
  `confirmation`, with an optional `expiresAt`.
* **How it ends** is one of four states. `answered` carries a `content` object
  valid against the schema (MCP `accept`, AG-UI `resolved`). `declined` is the
  person's explicit no (MCP `decline`). `cancelled` is the run withdrawing the
  question or ending first (MCP `cancel`, AG-UI `cancelled`). `expired` is the
  deadline passing. The lifecycle is declared with `defineLifecycle` and
  registered; a database CHECK ties the decided columns to the status.
* **Who asked and who answered** are on the row: the run, and the person with
  the time.

The doors:

* `POST /api/internal/runs/[runId]/input-requests`: the worker asks. Identity is
  the run row, as for the ledger route; the body never names a tenant. The
  ledger moves to `waiting` in the same call.
* `GET /api/internal/runs/[runId]/input-requests/[requestId]`: the worker reads
  the request and, once decided, its answer.
* `GET /api/projects/[id]/runs/[runId]/input-requests`: a person lists them.
* `POST /api/projects/[id]/runs/[runId]/input-requests/[requestId]/resolve`: a
  person answers or declines. The gate is the one a person passes to act on the
  run today (`requireRunActor`). The ledger moves back to `running` when no
  question of the run is still open.

Both person routes are operations in the agent catalog, so an outside agent can
see that a run is waiting. Answering is marked a decision only the person makes
(ADR-0122's amendment): it runs for an outside agent only on the person's yes.

Rejected:

* **Option 2** because a turn's `interaction_request` lives in one socket
  connection and expires after 1,800 s (`chat_socket.py`, `RunningTurn.ask`),
  and nothing stores it. Re-check if ADR-0140 lands and gives a turn's question a
  stored form that a run could share; the two records should then be one.
* **Option 3** because a proposed change is a change the agent wants applied to
  the workspace, with an applier that runs a write as the decider. A question is
  not a write: its answer changes what the run does next, and nothing in the
  workspace. Folding it in would give every question an applier that does
  nothing. A run that wants a workspace change still proposes one.
* **Option 4** because the research worker is not a LangGraph graph with a
  checkpointer, and ADR-0140 itself is unbuilt: no `interrupt(` call exists in
  `packages/agent` or `apps/agent-host` (checked 2026-11-11). Re-check when
  ADR-0140's S0 to S3 are in.

### Consequences

* Good, because the `waiting` status, the inbox row and the run block's waiting
  state get the producer they were built for.
* Good, because the answer survives everything a run survives, and every reader
  of the run sees the same question in the same state.
* Good, because the shape is the one MCP elicitation and AG-UI interrupts
  already describe, so the door and a later wire adapter translate nothing.
* Bad, because this change is the groundwork only. **No worker asks yet and no
  surface renders a question.** The routes, the record and the Python client
  exist and are tested; the research runner's pause and the run block's form are
  the next two slices.
* Bad, because a worker learns the answer by reading the row, so a run waits one
  poll interval longer than a push would cost.
* Bad, because a flat schema cannot ask for a place on a drawing or a file. A
  question that needs one names it in `message` and takes the answer as text
  until a richer request is designed.
* Bad, because a second way to ask a person now sits beside the turn's
  `interaction_request` until ADR-0140 decides whether they merge.

### Confirmation

* `run_input_requests` CHECKs: a known status and reason; `decided_at` set
  exactly when the request has left `open`; `decided_by` and `content` only on a
  request a person decided; `content` an object exactly when `answered`.
* `bff/lifecycles/registry.spec.ts` holds the `run-input-request` lifecycle to
  its generated reference, and the repository's decide statement reads its
  `WHERE` list from the lifecycle.
* `bff/runs/input-requests.spec.ts` pins the schema bounds, the validation of an
  answer against its schema, the ledger's two moves, and that the first final
  word stands.
* `bff/runs/input-requests.integration.spec.ts` proves it on Postgres as the
  runtime role (`task db:test:rls`): a retried question is one row, the loser of
  a race writes nothing, each CHECK refuses its row, the list pages without a
  gap, and another organization neither reads a request nor plants one.
  `scripts/rls-test-db.sh` verifies the migration's reverse.
* `bff/db/rls-coverage.spec.ts` fails the table without its tenancy predicate.
* `bff/agent-api/agent-reachability.spec.ts`, `exposure.config.spec.ts` and
  `list-paging.spec.ts` hold both person routes to their operations and the list
  to a limit and a cursor.
* `apps/agent-host/tests/test_run_input_requests.py` holds the worker's body to
  the route's field names and bounds, and that no failure of the door fails a
  run. The bounds are repeated in Python by hand: nothing compares the two
  contracts yet, as `run-ledger.schema.json` does for the ledger.
* Nothing yet checks that a worker which asked also stops working until the
  answer: there is no asking worker.

## More Information

* The next slices, in order: the research runner asks and waits (reading the row
  on its own heartbeat, cancelling its open questions when it ends); the run
  block renders an open question as a form and the inbox row opens it; a live
  hint on a `run:<id>` channel (ADR-0110) so a second reader sees the answer
  without a reload; the first real asker, a drawing's scale
  ([`plan-measurement-from-drawings.md`](../roadmap/plan-measurement-from-drawings.md)).
* Revisit if ADR-0140 gives a turn's question a stored form (merge the two
  records), if the MCP Tasks extension's `inputRequests` becomes the way outside
  agents answer (expose a run as a task and map this row onto it), or if a
  question needs a non-flat answer more than twice.
* ADR-0062 (the run ledger), ADR-0105 (a turn does not outlive its answer; long
  work is a run), ADR-0107 (steering a running turn), ADR-0110 (live channels),
  ADR-0122 (the agent door), ADR-0140 (a turn pauses), ADR-0179 (lifecycles).
