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
* One statement must be able to remove everything kept about one person, for
  the day the product erases an account. It has no such path today (see
  Consequences).

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

Four rules complete the decision:

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
4. **The personal block reaches a turn only when the asker alone reads the
   answer.** An answer in a shared conversation is read by other people, so a
   personal note in the prompt could surface in front of them. The turn context
   delivers the block when the turn has no conversation, or when the
   conversation is the asker's alone: private, created by them and granted to
   nobody else, or not created yet. In any other conversation it is null, and
   it is null when the audience could not be read. Writing is not narrowed the
   same way. A note about the person is still kept from a shared conversation,
   because the store it goes to is read by them alone.

### Consequences

* Good, because privacy of a personal note is a database property, tested in
  `task db:test:rls`, and not a convention twelve modules must keep.
* Good, because a person can now be told one checkable sentence: "Nur du
  siehst das. Auch Administrator:innen nicht."
* Good, because the writer's refusal for a temporary conversation covers every
  present and future agent-side writer that names its conversation. The two
  cases it does not cover are listed under Confirmation.
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
* Bad, because in a shared conversation the agent answers without what it
  knows about the asker. It can still save a note there and cannot use one
  until the person asks in a conversation of their own.
* Bad, because nothing erases a person's notes when the person leaves the
  office or asks for erasure. The product has no account-erasure and no
  member-removal path of its own: people are removed in the WorkOS Users
  Management widget (`ui/features/organization/components/people-directory.tsx`),
  which talks to WorkOS from the browser, and no WorkOS webhook route tells
  the application. The deletion queue's entity types include
  `user`, but nothing enqueues one and the purger has no handler for it
  (ADR-0011 lists it as a follow-up), and `user_preferences` has no delete
  either. `deleteAllPersonalMemory` (`bff/personal-memory/repository.ts`)
  removes every note of one person in one statement and is tested under
  row-level security. The person's own „Alle Notizen entfernen“ calls it
  (`clearPersonalMemory`, `DELETE /api/user/memory`); nothing calls it for a
  person who leaves. Until something does, their notes outlive their
  membership, readable by nobody the application serves and still in the
  database.

### Confirmation

Paths are relative to `apps/workspace` unless they start with `packages/`.

What holds the store and its promise:

* `bff/db/rls-coverage.spec.ts` fails a table without `secure_table`.
* `bff/personal-memory/personal-memory.integration.spec.ts` (in
  `task db:test:rls`, as the runtime role) writes a note as one person and
  reads, updates and deletes as another in the same organization, with
  statements that name no user, and reaches nothing. It also refuses a row
  written for somebody else, and a memory write from a temporary conversation.
* `scripts/rls-test-db.sh` checks migrations 0229, 0230 and 0231 one at a
  time: the policy names the person, the CHECKs and the unique index refuse,
  and each down migration reverses and applies again.
* `bff/personal-memory/service.spec.ts` holds the bounds of the block (20
  notes, 1,500 characters, the footer that counts what was left out) and the
  dedup. `app/api/user/memory/route.spec.ts` and
  `app/api/user/memory/[itemId]/route.spec.ts` hold that the owner is the
  session's person and never a body field.
* `app/api/internal/personal-memory/route.spec.ts` holds that the agent's
  write takes its owner from the signed envelope, and that a missing envelope
  is a 401.

What holds rule 2, a temporary conversation keeps nothing:

* `bff/conversations/temporary.spec.ts`, `app/api/internal/memory/route.spec.ts`
  and `app/api/internal/personal-memory/route.spec.ts` refuse the write with
  403 `TEMPORARY_CONVERSATION`. `app/api/conversations/[id]/temporary.route.spec.ts`
  holds that only an owner switches the flag.
* `packages/agent/tests/memory/test_register.py` and
  `packages/agent/tests/stages/test_memory_reflection_stage.py` hold the
  agent-side skips. `packages/agent/tests/knowledge/test_personal_memory.py`
  maps the refusal to the named error.

* `app/api/proposals/[id]/route.spec.ts` holds that accepting a `memory`
  proposal made in a temporary conversation is refused with the same 403,
  writes nothing and leaves the proposal open (`applyMemory` in
  `bff/proposals/appliers.ts` calls `requireConversationKeepsMemory`), and
  `ui/features/cards/components/ProposalReceipts.spec.tsx` that the card says
  why.
* `bff/jobs/background-run.spec.ts` holds that a run submitted from a
  temporary conversation says so to the worker (`temporary_conversation`), and
  `apps/agent-host/tests/test_agent_job_phases.py` and `test_skill_submit.py`
  that the worker then skips the reflection before any model call, names the
  skip in its log and marks the run's workflow span.

What holds rule 4, the block only where the asker alone reads the answer:

* `app/api/internal/turn-context/route.spec.ts` delivers the block in a solo
  conversation and on a turn without one, and answers null in a shared
  conversation and when the audience cannot be read.
* `test_personal_memory_prompt.py`, among the chat agent's tests under
  `packages/agent/tests/agents/`, holds that the block is rendered into the
  chat prompt only, and
  `test_memory_reflection_stage.py` that a personal note never rides the
  stage's frame, which is stored on a message other people read.

What holds rule 1 on the agent side:
`packages/agent/tests/memory/test_reflection.py` drops a person finding that
has no envelope instead of moving it to the project, and drops a `preference`
with no usable `about`.

What holds that a save shows on its answer, with who reads it and a way to
take it back:

* `packages/agent/tests/stages/test_memory_reflection_stage.py` holds that the
  stage's frame lists the project and organization notes the `remember` tool
  created during the answer beside reflection's, that a turn with such notes
  gets its frame where reflection itself is declined, that a note the BFF only
  refreshed is left off, and that a pass which kept only personal or restated
  notes ends empty and says which (`personal_notes_only`,
  `restated_notes_only`).
* `bff/conversations/message-stages.spec.ts` bounds the frame as the server
  stores it: at most twelve items, closed values for `provenance`, `scope` and
  `restricted`.
* `app/api/internal/memory/route.spec.ts` holds that the write answers
  `created`, and `app/api/user/memory/route.spec.ts` that the owner's list can
  be narrowed to one conversation (`sourceConversationId`).
  `bff/personal-memory/personal-memory.integration.spec.ts` stores a note with
  the answer it was saved under (`source_message_id`, migration 0231) and
  reads it back as its owner only.
* `ui/features/chat/lib/turn-memory.spec.ts`,
  `ui/features/chat/stores/turn-notes-store.spec.tsx` and
  `ui/features/chat/components/MemoryNotedChip.spec.tsx` hold what the chip
  shows: each note with its audience, a personal note only under the answer
  whose id it carries, the remove action on a project note only when
  `GET /api/projects/{id}/memory` answered `canWrite`, and no remove action on
  a note that replaced an older one.
* The frame is stored on its answer by the server too, so a save made after
  the person left the chat still shows under its answer.
  `app/api/internal/conversations/[id]/messages/[messageId]/stages/route.spec.ts`
  holds that the write takes its organization from the signed envelope, must
  name the envelope's conversation and accepts only `memory_reflection`;
  `bff/conversations/service.spec.ts` ("the memory frame written by the
  browser and by the agent tier converges") that the browser's PATCH and this
  write store the same metadata in either order, without duplicating an item
  or touching another key; `packages/agent/tests/stages/test_durable_frame.py`
  that the stage sends it with the turn's envelope, waits for the answer row,
  gives up with a named reason, and never fails the stage.

Nothing enforces these yet:

* **The model's choice between personal and project.** The tool description
  and the reflection prompt say which is which. `task be:eval:memory-shelves`
  (`scripts/memory_shelves_eval/`, 70 labelled exchanges in
  `tests/fixtures/memory_shelves/cases.yaml`) measures what the model does
  with them, through the production reflection pass and the production
  `remember` tool. It has not been run against a model: the provider account
  in the build environment had no credit on 2026-11-11. It needs a key, so no
  CI job runs it, and no number exists yet. Until one does, review and the
  person's own eye are the gate.
* **A save in a turn whose stage did not run.** The notes of a turn reach its
  answer on the `memory_reflection` frame. With the office's
  `memory-reflection` flag off, or no model resolved for the stage, the stage
  ends as `disabled` before its handler (`_pre_run_outcome` and
  `_schedule_one` in `packages/agent/src/agent/stages/runner.py`). A note the
  `remember` tool wrote in that turn is stored and shows on no answer. A turn
  whose socket was closed when the frame was sent is covered since
  2026-11-11: the stage stores the frame itself
  (`PATCH /api/internal/conversations/{id}/messages/{answerId}/stages`). It
  still shows on no answer when that answer's row never appears within about
  fifteen seconds (a turn fenced off by a newer one) or the turn carried no
  envelope; the stage then logs and traces the reason
  (`stage:memory_reflection:durable`). The note is in the project's memory
  panel either way.
* **The frame on the message is not checked against `project_memory`.** Both
  of its writers, the browser that received it
  (`PATCH /api/conversations/{id}/messages/{messageId}`) and the stage, are
  bounded by `sanitizeStages` and nothing more. A collaborator of a
  conversation can therefore put a note's words on an answer that the turn
  never wrote. It changes nothing in memory, and removing such a row is
  decided by the note's own route.
* **The answer a personal note is shown under.** The agent names it
  (`sourceMessageId`), and the signed envelope carries the conversation and no
  turn, so the BFF cannot check it. The id only chooses under which of the
  owner's own answers their own note appears.
* **A personal finding on a research run.** `_reflect` in
  `apps/agent-host/src/agent_host/jobs/runner.py` calls the reflection pass
  with no envelope, so a finding about the person is dropped on a research
  run.
* **A run whose conversation becomes temporary after its submit.** The worker
  knows the flag as of the submit (see Confirmation). A conversation switched
  to temporary while the run is going is reflected on, and its writes are
  stopped only by the BFF's refusal, after the model call was paid for, with
  one warning per finding from `_record_findings`
  (`packages/agent/src/agent/memory/reflection.py`), which swallows the named
  refusal.
* **The browser-written memory card, on the server.** A `memory_proposal` card
  without a `proposal_id` (an answer older than server proposals, or a
  proposal the agent could not store) posts to `/api/organization/memory` or
  `/api/projects/{id}/memory`, the memory panels' own routes, which are not
  told the conversation. The card refuses in a temporary conversation
  (`MemoryProposalCard.test.tsx`); a request that does not come from the card
  is a person's manual note and is kept.
* **`POST /api/internal/memory` without `sourceConversationId`.** The route
  judges the flag on the conversation the body names. A project or
  organization write that names none is kept. The personal route does not
  have this gap: it also judges the envelope's conversation.
* **Erasure of a person's notes when they leave**, as said under
  Consequences. The person can remove their own (`DELETE /api/user/memory`,
  „Alle Notizen entfernen“); nothing does it for them. The first step is a
  WorkOS webhook route that tells the application a membership ended, because
  the removal happens between the browser and WorkOS.

## More Information

The north star this serves, and the slices still open, are in
[`project-memory-design.md`](../architecture/project-memory-design.md#north-star-three-shelves).
The customer evidence is in the office protocols of 30 October, 6 November,
9 November and 10 November 2026, and in backlog ticket 81.

Open gap: erasing a person. When the product gets an account-erasure or
member-removal path (the `user` purger ADR-0011 leaves open), that path must
call `deleteAllPersonalMemory` for the person in each organization, and
`user_preferences` needs the same. Until then this record's driver about
erasure is met by the store's shape and by nothing that runs.

## Amendment (2026-11-12): topics

The three shelves say who reads a note. A **topic** says what the note is about:
"Brandschutz", "Stellplätze", "Bauherr". Every note on the personal shelf and on
the project shelf may carry one, and the screens show a shelf as folders by topic.
The shelf is still the reader's, so a topic never crosses a shelf: "Brandschutz"
on Mein Gedächtnis and "Brandschutz" on a project shelf are two topics.

- **A column, not a table.** `topic` is a nullable text column on
  `personal_memory` and `project_memory` (migration `0237_memory_topics`), with a
  CHECK of 1 to 40 characters without outer spaces. No topics table, no foreign
  key, no new row-level-security policy: the note's policy covers its topic, so a
  topic a reader may not see is not shown to them. A table would give a topic its
  own rows to share and secure, which is the cost this avoids. `null` is "no topic".
- **One normal form.** `bff/memory-topics/topic.ts` is the only place that trims,
  folds the Unicode form (NFC) and counts. `resolveTopic` returns the spelling the
  shelf already has when one matches case-insensitively (German rules), so
  "brandschutz" lands in "Brandschutz". Every write goes through it: create,
  update, rename, the agent's `remember` tool and the reflection.
- **Counts come from the notes the reader sees.** A list answers
  `topics: { name, count }[]`, counted in TypeScript over the items the reader may
  see, most notes first. Never counted in SQL over the table: a restricted note's
  topic must not reveal the note to a reader who may not see it. The project
  shelf's count covers the whole shelf the reader sees, not only the page.
- **Rename, merge, ungroup on both shelves; removal only on the personal shelf.**
  `PATCH …/memory/topics` moves the notes on one topic to another; a name another
  topic already has merges the two, and `null` ungroups. The personal shelf also
  has `DELETE …/memory/topics`, which removes every note of the person on a topic,
  for good, because those notes are the person's own. The team shelf has no
  removal of a topic: a team's notes are removed one by one, as before.
- **The agent files notes under topics and reads them through an index.** The
  `remember` tool and the reflection carry an optional `topic`, one to three words
  naming a subject ("Brandschutz", not "Entscheidung"), reusing a topic the shelf
  already shows. The personal block opens with a bounded topic index and groups
  its lines by topic. The project digest opens with a bounded topic index too:
  the shelf's open topics, plus the topics of the restricted notes the turn
  admitted and printed, so a restricted topic no admitted note carries is not
  named. It tags each line with its topic and keeps recall order; it does not
  group its lines into sections. A shelf without any topic is rendered exactly
  as before.

Not done: a topic cannot be ordered or coloured by hand; a topic is not a
shelf of its own, so one name on two shelves is two topics; a person cannot
rename a topic on the team shelf from the personal one; the topic a model picks
is not reviewed by a person beyond what reflection already does for the note.
