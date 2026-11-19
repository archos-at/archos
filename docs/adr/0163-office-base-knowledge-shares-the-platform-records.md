---
status: proposed
date: 2026-11-06
decision-makers: engineering
consulted: the country base knowledge design (v7) and its red-team review
informed: everyone who builds the platform's base knowledge on these tables (S2, S7, S8)
---

# An office's own standards, commentaries and directives are base knowledge records with an owner, the same records the platform will hold

Corrects ADR-0116 where it says every filter carries `office_id`: until this record, none did.

## Context and Problem Statement

feld72's first real test failed on three ÖNORMs the office owns. The platform
lists no text for them, and the office's licensed copies sat in the office shelf
as files among many: nothing said what kind of source each was, which edition,
where it applies, which authority a directive binds or when it was last
checked. The agent read a licensed standard like a letter and a commentary
like the law (ticket 32).

The platform's own base knowledge (OIB, Landesrecht, the standards it lists)
will need the same facts. Two stores for the same shape would mean two
lifecycles and a data migration when the platform lists a designation an office
already holds.

## Decision Drivers

- The platform layer grows out of the office layer by additions only: new
  rows, nullable columns, wider CHECKs. No rewrite, no data migration.
- Tenant isolation holds in the database, not only in the service.
- Licensed text never leaves its seam; the seam (S2) keys on a mark this layer writes.
- Nothing reaches an answer before a person confirms it.
- Removal is reliable: no residue in records, history, checks or search.

## Considered Options

1. A metadata column on `documents` (kind, edition, licence) for office uploads,
   and a separate platform catalogue later.
2. FRBR records (work, edition, manifestation) with append-only revisions and an
   owner column, shared by the platform and every office (design §3.4).
3. Option 2 plus packs, change requests and release moves now.

## Decision Outcome

Chosen option 2, without packs or release moves (option 3's parts come with the
platform layer, as additions).

- **Tables (migration 0202).** `knowledge_records` (header: id, `organization_id`
  NULL for the platform, generated `owner_key`, type, `head_revision_id`,
  `document_id`), `knowledge_revisions` (append-only, provenance), one typed body
  per record type (`knowledge_work_revisions`, `knowledge_edition_revisions`,
  `knowledge_manifestation_revisions`) and `knowledge_checks`. Composite keys on
  `owner_key` keep a revision with a record of its own owner; a trigger refuses an
  edition or copy that names another office's record.
- **Kinds** `technical_standard`, `guideline`, `commentary`, `authority_directive`,
  `statute`; **licence classes** `public_open`, `public_restricted`, `licensed`
  (a licensed copy is never a platform row: CHECK).
- **Identity.** A work's designation (`ÖNORM B 1600:2017`) is its identifier
  (`identifiers.designation`, indexed), so a later platform listing attaches the
  office's copy instead of duplicating it.
- **Lifecycle.** A proposal writes one revision per record and no head; the
  person's confirmation writes the corrected revision and moves the heads, and
  counts as the first check. An edit appends; nothing updates or deletes a
  revision, body or check (REVOKE plus a trigger that allows a delete only as a
  cascade). The platform will publish by release moves in place of "confirmation
  moves the head", on the same rows.
- **Removal.** An office record names the office shelf document it was read from
  (`document_id`, composite with the organization, ON DELETE CASCADE). Removing
  the entry runs the office shelf's own delete (legal hold, chunks, objects); the
  records, revisions, bodies and checks go with the row.
- **Isolation.** Layered RLS: an office reads its own rows and platform rows in
  force (records with a head, revisions that are a head), and writes only its own
  (restrictive guards, the 0089 pattern). In search, a read over an office's
  scopes cannot be built without the office it reads as (`ScopeRead`), and points
  of those scopes are filtered by `office_id`; a test proves the leak with the
  condition dropped.
- **Licensed text needs a second statement.** An office licence for office-wide
  use does not by itself allow AI processing. A licensed copy is metadata-only
  (kind, designation, edition, validity) until the office states, at
  confirmation or later, that its licence covers processing by the hosted AI
  services; the statement is kept with who and when in the copy's `terms`
  (`aiProcessingAttestedBy`, `aiProcessingAttestedAt`), separate from the
  office-wide one. **A copy's text is held until a person confirms it**, whatever
  its class: nothing reads a licensed copy before anyone knew it was one. The
  base-knowledge upload (`base-knowledge-upload`) records the proposal before
  the dispatch (`ShelfUploadInput.beforeDispatch`), so the file is stored and
  never embedded, summarised or faceted; a proposal of a document already on the
  shelf takes its passages and its search row out and sets the row `stored`. The
  proposal reads the file name only. Two guards in `base-knowledge/text-guard.ts`
  keep a held copy out: the ingest dispatch (`isTextHeld`, on every later
  re-read) and the search projection (`heldAmong`, so no summary or facet is
  written). Confirming a public copy, or a licensed one with the AI statement,
  reads the file; withdrawing the statement takes the text out again. The turn names a
  metadata-only copy as held, with no file to search and an instruction not to
  quote or paraphrase it.
- **The licence mark.** A confirmed copy's points carry `licence_class`,
  `ai_processing_attested` (the office's statement, a bool), `quote_max_chars`
  (from the terms, else the seam's default of 500) and `knowledge_edition_id`
  (set by the internal `knowledge-mark` route, kept by a re-ingest through the
  job's fields; one pure function, `licenceMarkOf` in `office/text-use.ts`,
  builds both). The licensed seam (ADR-0159) enforces on it, and asks the
  records by document id through `licenceOfDocument` (`base-knowledge/text-guard.ts`).
- **Answers.** The turn context carries the office's confirmed entries, one line
  each: edition, role (a commentary is interpretation only; a directive applies
  only where its authority decides, from the project's Land as the interim path
  of design §8.1, and says so when the Land is unknown), file name and last check,
  overdue after 365 days (180 for a directive). The agent finds the text in the
  office shelf, as before.
- **Operations.** `base-knowledge-list`, `-get`, `-propose`, `-confirm`
  (`personDecides`; the agent proposes, the person confirms), `-update`
  (descriptive values only), `-licence-set` (the licence class and both
  statements; `personDecides` and offered to no agent of the office, since it
  decides whether licensed text reaches a model), `-check-record`, `-remove`.
  Upload and search are the office shelf's.
- **Problems and repeats.** Every base-knowledge route answers a refusal as an
  RFC 9457 problem (`application/problem+json`: `type`, `title`, `status`,
  `detail`, plus `code` and `error` as the rest of the app answers), and the
  writes take an `Idempotency-Key`: the same key and body answer the first
  result again, another body with that key is a 422
  (`bff/base-knowledge/http/`). The door forwarding the header to every
  operation comes with the agent-grade door.
- **Flag** `office-base-knowledge`, an entitlement, default off. (Amended by [ADR-0175](0175-the-cut-over-removes-the-austria-only-paths-and-their-switches.md): the switch and its off path are removed; the records are the only path. Amended again 2026-11-14: the office's own standards are behind a new entitlement, `office-standards`, so production can ship without them; `bff/authz/feature-flags.ts` says what it gates.)

### Consequences

- Good: the platform layer adds rows with `organization_id` NULL, a `pack_id`
  column, release moves and wider CHECKs, and an office's records keep working.
- Good: removal and isolation are database facts with tests on a real Postgres.
- Bad: one office work per copy for now. Two copies of one standard are two works
  until the platform listing gives them one edition to attach to.
- Bad: the directive's authority comes from the project's Land, not a confirmed
  site; Vienna is both Land and authority, elsewhere the answer says it is not verified.
- Bad: a file uploaded through the office shelf's own upload and recorded later
  was read once by that upload. The base-knowledge upload reads nothing; the
  proposal of an existing document takes out what the earlier read left.
- Bad: the proposal reads the file name only, so most values are the person's to
  fill. A masthead read through the licensed seam's zero-retention call would
  propose more without keeping the text.
- Neutral: points written before enrichment carry no `office_id` and pass the
  office filter; a backfill closes that gap.

### Confirmation

`bff/base-knowledge/store/repository.integration.spec.ts` (in `task db:test:rls`):
isolation with a positive control, append-only, cross-owner refusal, platform
visibility by head, zero residue after the document is deleted.
`packages/knowledge-layer/tests/test_vector_store_office_filter.py`: the office
filter with the leak shown when the condition is dropped. The service, turn block,
reading, freshness and authority specs beside the code.

## More Information

Design `docs/design/international/design.md` §3.4, §4.7, §8.1 (branch
`claude/intl-design`). Edition selection by a project's reference date is ticket 30.

## Amendment 2026-11-11: a place of their own, folders, and editions on the platform's primitives

The settings card was where nobody looked for documents and could not hold more than a handful of entries.
The office's standards became a place beside the Büroablage (`/app/base-knowledge`, PR #1671):

- **Folders.** One root folder on the office shelf, „Grundlagen des Büros“, found by name and created on
  first use as a project's `Berichte` is; the office shelf's folder service refuses its rename, move and
  delete (`bff/office-shelf/standards-folder.ts`). Its subfolders are ordinary office shelf folders, so the
  Büroablage shows the same tree. Uploads land there; a record whose document lies elsewhere on the shelf is
  still an entry. No migration: the folder is where files are put, the records still say what a file is.
- **A newer edition is an edition of the same work**, as the platform holds editions, so the one rule
  decides which applies. It supersedes "one office work per copy for now" above. A work was created with
  its first document, and an edition's revision references its work with ON DELETE CASCADE: removing the
  first document would take every later edition's revisions with it. So before a second edition joins,
  the work is made to stand alone (a new work record with no document, a new revision of the first edition
  naming it; revisions are only appended), and a standalone work is deleted with its last edition
  (`bff/base-knowledge/store/office-editions.ts`, its Postgres spec). An entry's id is its edition's.
  Every write to an office edition locks its record and re-reads the work its newest revision names, so two
  editions added at once end in one work, and an edit read before a join lands on the shared work. A work no
  edition names any more (its last document deleted from the Büroablage) is never read. A shared work is cited
  without one edition's date (`ÖNORM B 1600`, not `…:2017`; `workDesignation`), each edition's date being
  its label. A dated edition is in force on no day before it starts or after it ends; only an undated one
  answers when the rule finds none. An edition's history shows only the editions the reader may see.
- **A standard opens as the file it is** (2026-11-12): a press on it opens the app's one viewer
  (`FilePreviewDialog`, `?file=` in the URL), as the Büroablage opens any file, with the standard's facts
  (designation, edition, valid from, status, text use, last check, its other editions) first in the viewer's
  details column, and the two things done in passing there: confirm a proposal, say it is still current. Its page
  (values, licence, folder, newer edition, removal) is one press away, „Angaben bearbeiten“, and opens the file
  again with „Datei öffnen“. Closing the viewer undoes opening it (the list, the folder or the page the person was
  on), so the back button never reopens it. Reading a standard is the common act; managing it is the rare one.
- **Adding a standard is filling in its form** (2026-11-12): „Grundlage hinzufügen“ takes the file and opens the
  proposal made from it as its page, the form to check and confirm, rather than leaving a row in the list to find.
  Several files open one after another („Neue Grundlage 1 von 3“, „Bestätigen und weiter“), each step replacing
  the last in the history; confirming the last returns to the list. A file taken from the Büroablage opens the same
  way. What is left unconfirmed stays in the list as „Zu bestätigen“, so leaving midway loses nothing.
- **Which edition an answer uses** is the platform's rule for a standard, guideline or commentary
  (`time/editions.ts` `newestInForce`; an edition starts on its in-force date, else its issue date) at the
  project's reference day: the filing day once it has come, else today (`referenceDayOfProfile`, which the
  knowledge context's `referenceDateOf` shares). Replaces "every confirmed entry" in the turn block.
- **The norm directory decides which edition bound** (2026-11-19; replaced by the amendment „the binding edition comes from the chain resolver“ below): where the platform records list the
  work (matched by designation, `designationKey`) with in-force dates on its editions
  (`PlatformKnowledge.editionsOf`, `platform/office-read.ts`), the edition in force on the reference day is
  theirs (`office/binding-edition.ts`, `newestInForce` over the platform's editions), not the office's own
  dates. When the office holds it (same label, or a day the two share), the turn carries that edition. When
  it does not, the turn carries none of that work's editions and labels none; it carries a line marked
  BINDING EDITION NOT HELD that names the edition and the copies the office has, and the block tells the
  agent not to answer from them, to say which edition bound, and to offer that the office uploads it. Where
  the records do not list the work or date its editions, the office's own dates decide as before. The block
  names the day it used, and when it is today, why (no reference day, or no project), so the answer can say
  so. Trace metadata `base_knowledge_editions_missing` counts the missing lines (`docs/observability/langfuse.md`).
  The live path needs platform records it does not have yet: no `technical_standard` work with in-force dates
  is released on dev (2026-11-19), so until they are, every work falls back to the office's dates.
- **The citation line** of a passage of an office copy carries the same fields a platform edition's does
  (designation, edition label, ids, role, last check, freshness in the platform's tokens), found by the
  passage's `knowledge_edition_id` (`packages/agent/src/agent/citations/office_lines.py`). Wording the line
  is `docs/design/citations.md` slice 2's one formatter; no second form for office copies.
- **Operations.** `base-knowledge-folder-list`, `-folder-create`, `-bulk` (check, move, remove; at most 50,
  one short request, each entry through the single-entry service) and `-edition-add`. `base-knowledge-list`
  narrows by folder (with subfolders), attention, kind and a search, and answers counts, folder counts and
  the territories the form offers by name.
- **Recognising norms in an ordinary upload** (2026-11-19): `base-knowledge-recognize` takes office shelf
  documents already stored and proposes each one `recognizeNorm` calls a norm, withholding its text; a
  designation matching a confirmed work is proposed as an edition of it (`editionOf`, `insertEditionOfWork`), and
  as a `duplicate` when that work already holds the edition. Other files, the OIB guidelines among them, stay
  where they were uploaded and come back as `plain` with their folder. A document already recorded answers its
  proposal again. Since the amendment „A recognised norm leaves the Ordner at once“ below, an upload is recognised
  by the server before its dispatch, so this call mostly answers proposals that already exist.
  `base-knowledge-settle` answers the proposals: a confirmed one moves into its topic folder (a new edition into
  its work's), a duplicate is deleted, `notNorm` drops the records and reads the file again where it lies (a file
  under the standards tree goes back to the Ordner folder it came from first; see the amendment below), and one
  without an edition stays a proposal that keeps the row's Art, Bezeichnung and a cleared Ausgabe
  (`reviseProposal`, proposed by the person), and moves into the row's topic, so „Jetzt prüfen“ shows them again.
  While the licence step is off (`ASK_FOR_LICENCE`), settle confirms without asking for the licence statement: a
  new edition of a work stored as licensed lands licensed, and its text is read like any confirmed copy's (ADR-0164,
  amendment of 2026-11-19), instead of failing on the attestation. `base-knowledge-unlist` takes a confirmed entry off the base
  knowledge but keeps its file, moved to the top of the Büroablage; `base-knowledge-remove` still deletes both.
- **One upload, one norm dialog** (2026-11-19), in place of „Adding a standard is filling in its form“: both
  tabs of the Büroablage upload through the office shelf's own upload (`useOfficeShelfDocuments`, the same
  „Hochladen“ control and drop), and what it stored goes to `base-knowledge-recognize`. When any proposal comes
  back, one dialog lists them all (`NormDialog`: Art with „Keine Norm“, Bezeichnung, Ausgabe, Thema), with a line
  for the files that are not norms and where they lie; „Bestätigen“ is `base-knowledge-settle`, „Später“ leaves
  them proposed, and the norms tab's „Jetzt prüfen“ opens them again. A plain file uploaded on the norms tab lands
  in Ordner, said by a toast with the way there. An upload whose name a document on the other side of the
  standards tree already holds is stored under a numbered name (see the amendment below). A file reaches the standards tree only through these flows: `PATCH /api/documents/{id}/folder` and
  a proposed move refuse to take an Ordner file under it, and an upload's `revisionOf` may not cross it. „Als Norm führen“ on an Ordner file opens the dialog for it,
  „Nicht mehr als Norm führen“ on an entry is `base-knowledge-unlist`, and the folders of the norms tab are its
  topics („Thema anlegen“).

## Amendment 2026-11-19: norms already in ordinary folders

Offices kept norms in ordinary Büroablage folders long before Normen & Richtlinien existed (one office has a
folder „Normen“). With the standards tree hidden from the Ordner tab, those files would stay ordinary files
nobody is told about.

- **Found by a BFF job, not the browser.** `office_norms_scan` (`bff/base-knowledge/office/folder-norms-scan.ts`)
  pages through the office shelf's documents in ordinary folders (never the standards tree, never the top level),
  500 a slice, and keeps those `recognizeNorm` calls a norm from their name that are neither recorded as base
  knowledge nor kept as ordinary files. Its trigger: a daily cron sweep, `office-norms-scan` at 04:13 Vienna, queues
  it for every office with `office-standards` on, because the flag is switched in WorkOS and nothing in the code
  hears it come on, so the first scan after enabling runs the next night at the latest; and an upload of a file
  whose name reads as a norm into an ordinary folder queues it a minute later, one queued scan per office
  (`enqueueJobIfAbsent` on an id derived from the office), so a folder upload of 200 files is one scan. A
  decision in a folder queues a fresh scan so the inbox item follows.
- **One Postfach item per office**, `office_shelf.norms_found` („ARCHOS hat Normen in Ordnern gefunden“), to the
  members whose role holds `org:office_shelf:manage`, listing up to twelve file names and linking to the first
  folder. A member who already holds it is never told again: an open item is refreshed, a resolved or archived one
  stays so. When nothing is left, or the flag is off, open items are resolved; one held by a member who lost the
  permission is resolved too.
- **The decision is in the folder.** The Ordner tab shows a notice in a folder holding such files, to those who
  may manage the Büroablage. „Unter Normen & Richtlinien führen“ proposes each file (`takeAsNorm`, which remembers
  the folder) and then moves it under the standards root, up to 50 a request, where it waits under „Zu bestätigen“,
  and opens the norm dialog for the files it moved; the folder stays, even empty. „Im Ordner lassen“ writes one row per document to `office_shelf_norm_keeps`, the table a
  project's „Hier lassen“ uses too (ADR-0185, migration 0250, without a project), and no scan offers that document again. Operations:
  `office-shelf-folder-norms-list` and `office-shelf-folder-norms-decide` (the person's own decision, not the
  agent's).
- **What is read is the file name**, as at upload: the title and summary the backend reads later are not in
  the scan, because reading them for every document of a shelf is a backend call per collection.

Deferred, with the reason: a masthead reading for the proposal (the file name and a person's correction
cover most cases; reading needs the licensed seam's zero-retention call), a measure of how well tables in
standards are read (needs licensed test documents and an evaluation of its own), a view of norms the
platform lists and the office does not hold, and replacing a copy's file (a newer edition, or remove and
upload, covers it).

## Amendment 2026-11-19: the Stand comes from the platform's editions where it lists the work

Replaced by the amendment „the binding edition comes from the chain resolver“ below: the Stand, the Postfach item and the
turn now read the resolver, not a lookup of the platform's editions by designation.

A manual „Ist noch aktuell“ every year is busywork for a work whose editions the platform already holds, and
says nothing in between. So an entry's Stand is decided in one place (`standOf`, `office/listing.ts`):

- **A work the platform lists** (its designation without the edition, `designationKey`, matches a platform work
  with a dated edition in force today by the one rule, `newestInForce`) is **Aktuell** when the office holds that
  edition (a confirmed edition starting on or after it, or one with the same label) and **Neuere Ausgabe** when it
  holds only an older one (`directoryStanding`, `office/freshness.ts`; the platform read is
  `PlatformKnowledge.directoryEditions`). It asks for no manual check. An office copy with no date and another
  label cannot be compared and falls back to the check.
- **Any other work** (most directives, RVS, commentaries, internal guidelines) keeps the manual check:
  **Geprüft am <Datum>** while fresh, **Prüfung fällig** once overdue; confirming counts as the first check.
- A proposal is **Zu bestätigen**; an edition the office's own newer one replaces is **Abgelöst**.
- The norms tab filters by Alle, Zu bestätigen, Neuere Ausgabe and Prüfung fällig (`attention=newer_edition`
  is new; `metadata_only` stays for agents). The table's last-checked column folds into the Stand.
- **The Postfach.** A daily Hatchet sweep (`base-knowledge-new-editions`, `office/new-edition-notice.ts`) compares
  every office holding a confirmed standard and gives whoever may manage its Büroablage
  (`org:office-shelf:manage`) one `base_knowledge.new_edition` item per work and edition in force: „<Norm>: neue
  Ausgabe erschienen“, with the active projects whose reference day (`referenceDayOfProfile`) falls on or after
  that edition's start. The item is resolved by the next sweep once the office holds the edition. It opens the
  work's newest held edition in Normen & Richtlinien (`?entry=`, where a new edition is uploaded) and offers
  „Neue Ausgabe hochladen“ there and „Ansehen“ (`?file=`).
  An office whose `office-standards` flag is off is told nothing, and its open items are resolved
  (`officeStandardsEnabled`, as the folder-norms sweep asks).

Not changed: the turn block and the answer label still read the manual check (`freshness`), so an answer does not
yet say that the platform lists a newer edition; that changes what shapes an answer and needs its golden run.

What the platform holds today: editions with dates for the OIB guidelines, their explanatory notes and guides
(`issued_on`, rarely `in_force_from`), and no technical standard (no ÖNORM, EN or DIN work). Until the platform
lists standards with dated editions, every office ÖNORM keeps the manual check.

## Amendment 2026-11-19: taking a norm off keeps its records, and „Rückgängig“ brings it back

„Nicht mehr als Norm führen“ deleted the document's records, so every Ausgabe, check and the topic were gone and
the only way back was a fresh proposal. Now:

- **Parked, not deleted** (migration 0251). `base-knowledge-unlist` moves the file to the top of the Büroablage,
  as before, and parks its records: `knowledge_records.unlisted_at` is set and the head moves to
  `unlisted_head_revision_id`, so every reader that reads heads sees nothing of the entry, as of an unconfirmed
  proposal. Every reader by document (`readOfficeEntries`, `documentHasEntry`, `documentsWithEntries`,
  `entryIdsForDocuments`, `copyForDocument`, the folder-norms scan) reads listed records
  only. The file's text is read again as an ordinary file's.
- **Rückgängig.** The entry page unlists at once, without a confirmation, and its toast offers „Rückgängig“:
  `POST /api/base-knowledge/{entryId}/relist` (the browser's undo, not an agent operation) moves the file back to
  the topic it lay in (the root when that topic is gone), moves the parked heads back, and reads or withholds the
  text as the entry's confirmation and text use say. The norm is back as it was: confirmed, the same values, its
  checks and its topic.
- **A new proposal replaces a parked entry.** „Als Norm führen“, an upload or a proposal of the same file deletes
  the parked records in the transaction that writes the new proposal (`dropUnlistedEntry`), with a standalone work
  no edition uses any more. Restoring the old record on „Als Norm führen“ would confirm a norm without the dialog,
  so it starts afresh. Deleting the file still deletes everything; „Norm entfernen“ is unchanged.

## Amendment 2026-11-19: a recognised norm leaves the Ordner at once

A behaviour review found the Ordner holding norms nobody had confirmed: an upload landed in the current folder,
the browser asked for recognition afterwards, and „Später“ said the norms waited under Normen & Richtlinien while
they stayed in the folder, read in full. Recognition depended on a second browser call that a closed tab, an error
or the 50-file cut could skip, and the folder scan never looks at the top level.

- **The server recognises an upload before it dispatches it** (`uploadToOfficeShelf`,
  `bff/base-knowledge/office/norm-intake.ts`, the route `POST /api/documents/upload` for the office shelf). With
  `office-standards` on, a file whose name `recognizeNorm` calls a norm, uploaded outside the standards tree and not
  as a `revisionOf`, is stored under the standards root, and `uploadOfficeShelfDocument`'s `beforeDispatch` records
  its proposal (a confirmed work's new edition when the designation matches), so the dispatch finds the text held.
  The flag off, nothing is recognised, as before. A file the name screening holds is recognised when the released
  upload arrives, since it is the same route. `base-knowledge-recognize` now mostly answers proposals that exist; a
  document it still records (`asNorm`, or a file stored before this change) moves under the standards root as well
  (`takeAsNorm`), and a file kept as an ordinary file is not offered again unless asked with `asNorm`. The browser
  still sends at most 50 ids, which now only limits what the dialog shows: the rest wait under „Zu bestätigen“, and
  the norms tab claims „Keine Norm dabei“ only when it asked about every upload.
- **The proposal remembers where the file came from**: `provenance.filedFrom.folderId` on the edition revision, the
  Ordner folder the upload was meant for, the folder the migration took it from, or null for the top level.
  `reviseProposal` carries it over. **Keine Norm** moves the file back there (the top level when that folder is gone
  or lies under the standards tree), drops the records, reads the text again, and writes an
  `office_shelf_norm_keeps` row, so neither the folder scan nor `base-knowledge-recognize` offers it again.
- **Duplicates and new editions are told by designation and edition, never by file name.** A name a document on
  the other side of the standards tree holds, or any name already taken when the upload goes into the tree, is
  stored under the next free numbered name (`Name (2).pdf`, `numberedFilename` as the mail import names its
  attachments): a norm then comes to the dialog as `editionOf` or `duplicate`, a plain file stays in its Ordner
  folder. The norms tab's `forStandards` upload, which made a same-named upload a new version of a norm with its
  old Ausgabe, and `base-knowledge-upload`'s refusal of a name a recorded copy holds are gone. Ordner to Ordner, a
  name still replaces as a new version.
- **An Ordner folder stays out of the standards tree**: `PATCH /api/office-shelf/folders/{id}` refuses a parent
  under it for a folder outside it (`updateOfficeShelfFolder`), as a document's move is refused.
- **The filing judge leaves base knowledge alone**: a document recorded as base knowledge is neither judged nor
  moved by an upload batch's filing proposals (`reviewUploadFiling`).
- **Feedback for a guideline the platform holds**: a lone OIB guideline uploaded on the norms tab is announced as
  one ARCHOS already knows, and on the Ordner tab, which says nothing about ordinary files, it is announced too.

## Amendment 2026-11-19: the binding edition comes from the chain resolver, and nothing punishes the office

Two earlier slices answered "which edition binds" with a check of their own: the Stand, the new-edition sweep and the
turn read the in-force dates of a platform work matched by designation (`PlatformKnowledge.editionsOf`,
`directoryStanding`, `editionsForDay`), beside the chain resolver that already follows `makes_binding` routes
(`static_reference`, `dynamic_reference`, `supersedes`, validity windows) for a Land and a day. The office's norm
feature is an add-on for what the platform cannot carry (paywalled ÖNORM, EN and DIN norms an office bought), and the
platform will later carry which norm editions an OIB guideline cites. The user's decision: "Let's do the code side we
later add those binding stuff in there but we don't punish if the orgs don't have them".

- **One answer to "which edition binds"**: the knowledge context's uses (`context/resolve.ts`), filtered to what a
  route makes binding (`role: binding`, `via: relation`), keyed by the work's designation without its edition
  (`designationKey`): `bindingNormsOf`, `office/binding-edition.ts`. An office copy is the binding edition when its
  label or a day it carries matches (`isSameEdition`); it is an older one when every confirmed copy starts before the
  binding edition's day (`bindingStanding`, `newer`). `PlatformKnowledge.editionsOf`, its SQL, `directoryStanding`
  and the entry's `directory` are gone; the entry carries `binding` (`editionLabel`, `startsOn`, `via` = the
  instrument the route names, `held`, `newer`).
  - In a project: the turn's own knowledge context, for the project's Land and reference day
    (`loadTurnContext` hands it to `baseKnowledgeForTurn`).
  - On the Normen tab and the entry page: the office's home Land today, the knowledge context of a turn without a
    project (`knowledgeContextForTurn(org, null)`, whose site is the office's assumed subdivision); without one there
    is no binding information.
- **Nothing punishes the office.**
  - A norm the office never bought gets no badge, no Postfach item and no line in the turn. `listedNotHeld` named
    every platform work with a designation the office did not hold, and told the agent to say „gelistet, kein Text“
    for one without text; once the platform carries the norms the OIB cites as metadata, that is a negative line per
    norm in every turn. It now names only works whose text the platform holds (`listedFor`, `platform/office-read.ts`).
  - An office copy older than the binding edition: the Stand shows „Neuere Ausgabe“ in the informative colour, with
    „Verbindlich ist heute die Ausgabe …, laut <instrument>“. The turn keeps the office's copy and marks its line
    OTHER EDITION BINDING with the binding edition, the day and the instrument; `BINDING_EDITION_RULE` lets the answer
    use the copy but makes it say which edition binds that day. The refusal (do not answer from, quote or paraphrase
    the other edition) is gone. The day line stays. Trace metadata `base_knowledge_editions_missing` counts the marked
    lines.
  - The binding edition held: the Stand is „Aktuell“, the turn says „the edition binding on <day>“ instead of the
    check, and the answer label carries no overdue check.
  - No binding information: the office's own dates and the manual check, as before.
- **The manual check is quieter**: „Prüfung fällig“ is a muted pill, not a warning; the entry page and the viewer's
  facts say where the Stand comes from („Verbindlich ist heute die Ausgabe …“ from the resolver, or „Vom Büro geprüft
  am …“). There is no Postfach item for a due check and no roundup.
- **The Postfach item `base_knowledge.new_edition` is rebased on the resolver.** The daily sweep
  (`base-knowledge-new-editions`, `office/new-edition-notice.ts`), gated per office on `office-standards`, resolves the
  binding editions for each active project (at most 200 per office) and tells whoever manages the Büroablage, once
  per norm and binding edition (`<designation>@<day or label>`), when a confirmed office norm is no longer the binding
  edition for at least one active project: „ÖNORM B 1600:2017 ist nicht mehr die verbindliche Ausgabe“, „Verbindlich
  ist die Ausgabe …, laut <instrument>. Betrifft: <projects>“, with „Neue Ausgabe hochladen“ and „Ansehen“. Every
  open item whose anchor is no longer owed is resolved (`resolveOpenItemsOfType` with `keepAnchors`): the office holds
  the binding edition, or no active project is affected. An office edition that itself supersedes another („Ersatz
  für …“ on a cover) does not count yet: nothing on this branch records it.

What the platform holds today (2026-11-19): no ÖNORM work and no route to one, so no office norm has binding
information, the Stand and the turn read as before, and the sweep tells nobody. The answer-shaping change owes its
golden run on dev.
