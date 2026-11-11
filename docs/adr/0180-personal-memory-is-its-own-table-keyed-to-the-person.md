---
status: proposed
date: 2026-11-11
decision-makers: product owner (Matthias)
consulted: pilot offices (feld72, BWM, GernerGernerPlus), through their jour fixes and interviews
informed: everyone working in this repo
---

# A note has one home that says who reads it: personal memory is its own table, keyed to the person

## Context and Problem Statement

Memory had two shelves, a project's and the organization's (ADR-0008), and one
table for both. Anything the agent kept from a chat in a project went onto the
project's shelf, which every member with `project:view` reads. Three things
followed, and the pilot offices named each of them between 30 October and
10 November 2026:

* A note about a person (how they like to work, what they are responsible for,
  what they asked in confidence) had no shelf of its own, so it landed in the
  project's memory, in front of the team.
* A person could not say "do not keep anything from this chat". One googled
  instead, "aus Sorge, das Projekt mit fehlerhaften Abfragen zu füttern, die im
  Gedächtnis landen" (feld72, 30 October).
* Nothing on the screen said who reads a note, so people assumed the worst and
  used the product less (four interviews at BWM, 6 November).

The store itself is sound. What is missing is a shelf that belongs to one
person, a way to keep nothing, and a statement of who reads what.

## Decision Drivers

* A person's notes must be unreadable by a colleague, an administrator and
  every existing query, and that must hold when somebody forgets a `WHERE`.
* The project's memory is read from twelve modules besides its own service
  (digest, feedback, permits, cross-project decisions, project experience).
  A new scope in that table is safe only if all twelve learn to exclude it.
* The promise to the person has to be one sentence they can check.
* Per-person erasure (ADR-0011, ADR-0091) must reach the new notes.

## Considered Options

* **A third scope, `user`, in `project_memory`.** One table, one service, and
  dedup, recall and embeddings for free.
* **A table of its own, `personal_memory`, with row-level security on the
  person.** A second, smaller store.
* **An external memory service** (Supermemory, Mem0, Zep). Evaluated on
  2026-11-11.

## Decision Outcome

Chosen option: "a table of its own", because the database can then hold the
promise. `personal_memory` is secured with
`organization_id = current_org() AND user_id = current_user_id()`, the pattern
`user_preferences` has used since migration 0031. A query that runs for
somebody else sees no row, whatever its `WHERE` says, and none of the twelve
readers of `project_memory` can meet a personal note, because it is not in
their table.

The third scope is rejected on this premise: `project_memory`'s policy is the
organization's (`organization_id = current_org()`), so a `user` row would be
hidden from colleagues only by each query's own filter. If that table's policy
is ever made to depend on the reader, the premise is gone and the two stores
can be one.

The external service is rejected on this premise: Supermemory's hosted store
is in the United States unless an enterprise contract places it elsewhere, and
its self-hosted server was at version 0.0.9 on 2026-11-11. The offices are
promised hosting in Vienna and no tenant content in a third party's database
(ADR-0150's driver, ADR-0161). What these services add over our store is
recall quality, which is not what the offices asked for.

Three rules complete the decision:

1. **A note has one home, and the home says who reads it.** Mine: only the
   person. Project: the project's members. Office: everyone in it. The agent
   chooses between Mine and Project by what the note is about, never by where
   the chat happened: a note about the person is personal even in a project
   chat.
2. **A temporary conversation keeps nothing.** The flag is on the
   conversation. The single writer refuses the write (the internal memory
   routes), so it holds whatever the agent does; the agent also skips the
   `remember` tool and the reflection stage, to save the call.
3. **Personal memory is small and injected whole.** At most 20 notes and 1,500
   characters reach a turn, pinned first, then newest, and the block says so.
   It has no embeddings, no reinforcement and no status column until a person
   holds more notes than fit.

### Consequences

* Good, because privacy of a personal note is a database property, tested in
  `task db:test:rls`, and not a convention twelve modules must keep.
* Good, because a person can now be told one checkable sentence: "Nur du
  siehst das. Auch Administrator:innen nicht."
* Good, because the writer's refusal for a temporary conversation covers every
  present and future agent-side writer.
* Bad, because dedup, digest formatting and CRUD exist twice, in a small form.
  The shared pieces (`normalizeContent`, `formatBoundedDigestWithKept`) are
  reused; the rest is about 300 lines.
* Bad, because the agent's judgement of "about the person" is a model's
  judgement. A wrong one puts a project fact where colleagues do not see it,
  which loses value, or a personal one on the project's shelf, which is the
  harm this record exists to prevent. The second direction is the one the
  prompts are written against, and the person sees every save on the answer
  and can take it back.
* Bad, because a platform operator with database access can still read the
  rows. The sentence shown to the person names colleagues and administrators
  of the office, not the operator; the data-processing agreement covers that.

### Confirmation

* `rls-coverage.spec.ts` fails a table without `secure_table`.
* `personal-memory.integration.spec.ts` (in `task db:test:rls`) writes a note
  as one person and reads as another, in the same organization, and gets
  nothing.
* `app/api/internal/memory/route.spec.ts` and
  `app/api/internal/personal-memory/route.spec.ts` refuse a write from a
  temporary conversation.
* `packages/agent/tests/memory/test_register.py` and
  `tests/stages/test_memory_reflection_stage.py` hold the agent-side skips.
* Nothing checks the model's choice between Mine and Project yet; review and
  the person's own eye are the gate. An eval case belongs in the answer suite.

## More Information

The north star this serves, and the slices still open, are in
[`project-memory-design.md`](../architecture/project-memory-design.md#north-star-three-shelves).
The customer evidence is in the office protocols of 30 October, 6 November,
9 November and 10 November 2026, and in backlog ticket 81.
