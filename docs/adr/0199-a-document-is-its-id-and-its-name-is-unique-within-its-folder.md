---
status: accepted
date: 2026-11-26
decision-makers: product owner (Matthias)
consulted: feld72's upload of a 1,881-file project folder, of which 496 files were refused
informed: everyone who builds uploads, moves, the index, citations or an agent's file operations
---

# A document is its id, and its name is unique within its folder

## Context and Problem Statement

A project held one live document per file name, whatever the folder
(`uniq_documents_live_name_per_collection`, migrations 0074, 0083, 0243, 0246),
and the name was the key that tied the three systems together: the BFF row, the
chunks in the index (`file_name`), the backend's `document_metadata` row, the
citation key and the agent-host routes `/v1/collections/{c}/documents/{file_name}/…`.

An office's file server does not work that way. Every project tree has
`Bestand/Grundriss EG.pdf` and `Entwurf/Grundriss EG.pdf`. feld72 dropped a
1,881-file project folder into a project: the upload plan refused 496 files with
„teilen sich einen Namen mit einer anderen Datei in diesem Upload“, about 250
documents never arrived, and the warning's list was clipped and ended in „+490“
with nothing to copy. The rule was ours, not the office's, and a name that is a
key cannot be allowed to repeat.

## Decision Drivers

- A folder tree from a file server must arrive whole, with its folders.
- Two documents of one name are two documents: each ingests, is searched, cited,
  opened, tagged, moved and deleted on its own.
- A same-name upload into the same folder stays what it is today: the next
  Fassung of the document there (ADR-0054).
- Nothing already indexed is re-embedded: the chunks already carry `document_id`
  (`knowledge_layer/vector_store/writes.py`) and the storage keys contain it
  (`bff/s3.ts`).
- Nothing is replaced without a person deciding it, the agent included.

## Considered Options

1. Keep one name per project, and help the person rename before the upload.
2. Make a name unique per folder, compared exactly (case- and form-sensitive).
3. Make a name unique per folder, compared as the Finder and Explorer compare it
   (NFC, trimmed, case-insensitive), and address every user document by its id.
4. Drop the name rule entirely: any folder may hold the same name twice.

## Decision Outcome

Chosen option 3, because it is the rule the office's own file system already
holds the tree to, so a dropped tree never meets a rule it did not meet at home,
and because only an id survives a rename, a move and a namesake in another
folder.

1. **Identity is `documents.id`.** Wherever a user document is addressed (the
   ingest's previous-version lookup, its replacement lock and fact copy, the
   backend's metadata rows, the chunk filters of read, outline and folder cards,
   the agent-host edit routes, `GET /api/internal/document-file`, citations and
   the source preview, `look`, drawings and the canvas), it is addressed by id.
   The name is the label and the folder is where it lives; both may change. A
   caller that still names a document by name alone gets it only while one live
   document of the collection holds that name; two are a `409`
   (`ambiguous_name`), never the newest. The base corpus (OIB, RIS) has no
   document row and keeps its names.
2. **A name is unique within its folder.** The project root counts as a folder,
   and so does a shelf without folders (a chat's attachments, which therefore
   keep one document per name). A document holds a name when the name's match
   key equals the key of its `filename` or of its rename (`display_name`). The
   key is `documentNameMatchKey`: NFC-normalised, trimmed, lower-cased.
3. **Fassungen are per folder.** The same name in the same folder is a
   replacement and becomes a new Fassung of that document. The same name in
   another folder, or in another collection of the project, is a different
   document and never a Fassung.
4. **A clash is resolved as the Finder resolves it.** An upload or a move into a
   folder that holds the name answers `409` with
   `{ reason: 'name_conflict', name, folderId, existingDocumentId, existingName,
   suggestedName }` until the request says `onConflict`:
   - `replace` („Ersetzen“): the incoming file becomes the next Fassung of the
     document already there, which keeps its id. A moved document's current
     file becomes that Fassung and the moved document goes to the bin.
   - `keep_both` („Beide behalten“): the incoming document takes the next free
     name in that folder, `Plan.pdf` → `Plan 2.pdf` → `Plan 3.pdf`
     (`nextFreeDocumentName`); a name without an extension becomes `Plan 2`.
   - `skip` („Überspringen“): nothing changes, and the answer names the
     document that is there.
   The dialog offers the three per row and „Für alle anwenden“ for a batch, and
   every conflict list wraps, shows every entry and can be copied. A rename onto
   a name the folder holds is refused inline in the rename field. A restore from
   the Papierkorb into a folder that holds the name keeps both. In one drop,
   equal names in different relative folders are no conflict at all; equal match
   keys in the same relative folder are one conflict group the person resolves.
5. **An agent meets the same rule as a typed conflict.** A file operation names
   its document by id (or by a name only when one document in the project holds
   it); a move or rename onto a held name comes back as a conflict for a person
   to decide, never as a proposal that replaces.
6. **The database is the backstop for a race, not the judge.** 0271 rebuilds
   `uniq_documents_live_name_per_collection` on `(organization_id,
   collection_name, coalesce(folder_id, nil uuid), lower(normalize(btrim(filename),
   NFC)))` with 0246's predicate. `lower()` folds what the database's `LC_CTYPE`
   folds, and under the C locale (which `scripts/rls-test-db.sh` initialises,
   and which the index comment records for production) that is ASCII only:
   `Plan.pdf` and `plan.pdf` collide in the index, `Änderung.pdf` and
   `änderung.pdf` do not. The BFF's key folds all of Unicode and refuses both
   first. We take no ICU collation for this.
7. **It ships in two deploys.** Deploy 1 makes every reader and writer id-aware
   while still reading the name-keyed shapes, and its `after-switch` backfills
   give every metadata row and every chunk of a live user document its id
   (`document-metadata-document-id`, `qdrant-document-id-stamp`). Deploy 2 widens
   the index (0271) and switches the BFF and the UI to the naming rule. Deploy 2
   merges only after both backfills report `after` 0 on that environment:
   before that, a name-keyed row or chunk could no longer tell two namesakes
   apart. The order, the gate and the rollback of each step:
   [`documents-unique-per-folder-runbook.md`](../deployment/documents-unique-per-folder-runbook.md).

### Consequences

- Good, because a project tree from a file server arrives whole: 250 name pairs
  across folders upload as 500 documents, and the feld72 tree as 1,881.
- Good, because a rename, a move and a namesake no longer change what a
  citation, a tag, a Fassung link or an agent's operation points at.
- Good, because nothing is re-embedded: the id was already on the chunks and in
  the storage keys.
- Good, because no replacement happens that a person did not choose, from the
  app or from an agent.
- Bad, because the index's case fold is ASCII only, so for non-ASCII letters the
  rule holds only as long as every writer goes through the BFF's key; a race
  between two uploads of `Änderung.pdf` and `änderung.pdf` into one folder can
  leave both.
- Bad, because folders do not follow the same rule yet: `uniq_project_folders_parent_name`
  (0063) is exact, and only the upload's folder walk compares case-insensitively
  (`folderMatchKey`). A folder may hold `Pläne` and `pläne`; documents may not
  hold the equivalent.
- Bad, because a name-only caller (an old message, a backfill that knows only a
  name) now gets `409 ambiguous_name` where it used to get a document, and must
  carry the id.
- Bad, because the rollout is two deploys with a gate between them, and rolling
  back deploy 1 after its re-key needs the metadata tables' old key restored by
  hand (the runbook says how).
- Neutral, because the base corpus keeps name identity: it has no document row
  to carry an id.

### Confirmation

- `scripts/rls-test-db.sh` (block „0271“, run by `task db:test:rls`): the guard
  refuses a folder holding two names that differ only in case, form or
  whitespace and lists them, deduplicating nothing; the index takes one name in
  two folders and refuses `plan.pdf` beside `Plan.pdf` in one folder, and a case,
  whitespace or decomposed variant at the root; the down file restores 0246's
  index and refuses while a collection holds a name in two folders.
- `bff/documents/name-per-folder.integration.spec.ts` (Postgres): one name in two
  folders, a `409 name_conflict` for another case or form at the root, the Finder
  suggestion, a move that asks first and keeps both when told, a raw move
  refused by the index, a delete of one namesake that leaves the other.
- `ui/features/documents/lib/folder-upload-plan.spec.ts`: 250 name pairs across
  two folders plan 500 uploads with no question; the feld72 tree plans 1,881.
- `tests/knowledge_layer_tests/test_same_name_documents.py` and
  `test_browse_namesakes.py`: two namesakes ingest into their own chunks and
  metadata rows, re-ingest and delete only their own, list, read and filter as
  two. `packages/agent/tests/citations/test_document_identity.py`: a citation of
  each stays its own source. `packages/agent/tests/tools/files/test_document_ids.py`:
  a bare shared name is a question, a move onto a held name is a conflict and no
  proposal.
- `packages/knowledge-layer/tests/test_registered_backend_backfills.py`: both
  backfills' dry run, `--apply` and `--check`, twice, with `--check` failing while
  a row or a point is left.
- Not enforced: that a new caller addresses a user document by id rather than by
  name. Review is the only gate; `findLiveDocumentByFilename` answering one
  folder and `document-file` answering `409` for a shared name make the mistake
  visible rather than silent.

## Pros and Cons of the Options

### Keep one name per project

- Good, because nothing changes underneath.
- Bad, because it refuses what every office's file server already holds, so a
  tree of hundreds of repeated names cannot arrive without a person renaming
  each file first: 496 of 1,881 at feld72.

### Unique per folder, compared exactly

- Good, because the index could compare the plain column.
- Bad, because the office's file systems (APFS and NTFS by default) treat
  `Plan.pdf` and `plan.pdf` as one file, so a folder could hold two files the
  person cannot tell apart, and a Mac's decomposed `ä` would make a second
  document beside the first.

### Unique per folder, compared as the Finder compares (chosen)

- Good, because a tree that existed on disk always fits.
- Bad, because the index's fold is only as good as the database's `LC_CTYPE`
  (ASCII under C), which the BFF's key covers in the ordinary path only.

### No name rule

- Good, because no conflict is ever asked.
- Bad, because two files of one name in one folder cannot be told apart in a
  listing, a path, a citation chip or a person's question, and a re-upload of a
  corrected file could no longer become its Fassung by name.

## More Information

- Amends ADR-0054 (the filename namespace: a filename is no longer the index's
  join key), ADR-0071 (a chunk's `file_name` is no longer what a purge or a
  citation joins on), ADR-0078 and ADR-0085 (a name is unique per folder, not per
  collection or project) and ADR-0104 (the index knows a user document by its id,
  not by its name). Each carries a note where it states the old rule.
- Revisit the ASCII-only fold if production moves to an ICU or UTF-8 `LC_CTYPE`,
  or if a race between non-ASCII case variants is ever observed; then the index
  can fold what the BFF folds.
- Follow-ups not in this decision: folder names under the same comparison as
  documents (create, rename and the index); the permit record's name fallback
  (`bff/permits/repository.ts`) and inbound mail's and the mail thread's name
  probes, which still take the first match by name.
