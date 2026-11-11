---
status: proposed
date: 2026-11-11
decision-makers: product owner (Matthias), Grid engineering
consulted: Grid engineering
informed: everyone working in this repo
---

# A record's lifecycle is declared once, as a statechart table

## Context and Problem Statement

A sweep of the repository on 2026-11-11
([`audit/implicit-state-machines-2026-11.md`](../audit/implicit-state-machines-2026-11.md))
found 120 things that move through a fixed set of states: 43 persisted
records, 22 background runs, 41 UI flows and 14 wire vocabularies. Two of them
declared their legal moves in one place (`PROJECT_TRANSITIONS`, ADR-0098, and
`DOCUMENT_VERSION_TRANSITIONS`, ADR-0104). One more is declared in the database
(the trigger of migration 0218 for platform change requests). For every other
one the rule is the sum of its writers: a compare-and-set here, an `if` chain
there, a literal list repeated in a second file.

That costs each of the three readers something:

* **A person using the product** meets the gaps as states that disagree. The
  upload tray has eight statuses written from six files by three writers, and a
  comment in `use-settle-tracked-uploads.ts` records that finished uploads
  flickered back. A mail import had two lists both called "open" with different
  members.
* **A developer** cannot answer "what may this become" without reading every
  writer. The annotation's moves were five `if` lines in a service; the root
  sort's were five literal lists at five call sites.
* **An agent**, ours in the repo or a customer's at the door, has nothing to
  read. A refusal said a move was not possible and not which ones were.

The same sweep was asked two further questions: where XState would help, and
how the workflow engine (Hatchet, ADR-0150) fits.

## Decision Drivers

* Nothing breaks: the first slice changes no behaviour, and every converted
  machine keeps the guard it had.
* One shape for all three readers, and a standard one. A name we invent for a
  thing statecharts already name is a translation everyone pays for.
* The state of a persisted record lives in its row. Whatever we adopt must not
  introduce a second place that claims to know it.
* The Python tier has the same problem and must be able to follow.
* A declaration that nothing checks drifts, so each one needs a ratchet.

## Considered Options

1. **A statechart-shaped table with no runtime**, checked against XState in the suite (chosen).
2. **XState v5 as the runtime**, on the server and in the browser.
3. **Hatchet as the state machine**: model each lifecycle as a durable workflow.
4. **Transition triggers in the database** for every status column, as migration 0218 does for one.
5. **Leave it**: keep the two existing tables as a convention and convert nothing.

## Decision Outcome

Chosen option 1.

**The declaration.** `defineLifecycle` (`apps/workspace/shared/lifecycle/define-lifecycle.ts`)
takes the config a statechart takes: `id`, `initial`, and for each state its
moves as `on: { event: target }`, or `type: 'final'`. It answers the questions
writers and readers ask: `canTransition(from, to)`, `next(from, event)`,
`sourcesOf(event)` (the states an UPDATE matches on), `statesThatMayBecome(to)`,
`liveStates`, `finalStates`. It refuses at module load a config that is not a
machine: an undeclared target, a final state with a move out, a state nothing
reaches. It holds no state and runs nothing.

**The writer keeps the guard.** A move is still the repository's
compare-and-set, and the database's CHECKs still hold the shape of a row. What
changes is where the list in the `WHERE` comes from: the declaration, not a
literal.

**The registry and the reference.** Every declaration in `apps/workspace/bff`
is listed in `bff/lifecycles/registry.ts`, and
[`architecture/lifecycles.generated.md`](../architecture/lifecycles.generated.md)
is generated from it: one Mermaid diagram and one move table per lifecycle.

**First slice, in the change that adds this record.** Seven lifecycles:
project, document version (a view derived from its existing rows), annotation,
agent wake, agent ask, root-sort run, mail import. Each was derived by reading
every writer of its status, and each replaced the literals at those writers. No
move was added or removed. The project's 409 `invalid-transition` now also says
which states the project may become (`allowed`).

**Where XState fits.** XState's interpreter defines what our table means: the
suite builds a machine from every declaration (`createMachine(lifecycle.statechart())`)
and compares every state and event with ours, so it is a development dependency
and the oracle. It is not a runtime yet, for three reasons that are facts and
can change:

* v6 is in beta (`6.0.0-beta.2`, published 2026-11-11) and its migration guide
  removes `assign`, `raise`, `sendTo` and `enqueueActions` and breaks persisted
  snapshots. A runtime adopted on v5 today is migrated within the year.
* A persisted record's state is a column. An actor that also holds it is the
  second source of truth this record exists to remove. XState's own pure API
  (`transition(machine, snapshot, event)`) is what `next` already is.
* There is no maintained Python port (`statelyai/xstate-python` last moved in
  2021), and half our machines are in Python.

It would earn its place in the browser, for the machines that have timers,
retries and parallel regions, which a table cannot express: the turn socket
(nine connection states, a reconnect ladder, a hello timeout), dictation
(permission, recording ticker, transcription), the upload row (three writers
racing on one row) and the chat turn fold. Those four are the candidates when
v6 is stable; the config shape chosen here is theirs already.

**Where Hatchet fits.** Hatchet owns execution: that a piece of work runs,
retries with backoff, is fair across offices, and reports its failure. It does
not own what a record *is*. A document is `completed` because the office can
cite it, not because a task returned. So the split is:

| Question | Owner |
|---|---|
| Is the work queued, running, retrying, dead | Hatchet (its run state; ours only mirrors it) |
| What may this record become, and from what | the lifecycle declaration |
| Did the move happen | the row, by compare-and-set |

Two findings follow from that split and are not acted on here:

* We use none of Hatchet's durable features (durable tasks, wait-for-event,
  durable sleep, child workflows). Every wait on a person (a proposal, a held
  mail, a review, an `ask_user`) is a row and a later request. That is the right
  default: a person's yes may come in three weeks, and a row survives an engine
  upgrade. The one place a durable wait would remove code of ours is a job that
  re-slices itself with `notBefore` to wait (`piloti_wake`, `document_check`).
* The mirrors of Hatchet's run state are where our remaining home-made machinery
  lives (`bff_job_queue` claim and heartbeat, `ingest_jobs` owner and heartbeat,
  the research ownership check, three reconcilers). Removing a mirror is a
  decision about ADR-0150's cutover, not about lifecycles.

### Why not the others

* **XState as the runtime (2)**: rejected on the three premises above (v6 in
  beta, state in a column, no Python port). Re-check when v6 is stable.
* **Hatchet as the state machine (3)**: rejected because a Hatchet run ends, and
  most of our records do not: a project is paused for a year, a version waits
  for a reviewer. It would also put the legal moves of a domain record in an
  engine ADR-0150 keeps replaceable.
* **Triggers everywhere (4)**: the strongest guard, and right where a move
  carries a rule people must not be able to bypass (four eyes, migration 0218).
  Rejected as the general answer because a trigger is a second declaration in a
  second language that no TypeScript or Python reader sees, and each one is a
  migration. A declaration here can generate one later.
* **Leave it (5)**: rejected on the count. Two of 120 followed the
  convention after a year of it being available.

### Consequences

* Good, because "what may this become" has one answer per record, and the same
  answer for the writer's `WHERE`, the reviewer's diagram and the agent's
  refusal.
* Good, because the declaration is the standard shape: it draws in any
  statechart tool and becomes an XState machine without rewriting.
* Good, because a wrong declaration fails when the module loads, and a new one
  that skips the reference fails a spec.
* Bad, because a declaration says a move exists, not who may make it or what it
  stamps. Guards and effects stay in the service (the document version keeps
  its richer rows for exactly that reason).
* Bad, because seven of 120 are converted. Until a machine is converted
  its rule is still the sum of its writers.
* Bad, because the Python tier has no `defineLifecycle` yet. Its machines
  (ingest job, file status, research job, run ledger) stay implicit, and the
  literal lists mirrored between the tiers stay mirrored.
* Bad, because one more development dependency (`xstate`, pinned exactly).

### Confirmation

* `shared/lifecycle/define-lifecycle.spec.ts`: the helper agrees with XState on
  every state and event, and refuses a malformed config.
* `bff/lifecycles/registry.spec.ts`: every registered lifecycle agrees with
  XState; every `defineLifecycle` call under `bff/` is registered; the generated
  reference equals what the code declares.
* Each converted module's existing specs, unchanged, still pass.
* Nothing yet forces a *new* status column to come with a declaration. Review is
  the only gate for that; the audit's list is the backlog.

## More Information

* The order to convert the rest in, by what each fixes for a person:
  [`audit/implicit-state-machines-2026-11.md`](../audit/implicit-state-machines-2026-11.md).
* XState facts read on 2026-11-11: versions and licence from the npm registry;
  pure transitions from `stately.ai/docs/pure-transitions`; the v6 guide from
  `stately.ai/docs/xstate/v6/xstate-v5-to-v6` (seen through a search summary,
  not read in full); `statelyai/xstate-python` from its commit history.
* ADR-0098 (the project lifecycle), ADR-0104 (document versions), ADR-0150
  (Hatchet), [`contributing/lifecycle-matrix.md`](../contributing/lifecycle-matrix.md)
  (a matrix is about what a reader sees at each edge of a heavy surface; a
  lifecycle is about which edges exist).
