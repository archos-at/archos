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
- **Flag** `office-base-knowledge`, an entitlement, default off. (Amended by [ADR-0175](0175-the-cut-over-removes-the-austria-only-paths-and-their-switches.md): the switch and its off path are removed; the records are the only path.)

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
- **Which edition an answer uses** is the platform's rule for a standard, guideline or commentary
  (`time/editions.ts` `newestInForce`; an edition starts on its in-force date, else its issue date) at the
  project's reference day: the filing day once it has come, else today (`referenceDayOfProfile`, which the
  knowledge context's `referenceDateOf` shares). Replaces "every confirmed entry" in the turn block.
- **The citation line** of a passage of an office copy carries the same fields a platform edition's does
  (designation, edition label, ids, role, last check, freshness in the platform's tokens), found by the
  passage's `knowledge_edition_id` (`packages/agent/src/agent/citations/office_lines.py`). Wording the line
  is `docs/design/citations.md` slice 2's one formatter; no second form for office copies.
- **Operations.** `base-knowledge-folder-list`, `-folder-create`, `-bulk` (check, move, remove; at most 50,
  one short request, each entry through the single-entry service) and `-edition-add`. `base-knowledge-list`
  narrows by folder (with subfolders), attention, kind and a search, and answers counts, folder counts and
  the territories the form offers by name.

Deferred, with the reason: a masthead reading for the proposal (the file name and a person's correction
cover most cases; reading needs the licensed seam's zero-retention call), a measure of how well tables in
standards are read (needs licensed test documents and an evaluation of its own), a view of norms the
platform lists and the office does not hold, and replacing a copy's file (a newer edition, or remove and
upload, covers it).
