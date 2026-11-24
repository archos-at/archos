---
status: proposed
date: 2026-11-24
decision-makers: product owner (Matthias)
consulted: the survey of chat scope and sharing, [`docs/audit/chat-scope-and-sharing-2026-11.md`](../audit/chat-scope-and-sharing-2026-11.md); the „Mein Bereich“ concept (ticket 81)
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
   owner on the row, and the upload pipeline, folders, listing, filing,
   ingestion and deletion run unchanged against it. Only its owner reads or
   writes it, held by a per-user row-level policy as `personal_memory` is, not
   by the app layer alone. Leaving the office treats it as personal memory is
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
5. **Using something personal is recorded on the chat, and widening asks.** When
   a turn draws on the personal shelf or on personal memory, the chat records
   it, as `conversation_source_projects` records a project. Sharing a chat that
   carries the record asks its owner first and says what the others will see:
   the answers, never the files. Once shared, the chat draws on neither any
   more, as rule 4 of ADR-0180 already holds for memory.

## Consequences

* One rule covers files and memory: whose reach a source has, and who reads the
  chat. A shared chat behaves the same whatever personal material its owner has.
* The project of a turn is fixed by the server; a chat continued from another
  page no longer reads that page's project.
* The rail gains the switch between „Persönlich“ and „Projekt“: under
  Persönlich, a new chat, „Meine Ablage“ and the chats without a project.
* Out of scope here and kept possible: attaching a personal file to a project
  chat, filing a personal file into a project („In Projekt ablegen“), moving a
  chat into a project.

### Confirmation

Specs hold each rule: the personal shelf refuses every reader but its owner
(also at the database, by a row-level spec); a turn's collections follow the
conversation row whatever `projectId` the request carries; a project chat's
scope never contains a personal collection; widening a chat that carries a
personal record is refused until its owner confirms.
