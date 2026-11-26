<!-- drop after release 2027-W02: the contract removes the name-keyed readers, the two backfills and this runbook together -->

# Documents unique per folder: two deploys and the gate between them

[ADR-0200](../adr/0200-a-document-is-its-id-and-its-name-is-unique-within-its-folder.md)
makes a document's name unique within its folder and addresses every user
document by `documents.id`. It ships as two pull requests, one deploy each, in
this order:

1. **Deploy 1, PR A „identity by id“.** Every reader and writer addresses a
   user document by its id and still reads the name-keyed shapes. Two
   backfills give every stored row and chunk its id. The Postgres index is
   unchanged, and so is what a person sees when uploading.
2. **The gate.** Both backfills report `after` 0 on the environment.
3. **Deploy 2, PR B „unique per folder“.** Migration 0271 widens the index to
   the folder, and the BFF and the UI apply the naming rule and the Finder
   conflicts.

The order holds because of what a name-keyed record means. Until 0271, a live
name is unique in its collection, so a metadata row or a chunk that carries only
a name still names one document, and the re-key can give it that document's id.
Once a second folder may hold the name, such a record could belong to either
namesake: the re-key refuses to guess (it counts the name as `unmatched`), and a
re-ingest or delete of either one takes the chunks of its name that carry no id.
So every record must carry its id before the first namesake exists.

Nothing in CI enforces this order for this change. Merging PR B and promoting it
are the two decisions this runbook gates.

## Deploy 1 (PR A): id-aware readers, and the backfills

What it ships:

- the agent-host routes `/v1/collections/{c}/documents/by-id/{document_id}/…`
  (`tags`, `display-title`, `folder-path`, `visual-details`, `file-name`), and
  document ids on `revision`, `revision-compare`, `revision-pages`,
  `knowledge-mark` and ingest (`revision_of_id`); the `{file_name}` routes stay
  for this release ([python-endpoints.md](../api/python-endpoints.md));
- in the BFF, `GET /api/internal/document-ids` (the backfills' source),
  `POST /api/documents/by-id` (the source preview), and `documentId` on
  `GET /api/internal/document-file`, whose name lookup answers `409`
  `ambiguous_name` when two live documents of the collection hold the name
  ([bff-routes.md](../api/bff-routes.md));
- citations keyed by `stored_document_id`, the index read and filtered by
  `document_id` (a chunk without one by its name), and `document_metadata` and
  `document_revision_retained` keyed by `document_id` (a row without one by its
  name) ([migrations.md](../database/migrations.md), the `document_metadata`
  section);
- two backfills in `apps/workspace/backfills/`, kind `backend`, phase
  `after-switch`, because they ask the BFF route this same release ships
  ([backfills.md](backfills.md)):

| Backfill | Writes | Its stores in `backfill.count` |
|---|---|---|
| `document-metadata-document-id` | `document_id` on every metadata row of a live user document, `superseded_by_id` and the ids in `revision_suggestion` beside the names; then drops the tables' `(collection, filename)` primary key | `document_metadata.document_id`, `….superseded_by_id`, `….revision_suggestion`, the same three of `document_revision_retained`, and `primary key (collection, filename)` |
| `qdrant-document-id-stamp` | `document_id` on every user-document chunk of the office collection that carries neither `document_id` nor `grid_document_id`. The base corpus is not touched | `office (<collection>)` |

The deploy runs each as dry run, `--apply`, `--check`, and the Job fails while
`--check` finds anything left, so a deploy 1 that went green has already
reported `after` 0. The primary key goes last, in the backfill and not in the
schema code, because a pod one release old upserts `ON CONFLICT (collection,
filename)` until the rollout is over (the gotcha under „ON CONFLICT
specification“ in [gotchas.md](../contributing/gotchas.md)).

`unmatched` is counted: a row or a chunk of a name no live document holds
(left by a document deleted earlier) or of a name two live documents hold. The
first never fails. A chunk of the second is also counted as `unmatched_held`,
and the stamp's `--check` fails while there is one: neither namesake can claim
it, and the next replace of either would take it over. Before deploy 2 the
second cannot occur within a collection; a row the BFF lists under no id stays
name-keyed, as the base corpus does.

**Rollback.** Roll the images back ([rollback.md](rollback.md)). The new columns,
indexes and chunk fields are additive, and the build before ignores them, with
one exception: once `document-metadata-document-id` has dropped the
`(collection, filename)` primary key, that build's metadata writes fail with
`there is no unique or exclusion constraint matching the ON CONFLICT
specification`. Put the key back in the backend's metadata database
(`SUMMARY_DB`) before the old pods take traffic. It is a write to a shared
database, so the person on call for the environment runs it:

```sql
-- read-only first: both must return no rows
SELECT collection, filename, count(*) FROM document_metadata GROUP BY 1, 2 HAVING count(*) > 1;
SELECT collection, filename, count(*) FROM document_revision_retained GROUP BY 1, 2 HAVING count(*) > 1;
-- then
ALTER TABLE document_metadata ADD PRIMARY KEY (collection, filename);
ALTER TABLE document_revision_retained ADD PRIMARY KEY (collection, filename);
```

A pair the first two queries return is two rows of one name in one collection,
which the BFF does not allow before deploy 2: it is a leftover of a deleted
document. Find which `document_id` the BFF still lists
(`GET /api/internal/document-ids?collection=`) and delete the other row. The next
deploy of PR A drops the key again.

## The gate

PR B merges to `develop` only after deploy 1 is green on dev and the PostHog Logs
search `"event":"backfill.` shows `"after":0` for every store of both backfills
in that deploy's `check` lines. PR B is promoted to prod only in a promotion
after the one that carried PR A, once the same holds for prod's deploy 1. Write
each environment's counts in the table below.

Before merging PR B, run its migration's guard as a read-only query against the
environment's app database. Every row is a folder 0271 would refuse:

```sql
SELECT organization_id, collection_name,
       coalesce(folder_id, '00000000-0000-0000-0000-000000000000'::uuid) AS folder,
       string_agg(format('%L', filename), ', ' ORDER BY filename) AS names, count(*)
FROM documents
WHERE authored_by = 'user' OR authored_by_producer IN ('agent_document', 'agent_file')
GROUP BY 1, 2, 3, lower(normalize(btrim(filename), NFC))
HAVING count(*) > 1;
```

The nil folder is the project root. No rows: proceed. Any rows: resolve them as
described under „If 0271's guard fires“ before the merge, and the deploy never
fails on them.

| Environment | Deploy 1 green | Backfill counts (`before` / `written` / `after`) | Guard query rows | PR B |
|---|---|---|---|---|
| dev | | | | |
| prod | | | | |

## Deploy 2 (PR B): the index and the naming rule

What it ships:

- migration 0271: a guard, then `uniq_documents_live_name_per_collection` rebuilt
  on `(organization_id, collection_name, coalesce(folder_id, nil uuid),
  lower(normalize(btrim(filename), NFC)))` over 0246's rows;
- the BFF's naming rule: a name is held per folder (`documentNameMatchKey` over
  the file name and the rename), uploads and moves answer `409 name_conflict`
  until `onConflict` (`replace`, `keep_both`, `skip`) decides, a rename onto a
  held name is refused, a restore from the Papierkorb keeps both, and an
  agent's file operation meets the same conflict;
- the UI: the folder-upload plan per target folder, the conflict dialog
  („Ersetzen“, „Beide behalten“, „Überspringen“, „Für alle anwenden“), the
  rename field's inline error;
- the metadata store's name-keyed writes narrowed to rows without an id.

The migration Job runs before any workload rolls out, so a refused 0271 leaves
every pod on deploy 1.

### If 0271's guard fires

The migrate Job fails with `Cannot apply migration 0271: a folder already holds
two live documents whose names differ only in case, Unicode normalization or
surrounding whitespace`, followed by one line per folder:

```text
organization org_…, collection proj_…, folder <uuid>, names 'Plan.pdf', 'plan.pdf' (2 documents)
```

Nothing was changed: the guard runs before the index is dropped, and it
deduplicates nothing, because each row is a document with its own Fassungen,
facts and citations. The environment keeps running deploy 1, and nothing is
rolled back.

1. For each line, ask the office (an owner of the project) which name each
   document keeps. Two copies of one file are still two documents to them.
2. Move one of each pair into another folder, or delete it into the
   Papierkorb (a binned document lies in a holder folder of its own), through
   the application, by someone with write access to the folder. A rename in the
   file list does not help: it changes the label (`display_name`), and the guard
   compares the stored file name. Never by SQL: a row renamed in the database
   leaves its chunks, metadata and storage under the old name.
3. Run the guard query above until it returns no rows, then re-run the deploy.

### Rollback

Roll the images back to deploy 1's tag ([rollback.md](rollback.md)). 0271 stays
applied, as every migration does, and the build of deploy 1 runs on it. While
it does, its upload still looks a name up across the whole collection: an upload
of a name that two folders now hold becomes a new Fassung of the newest of them
and files it into the upload's folder, and a move onto a name the target folder
holds is refused by the index. Roll forward with a fix rather than staying on
that build.

Restore 0246's index only on a database that never served deploy 2 to people
(the migration applied, the rollout failed): run
`0271_documents_unique_name_per_folder.down.sql`, which refuses, listing them,
while a collection holds one name in two folders. Once people have used deploy
2 it will, and the documents it names are theirs.

## Contract (after release 2027-W02)

Delete the `{file_name}` agent-host routes, the name fallbacks of the readers,
the two backfill directories and their scripts, and this runbook, once every
environment has reported `after` 0 and no caller sends a name without an id.
