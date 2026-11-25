---
status: proposed
date: 2026-11-24
decision-makers: product owner (Matthias)
consulted: the survey of chat scope and sharing, [`docs/audit/chat-scope-and-sharing-2026-11.md`](../audit/chat-scope-and-sharing-2026-11.md); how other products do it, [`docs/audit/shared-ai-context-elsewhere-2026-11.md`](../audit/shared-ai-context-elsewhere-2026-11.md); the „Mein Bereich“ concept (ticket 81)
informed: everyone who builds on documents, retrieval or chats
---

# A person's own shelf is drawn on only where its owner alone reads the chat

## Context and Problem Statement

An architect has work that belongs to no project yet, or to no one else: an
inquiry before it is a project, a competition entry, their own templates and
checklists, notes, a draft not ready for the team. Today it has nowhere to go:
a file lands in a project, in the office shelf, or as an attachment that lives
and dies with one chat.

„Mein Bereich“ adds a personal place beside the project: its own chats and its
own files („Meine Ablage“). The hard question is not the files but the answers.
If a person's files fed every answer they ask for, a project answer would rest
on sources the team cannot see, and an answer written while the person was alone
would be read by everyone once the chat is shared. The survey found that the
code already has the rule for this for restricted folders and other projects:
a chat draws only on what every reader may read, records what it drew on, and
refuses to widen its audience past that record. It also found two holes: the
project a turn searches is taken from the browser, and personal memory is used
without being recorded.

## Decision

1. **„Meine Ablage“ is a third shelf.** `DocumentShelf` gains
   `{ kind: 'personal'; userId }`, `documents.scope` gains `personal` with the
   owner on the row, and the upload pipeline, folders, listing, ingestion and
   deletion run unchanged against it. Filing suggestions skip it: the agent does
   not propose where a person's own files go. Background work that serves no
   person (ingestion settle, rendition, search projection, recovery sweeps)
   reaches its rows only as a named system reader, and the office's storage
   quota counts its bytes like any other shelf's. Only its owner reads or
   writes it, held at the database by a per-user predicate in the one permissive policy on
   `documents`, as `personal_memory`'s policy names the person, not by the app
   layer alone. Leaving the office treats it as personal memory is
   treated.
2. **The server decides what a turn may read, from the conversation row.** A
   chat with a project reads that project; a chat without one reads none, and
   the project the page has open is not a source. The client's `projectId` and
   `active_project_id` stop widening a scope.
3. **A chat without a project is personal.** It draws on the owner's shelf as
   well as what every chat draws on (base corpus, office shelf, its
   attachments, and the asker's projects where a question asks for them, as
   today).
4. **A project chat never draws on the personal shelf**, not even while its
   owner is alone in it. Project chats are the ones that get shared, and a
   project's answer stands on what the project can see. A personal file may
   later enter a project chat only by an explicit act (attaching it), recorded
   like a restricted folder. That act is not part of this decision.
5. **Using the personal shelf is recorded on the chat, and widening asks.** When
   a turn actually reads from the personal shelf, the chat records it, as
   `conversation_source_projects` records a project. Sharing a chat that carries
   the record asks its owner first and says what the others will see: the
   answers, never the files. Once shared, the chat draws on the shelf no more.
   Personal memory is not recorded: it reaches every solo turn in a conversation, so recording it
   would make every share ask. Once a chat is shared, the next turn no longer
   receives it (ADR-0180, rule 4); earlier answers may still reflect the owner's
   preferences, and that risk is accepted.

## Consequences

* One rule covers the shelf and memory: whose reach a source has, and who reads the
  chat. A shared chat behaves the same whatever personal material its owner has.
* The project of a turn is fixed by the server; a chat continued from another
  page no longer reads that page's project.
* The rail gains the switch between „Persönlich“ and „Projekt“: under
  Persönlich, a new chat, „Meine Ablage“ and the chats without a project.
* Out of scope here and kept possible: attaching a personal file to a project
  chat, filing a personal file into a project („In Projekt ablegen“), moving a
  chat into a project.

How the context is decided and carried is ADR-0194; this decision is its
fourth slice.

### Amendment, 2026-11-24: Persönlich starts empty

The product owner's requirement: Persönlich is new, so it is empty for everyone
when it launches. „The chats without a project“ above meant every row with
`project_id IS NULL`, which brought in each person's old chats from the former
start page and chats the agent API made without a project.

* A chat records at creation that it was started in Persönlich
  (`conversations.started_in_personal`, migration 0267; the browser sends
  `personal: true` with a chat without a project, and the server ignores it with
  a project; an upload that creates the chat before its create marks it the
  same way, and a document thread on the person's own shelf is marked when it
  starts). Every existing row is false. It is not inferred from a date. The
  agent API's `conversation-create` takes the same flag, so an agent marks a
  chat only when it asks to. `agent-ask-create` is the exception since
  2026-11-25: a question an agent asks for the person without a project starts
  in Persönlich unless it passes `personal: false`, because the person asked it
  through their agent as they would have typed it, and an unplaced ask was
  listed nowhere and never read their own shelf.
* Persönlich lists only chats started there: the rail's „Letzte Chats“, the
  Chatverlauf, the phone's Chats sheet and the agent API's `conversation-list`
  with `place=personal`. A chat without a project that was not started there is
  listed nowhere, not in an unscoped listing either, and search does not find
  it. It is not deleted: its owner can still read it by id through the agent
  API (`conversation-get`, `conversation-message-list`); the app has no page
  for it.
* „Alle Chats löschen“ under Persönlich deletes only chats started there.
* Such an unplaced chat does not draw on „Meine Ablage“: having no project does
  not make a chat personal (`may.personalShelf` is false for it).

### Amendment, 2026-11-24: A personal chat is read by its owner

The product owner's requirement: „Even if the backend does something wrong it
shouldn't be able to do this“. A chat without a project, and everything that
hangs on it, is read and written at the database only by its creator, by a
person who holds a grant on it, and by a named system reader (migration 0269),
as rule 1 holds „Meine Ablage“.

* The policy on `conversations` adds, for a row without a project,
  `created_by = current_user_id()`, a grant in `resource_shares`, or
  `current_system_reader() IS NOT NULL`. Every table that holds such a chat's
  content, name or record of what it drew on (its messages, read marks,
  restricted-use and source-project records, answer contexts, asks, votes,
  attachments and their upload batches) asks `personal_conversation_hidden`.
  Telemetry (usage, citations, profiler spans) and rows with an audience of
  their own (proposals, agent changes, project memory, grants, inbox items,
  mention requests) stay the organization's.
* A visibility of `organization` opens no chat without a project: chats offer
  `private` and `project` only, and the listing no longer honours it either.
* A grant on such a chat is written only by someone who may read it; removing
  one bumps the audience version past the policy.
* The background paths that act for the chat name their system reader: the
  agent host's internal routes (`agent-host`), the erasure (`conversation-erasure`),
  the memory checks (`conversation-memory`) and a run's ledger (`run-ledger`).
  An internal route that carries a verified person runs as that person.
* A request naming a chat it may not read is refused, never read as a new
  chat or as one that drew on nothing.

### Confirmation

Specs hold each rule: the personal shelf refuses every reader but its owner
(also at the database, by a row-level spec); a chat without a project refuses
everyone but its creator, its grantees and its system readers
(`personal-chat-rls.integration.spec.ts`); a turn's collections follow the
conversation row whatever `projectId` the request carries; a project chat's
scope never contains a personal collection; widening a chat that carries a
personal record is refused until its owner confirms.
