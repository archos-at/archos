---
status: proposed
date: 2026-11-19
decision-makers: engineering
consulted: the office standards click dummy (Büroablage, Normen & Richtlinien)
informed: everyone who builds on the office shelf, base knowledge and proposals
---

# A project norm goes to the office shelf as a copy, and the project keeps a reference

## Context and Problem Statement

An office's own norms (bought ÖNORMs, directives, commentaries, guidelines) belong in the
Büroablage, where every project finds them as base knowledge (ADR-0163). In practice they
are uploaded into a project first, where only that project's team sees them. The office
wants such a norm moved into the Büroablage, the project to keep a pointer where it lay,
and someone without the right to manage the Büroablage to be able to suggest it.

A document's shelf is not a column one update can change. `documents.scope`, `project_id`
and `folder_id` are tied by a composite foreign key to `project_folders`, and
`document_versions`, `document_roles` and three mail tables reference
`documents (id, project_id)` with no `ON UPDATE` action (migrations 0067, 0082, 0196).
`move-to-folder.ts` therefore keeps every move inside one shelf.

## Decision Drivers

- The move must not loosen any of those keys or leave a project fact pointing at a document
  that left the project.
- The Büroablage copy must enter through the same door as any base-knowledge upload:
  screening, quota, the entry proposal recorded before the dispatch, its text held until a
  person confirms it (ADR-0163).
- Widening a file's visibility from a project team to the whole office is the person's
  explicit act.
- A reference must survive the removal of the Büroablage copy, and say that it was removed.

## Considered Options

1. Move the row in place: rewrite `scope`, `project_id`, `folder_id` and `collection_name`
   and the referencing tables in one transaction.
2. Copy the bytes into the office shelf through the base-knowledge upload, move the project
   file to the project's bin, and keep a reference row in the project folder.
3. A reference only: leave the file in the project and list it in the Büroablage.

## Decision Outcome

Chosen option 2.

- **Moving** (`bff/office-shelf/project-norms/move.ts`) needs org:office_shelf:manage and
  write access to the file and its folder. It reads the file's stored bytes
  (`documents/stored-copy.ts`, exempt in the download log: nobody receives them) and files
  them with `uploadBaseKnowledge`, or with `addBaseKnowledgeEdition` when the office shelf
  holds the work in another edition. When it holds that edition already (same edition label,
  or the same bytes), nothing is copied. The project file goes to the project's bin
  (`moveDocumentToBin`), so the move can be undone from there; if that fails, the copy is
  removed again. The search index follows the two existing doors: the copy is not read until
  its entry is confirmed, and the bin takes the project file out of retrieval.
- **The reference** is a row in `office_shelf_references` (migration 0250): the project, the
  folder, the project file it replaced, the copy in the office shelf, the file name and how it
  was placed (`moved`, `edition`, `duplicate`). The copy's key is
  `ON DELETE SET NULL (office_document_id)`, so removing the copy from the Büroablage keeps
  the row and the project shows it as removed. While the copy is there, the project's line
  opens its entry in Normen & Richtlinien.
- **„Hier lassen“** is a row in `office_shelf_norm_keeps`, per document, deleted with it.
  Nothing offers that norm for the Büroablage again.
- **Suggesting** is a proposal of the new kind `office_shelf_norm` in the project, proposed
  by the person. Its inbox item `office_shelf.norm_suggested` goes to everyone who may decide
  it: org:office_shelf:manage, write access to the project and to the file's folder. Deciding
  needs the same (`requireDecider`); accepting runs the move as the person who accepts. A
  declined suggestion keeps the norm out of the offers, as „Hier lassen“ does.
- **The offer**: a settled project file that `recognizeNorm` reads as a norm, whose work the
  office shelf does not hold, not kept and not suggested. The project's files show it as a
  banner per folder; after an upload settles, the uploader gets `office_shelf.norm_offered`.
- **The API** is one route, `/api/projects/[id]/norms`, with the operations
  `project-norm-list` and `project-norm-place`. Both office destinations require
  `visibility: "office"` in the body.

Option 1 was rejected because the referencing keys have no `ON UPDATE` action and each
referencing table holds facts (versions, roles, mail filings) that belong to the project; it
rests on the schema of migrations 0067, 0082 and 0196, and is worth reopening if those keys
gain a cascade and those facts a meaning outside the project. Option 3 was rejected because
the file would stay readable only by the project team, while the Büroablage promises every
project.

### Consequences

- Good: no foreign key, row-level security policy or shelf invariant changes; the copy is an
  ordinary base-knowledge entry with its own lifecycle.
- Bad: the copy has a new document id. Old citations and marks on the project file stay with
  the binned file, not with the copy.
- Bad: the bytes are stored twice until the project bin is purged.
- Bad: the move is not one transaction. A failure between the copy and the bin is
  compensated by removing the copy; a failure of that removal is logged and leaves both.
- Neutral: a project-side norm confirmation does not exist yet; the offers rest on the file
  name read by `recognizeNorm`. `confirm: true` confirms the entry with the values the person
  saw in a norm dialog.

### Confirmation

`bff/office-shelf/project-norms/repository.integration.spec.ts` (in `task db:test:rls`): the
reference outlives the copy and reads as removed, a kept norm goes with its document, and
another office reads and writes neither table. The move, suggestion, offer and decider specs
beside the code.
