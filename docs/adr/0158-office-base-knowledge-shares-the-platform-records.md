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

- **Tables (migration 0200).** `knowledge_records` (header: id, `organization_id`
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
  office-wide one. A proposal of a licensed copy takes the passages the upload
  indexed out of the index and sets the row `stored`; the ingest dispatch
  refuses to index a metadata-only office shelf copy on any later re-read
  (`base-knowledge/text-guard.ts`); the statement given later reads the file
  again; withdrawing it takes the text out again. The turn names a
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
- **Flag** `office-base-knowledge`, an entitlement, default off.

### Consequences

- Good: the platform layer adds rows with `organization_id` NULL, a `pack_id`
  column, release moves and wider CHECKs, and an office's records keep working.
- Good: removal and isolation are database facts with tests on a real Postgres.
- Bad: one office work per copy for now. Two copies of one standard are two works
  until the platform listing gives them one edition to attach to.
- Bad: the directive's authority comes from the project's Land, not a confirmed
  site; Vienna is both Land and authority, elsewhere the answer says it is not verified.
- Bad: the upload that precedes a proposal still indexes the file and reads it
  once (the shelf's pipeline), until the proposal takes the passages out. An
  upload path that stores a licensed copy without reading it closes that window.
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
