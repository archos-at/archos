---
status: proposed
date: 2026-11-24
decision-makers: product owner, engineering
consulted: Jira KAN-90
informed: everyone who builds on the office shelf, the deletion pipeline and the Papierkorb
---

# The Bürobibliothek has its own Papierkorb: the project bin's code over a shelf

## Context and Problem Statement

ADR-0088 gave a project folder a Papierkorb (migration 0115) and kept the office shelf's
folders out of it: an office shelf folder re-filed what it held into its parent and its
row went, and an office shelf document was erased at once (`deleteOfficeShelfDocument`).
`project_folders_bin_state_check` refused `deleted_at` on any folder but a project's.
KAN-90 asks for the Bürobibliothek what the project Ablage has: a bin glyph in the head
that opens the same window, a deleted folder or document restorable for 14 days, then
purged.

The project bin's code took a bare `projectId` everywhere: the bin lock was keyed by the
project, every repository query named `project_id`, the authorization was the project's
folder access, the audit target the project.

## Decision Drivers

- One bin, not two: the owner asked for the project bin's code to be reused, not copied.
- The office shelf's own authorization: any member reads it, `org:office_shelf:manage`
  writes it (`requireShelfWrite`), and nothing finer exists there.
- A legal hold must keep an office shelf folder or document out of the bin and out of
  the purge.
- A person's own shelf („Meine Ablage“) keeps no bin (ADR-0193).
- Normen & Richtlinien keeps its own removal; a Thema's delete promises that no norm is
  deleted.

## Considered Options

1. The project bin generalised over the shelf: a `SharedShelf` (project or office shelf)
   in place of `projectId`, the differences in one policy per shelf.
2. A second bin for the office shelf beside the project's.
3. Soft-deleting office shelf rows with a column of their own and no queue entry.

## Decision Outcome

Chosen option 1.

- **The shelf is the bin's scope.** Every function of the bin
  (`bff/projects/folder-bin*.ts`, `document-bin.ts`) takes a `SharedShelf` instead of a
  `projectId`; the repository asks `shelfFoldersOf` / `shelfDocumentsOf`
  (`bff/documents/shelf.ts`), which name the project for a project and the organization
  and scope for the office shelf. A job payload and the queue row keep `projectId`,
  `null` for the office shelf, so a payload queued by the previous release still parses.
- **What differs is one policy per shelf** (`bff/projects/bin-shelf.ts`,
  `binPolicyOf(shelf)`): who may delete, restore and purge, how a subtree is checked,
  how a holder folder for one document is made, which collection a restored document is
  read into, and the audit actions. For a project it is what it was (the folder access
  of ADR-0088, `project:manage` to purge, the folder placement of ADR-0087). For the
  office shelf: `org:office_shelf:manage` deletes, restores and purges („Endgültig
  löschen“; these are the people who erased at once before), every member sees the bin,
  documents come back into the office shelf's collection, and the audit actions are
  `office_shelf.folder.binned`, `.restored`, `.purged` on the organization.
- **A legal hold refuses the office shelf's bin.** Binning an office shelf folder or
  document asks `assertNoActiveHold` first (409 `legal_hold`, nothing moved); the purge
  asks it before the derived steps and again before the first storage erase. The project
  folder bin keeps ADR-0088's rule (a hold defers the purge, not the delete); a project
  document's bin now refuses a hold too, as its permanent delete always did.
- **The migration (0264)** lets an office shelf folder hold the bin states
  (`project_folders_bin_state_check`), names a shelf's bin lock in one function
  (`shelf_bin_lock_key(scope, organization, project)`: the project's key unchanged, the
  office shelf's by its organization), and has the deleted-folder trigger take it, so
  nothing is filed into an office shelf folder while it goes to the bin (`GFD01`). A
  partial index serves the office shelf's bin listing.
- **A binned office shelf document is hidden** from the shelf's reads by
  `shelfDocumentWhere` (`outsideTheBin`), from a read by id (`getAccessibleDocument`,
  `findOfficeShelfDocument`), from search and from the BIM model list; its chunks leave
  the index in the request, as a project's do, and a restore reads them again.
- **Normen & Richtlinien.** A Thema (a folder under „Grundlagen des Büros“) is deleted as
  before: its norms and subtopics move up. A norm is not binned: a document filed under
  that root, or one that is a listed edition, and a folder holding one, answer 409
  `norm-has-no-bin`; a norm leaves through its entry („Entfernen“), which erases it as
  before. A project's reference to an office shelf copy that lies in the bin reads as
  `removed` until it is restored; the purge then sets the key to null as a delete did.
- **What was derived** from a purged office shelf folder (answers, notes, reports) is
  not marked or removed: the organization's setting „Inhalte aus gelöschten Ordnern“
  rules project folders (ADR-0088), and the office shelf's permanent delete never had it.

Option 2 was rejected because the bin is about 1,000 lines of service, repository, jobs
and purge whose rules (the claim token, the takeover job, the restore job, the hold
re-checks) would have to be kept in step twice; it rests on the two shelves' differences
fitting in a policy object, which they do today. Option 3 was rejected because it would
be a second deletion pipeline with no queue row, purger or record of the erasure.

### Consequences

- Good: the office shelf's delete becomes restorable with no new table, route shape or
  purger code; the purger already claims every `entity_type = 'folder'` row.
- Good: the purge re-checks the hold right before its first storage erase, for projects
  too.
- Bad: deleting an office shelf folder no longer re-files its contents; whoever relied on
  that now restores the folder instead.
- Neutral: an agent's `DELETE /api/documents/{id}` on an office shelf document still
  erases at once, as it does for a project document.

### Confirmation

`bff/projects/office-shelf-bin.integration.spec.ts` (in `task db:test:rls`): binning,
hiding, the bin lock, the index effects, authorization, the hold refusals, restore,
purge and the norms. `bff/projects/document-bin.spec.ts`, `bff/documents/shelf.spec.ts`
and the project bin's integration suites hold the generalisation.

## More Information

Supersedes the sentence of ADR-0088 that an office shelf (Archiv) folder has no bin.
The whole pipeline: [`deletion-pipeline.md`](../architecture/deletion-pipeline.md).
