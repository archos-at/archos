---
status: proposed
date: 2026-11-10
decision-makers: engineering
consulted: the country base knowledge design (v7, §4.4 and §4.5) and its build split (S7)
informed: everyone who builds on the platform's records (S8 Austria, S9 setup facts, S10 the agent-grade door, S11 time and editions, S12 addresses)
---

# The platform's own base knowledge lives in the office layer's records and changes only through a reviewed change request

## Context and Problem Statement

ADR-0163 gave offices their works, editions and copies in `knowledge_records`
and left the platform's rows "for later, by inserts and wider CHECKs". Until
now the platform's country knowledge (laws, norms, authorities, territories)
lived in code and in a pointer registry, so adding a country was a code
project and nobody reviewed a change claim by claim before offices read it.

## Considered Options

- **The office layer's records, owner NULL, changed only through change requests** (chosen).
- **A separate platform store** (its own tables, or the norm registry grown into one). Rejected
  on the premise ADR-0163 states: a platform listing must attach to an office's copy of the same
  designation by a composite key, which two stores cannot give without a data migration.
- **A head column per channel** (`preview_revision_id` beside `head_revision_id`). Rejected while
  only operators and golden runs read the preview: a preview is the newest preview move, and a
  column would be a second thing a trigger must keep in step. Revisit when a tenant reads preview.

## Decision Outcome

**Same records, owner NULL.** Platform rows are `knowledge_records` with
`organization_id` NULL and a `country_id` (migration 0205). Two record types
join, platform only: `territory` (ISO 3166 ids, parents) and `authority`
(competence territories). No second lifecycle: a revision is appended, and the
head moves.

**Every platform revision is in a change request** (`knowledge_revisions.change_request_id`,
required for platform rows and refused for office rows, and only into a draft).
The flow is draft → validate (the kit's KC-1 and KC-3) → submit → a verdict per
claim → approve → publish to preview → publish to stable → rollback if needed.

**The head moves only with a release move.** `knowledge_release_moves` is
insert-only; a stable publish appends a move per record and moves the head, and
a trigger refuses any platform head that is not where the newest stable move
points. A rollback appends the inverse moves. A publish over a record released
by another request since this one was opened is a 409 (`base_release_seq`).

**Amended 2026-11-10 (migration 0218):** every change request needs a domain expert's approval, besides counsel and a privacy reviewer where ADR-0174 asks for them; before, one approval in any role approved a request that needed no other role. A trigger holds a request's status to its lifecycle (draft → submitted → approved → published → rolled back, or rejected), and moves it to approved only once every role it needs has approved it, no claim's newest verdict is edited or rejected, and every revision the request releases carries at least one verdict (unless its domain expert approved alone, ADR-0176). That is the floor the database can see. Which body fields are claims is the application's (`claimsOf`), so "every claim accepted" is checked by the service before it writes the approval, not by the trigger: a path that bypasses the service can still approve a request with one claim of a revision reviewed and another not. Drafting takes `platform:knowledge:write`, review and release `platform:knowledge:review`, no longer `platform:settings:manage`.

**Amended by [ADR-0176](0176-a-platform-change-request-may-be-approved-alone-with-its-second-review-deferred.md) (2026-11-10):** an author holding `platform:knowledge:approve_alone` may approve their own request with an explicit override and a reason; the request is marked `approval: single` and owes a second review that another person gives later (migration 0214).

**Four eyes, in the database.** An approval on a request holding a revision its
approver wrote is refused by a trigger, not only by the service; so, since
migration 0208, is a verdict on one of its claims, so the "every claim accepted"
an approval checks never rests on the author's (or the author's agent's) word.
A verdict needs no yes of its own, but records how it was given
(`decision_source`: `app`, `elicitation`, or `agent` for an agent call the
person did not confirm). An approval's role is one the approver holds in WorkOS
(`platform:knowledge:approve_as_<role>`), never only what the client sent.

**The person's own yes is a server-side primitive** (`requirePersonDecision`,
`bff/agent-api/person-decision.ts`). Approve, publish, rollback, entitlement and
a home-country move call it: a person's own request counts as `app`, a door call
counts only when the door elicited the person's yes (`elicitation`) or a client
that declared MCP Apps carried it (`app`); `app-unverified` and a bare agent
call are refused 403 `PERSON_DECISION_REQUIRED`. The catalog's `personDecides`
makes the door ask; the route refuses when nobody did. The decision source is
recorded on the approval, the move and the entitlement. S10 reuses it.

**Entitlement fails closed.** An office reads a platform record only when it
has a head and its country is the office's home country or one the platform
entitled it to (`organization_countries`, written by the platform only), and a
revision only once it was released to stable (so an old citation still
resolves after a rollback). `knowledge_country_entitled` and
`knowledge_revision_released` are `SECURITY DEFINER` functions the read
policies ask; the change-request tables are platform-private (`secure_table(t, 'false')`).

**Indexing on publish.** Each published text names its base-corpus file; a
stable publish opens an indexing run per text and a `platform_text_index`
Hatchet job hands the file to the corpus. A run reads `queued` only when the
corpus accepted the file, `failed` with why otherwise, and `indexed` only when
the corpus reports its chunks.

**Behind a flag.** `platform-base-knowledge`: per office, its turn reads the
platform's listings and directives; for the platform organization, the routes
answer and the norm registry stops taking edits (409). Off, everything is as
before. (Amended by [ADR-0175](0175-the-cut-over-removes-the-austria-only-paths-and-their-switches.md): the switch and its off path are removed; the records are the only path.)

### Confirmation

`apps/workspace/bff/base-knowledge/platform/platform.integration.spec.ts` under `task db:test:rls`
(rollback round trip, MA 37 in Graz, indexing, the second office's listing, four eyes, the 409s,
a tenant reading nothing of the change requests); the 0205 block of `scripts/rls-test-db.sh`
(the triggers and the down) and its 0208 block (four eyes on verdicts, the verdict's source);
`bff/agent-api/person-decision.spec.ts` (the yes, through the real acting session);
`bff/base-knowledge/platform/service.spec.ts` (approve, reject, publish, rollback, entitle and the
home country each refused 403 without the person's yes, at the service; the approval role held); the element ledger (`bff/base-knowledge/consumers.ts`) for every new column.

### Consequences

- Adding a country is a data release an operator's agent can drive on the
  platform door; an expert reviews it in the platform view.
- An MA 37 directive is excluded from a Graz project's turn by the authority's
  competence, read through the territory chain.
- The platform's texts are indexed into the shared base corpus, which every
  office's retrieval reads today: retrieval scoped by entitlement is the turn
  context's (S15), and until then a platform text is searchable by any office
  once published, while its record is read only by entitled ones.
- Not built here, each with the slice that brings it: golden runs and the rest
  of the kit (KC-2, 4 to 9), counsel and hotfix approval rules, citation
  captures, packs (`country_id` stands for the pack until S8 needs more), the
  outbox fan-out to office copies when a platform edition moves.

## More Information

Migration `apps/workspace/migrations/0205_platform_base_knowledge.sql`; code
`apps/workspace/bff/base-knowledge/platform/`; operations
`apps/workspace/bff/agent-api/catalog/platform-knowledge.ts`; the view
`/app/platform/countries`.

## Amendment (2026-11-11): texts are attached in the request

**The problem.** A country's knowledge had two homes. The records lived in a
change request; the file a manifestation names (`corpusFile`) was uploaded on
another screen, into a store that showed no country. Four things went wrong for
a person:

1. An OIB guideline, which is Austrian law, looked like part of a shared pile.
2. A request could be reviewed, approved and published before its file was
   uploaded. Its indexing run then failed with "upload it, then publish again",
   and a published request cannot be published again.
3. A reviewer never saw the text the edition points to.
4. An agent could only send the file as base64 inside a tool call, which fails
   for a real PDF of one to four megabytes.

**What a person does now.** In the draft, on the manifestation, they attach its
text: they upload the PDF, or name a URL on a configured public source. The
reviewer opens that text on the request, beside the edition and the cited
capture. Publishing indexes it under the request's country. The base corpus
page groups its files by country and names, per file, the edition and the
change request; a file no record names is in a group that says so.

**The decision.** The storage and the country filter stay as they are, and no
table is added. Six rules do the work; the last three came out of two reviews
of the first three, and a third review sharpened the fourth and the sixth (see
"What the reviews found" below):

- **Attach stores the file and names it in one step.** `text-import` and
  `text-upload` put the bytes in the base corpus (where they are ingested for
  no country, `released: false` since country-as-data row 7, `ZZ` before it, ADR-0173) and append a revision of the manifestation whose
  `corpusFile` is that file, with its `sha256`. Where the file came from
  (upload or URL, the source, who, when) is kept on that revision's
  `provenance.text`. The publish already marks and re-ingests the file under
  the record's country; nothing changes there.
- **A record never names a file the corpus does not hold.** The kit refuses it
  (KC-1 at `/corpusFile`) on propose, validate and submit. The corpus is the
  api tier's, so the BFF asks before the kit's transaction, as for KC-7, and an
  unanswered question is a problem, never a pass. This is what removes the
  ordering trap: no request reaches a reviewer before its text is there.
- **A file is one record's text.** A name another record uses, released or on
  its way, is not replaced under it (`NAME_TAKEN`) and not removed (409 on the
  corpus's delete). So a file that was there at submit is there at publish.
  A plain proposal that names a file another record names, released, on its way
  or in the same batch, fails the kit too (KC-1, `NAME_TAKEN` in its detail):
  the second record's publish would mark the file with its own country.
- **A text's file is named after its bytes, and its bytes never change.** An
  attached text is kept as `<manifestationKey>-<first 12 hex of its sha256>.pdf`,
  whatever the upload was called or the URL ended in. Another text is another
  file, so nothing is replaced: the upload and the fetch have no `replace`, the
  api tier names a fetched text itself (`corpus_text_name`) and refuses a name
  that holds other bytes, and the BFF names nothing the api tier kept under
  another name. **The rule is enforced where the file is written.** The api
  tier's `oib_sync.store_and_request`, the one function a plain upload, a ZIP
  member and a fetched text all go through, takes the same bytes under a name
  it keeps as a no-op and any others not at all (`CorpusFileImmutable`, 409),
  inside the file's lock. To change a file's bytes it is removed first, and
  the BFF refuses to remove one a record names. The BFF's own guard
  (`refuseReplacingNamedTexts`) stays as the early refusal with the better
  message, and for a name the corpus lost: once any revision names a file,
  released, superseded or rejected, the plain upload passes for it only as the
  bytes the corpus keeps or, for a lost file, the bytes a revision names. Both
  tiers read one upload as the same thing: ZIP or PDF by the first bytes
  (never the part's content type), the name has to agree, a member is kept
  under its base name in NFC, and a member whose name has a NUL, a backslash
  or a `..` step is kept under no name. So a fetch that finishes after its
  draft was submitted leaves a file no record names, never other bytes under
  one that a record does, and what was released cannot be changed by a draft.
- **The reviewed bytes are the published bytes.** A manifestation revision
  keeps the `sha256` of the file it names: the attached text's, or, for a
  record that only names a file, the hash the corpus held when it was first
  named. Three things are bound to that hash. The reviewer: the request's text
  is read through `GET …/change-requests/[id]/texts/[manifestationKey]`
  (`platform-knowledge-text-get`), which hashes the bytes it is about to send
  and answers 409 `TEXT_CHANGED` instead of any others. The approval: KC-1
  compares the corpus's current file with the hash on propose, validate, submit
  and approve, and fails closed on other bytes, on a corpus that gives no hash
  and on a stored revision that keeps none. The index: the indexing job
  compares once more before it marks the file with a country; on other bytes
  its run fails and nothing is indexed. The rule above keeps the product from
  changing a named file; this one holds when something else did.
- **What nobody fetched from a reviewed source is held to four eyes.** An
  uploaded text, and a file a record only names, came from a person, who could
  upload their own PDF as "OIB-RL 6 2015", approve alone and publish. So does
  anything fetched through a source that person configured: a `source` record
  proposed in a draft opens its hosts to that draft's own test fetch
  (ADR-0174), and its host can be the author's. Each fetch therefore records
  what it went through, at fetch time: `built_in` (a source the repository
  configures, reviewed as code: at-ris, ch-fedlex), `released` with the source
  record's released revision id, or `draft` with the draft revision's. A
  capture keeps it in `source_origin` and `source_revision_id`, a text on
  `provenance.text` (`sourceOrigin`, `sourceRevisionId`). The database decides
  what counts (`knowledge_source_reviewed`, migration 0224): a built-in
  source, or a revision a stable release published before the fetch, from a
  request approved by four eyes or approved alone and since confirmed by its
  second review, and only while that release stands. A draft's source never
  counts, and neither does one its author released alone: two single approvals
  do not add up to one person's publish. A release that is rolled back, which
  is how a source found wrong is withdrawn (a disputed second review ends the
  same way, or already fails the condition before), takes its word back: what
  was fetched through that revision is held again, in requests already
  submitted too, because the question is asked at approval. A newer release of
  the source supersedes the revision and takes nothing back.
  Everything else is held like an operator-supplied capture (ADR-0170,
  migration 0218): `knowledge_sources_unchecked` is true until somebody other
  than the revision's author (and a text's uploader) marked a verdict on it
  `sourceChecked`, and while it is true nobody approves, alone or not. This
  holds for texts and captures alike; captures had the same gap since #1594. A
  fetched text counts only while the revision still names the fetched file and
  hash, which the rule above holds the corpus to. A capture without an origin
  (stored before the columns, or written by an older build during a rollout)
  counts only if no record ever configured its source. The reviewer's
  page reads the same answer (`countsAsFetched`), so what it asks a reviewer to
  vouch for is what the database will ask for.

A URL is fetched and read by the public-source fetcher, never in the api pod or
here (ADR-0162, #1592): the BFF calls `POST /v1/public-sources/corpus-text`,
which runs the capture's guarded fetch and PDF read and hands the bytes to the
corpus store. A body that is no PDF, or one the fetcher cannot open, is refused
before anything is kept.

**Considered and rejected.**

- *A table of attachments per change request.* It would hold what the
  manifestation revision already says (the file and its hash) and a second
  place to keep in step with it. The revision's provenance carries the origin.
- *A second store per country, or files held by the request until publish.*
  The corpus store, its per-chunk country mark and the read filter are sound;
  a second store would be a second ingest path and a move at publish.
- *Checking the file only at publish.* By then four eyes were spent on a
  request that cannot be released; the check belongs before the first write.
- *Refusing the publish itself on other bytes.* An approved request can be
  rejected only once its second review disputed it, so a publish gate would
  leave it approved and stuck. The indexing job fails instead: the records are
  released, the text is read by nobody, and a new request attaches it again.
- *One mutable file per manifestation, with the hash checked at the gates.*
  This was the first fix for swapped bytes, and the second review broke it: the
  bytes could be B while the reviewer read and A again at every gate. A check
  at a point in time says nothing about what a person saw between two points.
- *A content-addressed corpus (the hash as the whole key).* The same guarantee
  for every corpus file, legacy ones included. It changes the corpus's key, its
  object keys and every chunk's `filename`, which is a migration of the store.
  The hash in a text's name gets it for every text attached from now on.

**What the reviews found.** The first version of this amendment compared names
only. Three things followed, each reproduced: the bytes under an attached file
could be swapped by the plain upload, and validation stayed green and the
publish indexed them; a draft could replace the bytes of a released file, which
went live under its country mark before any review; and one person could upload
a PDF, approve alone and publish.

The first fix kept one mutable name per text and compared hashes on propose,
validate, submit and index. The second review walked through it with one
author: attach their own PDF A (pinned), start a URL import of the publisher's
PDF B to the same name, submit while the fetch is in flight (KC-1 passes on
A), let B land (the import answers 409, the bytes stay), let the reviewer read
B and approve, plain-upload A again (equal to the pin, so allowed), publish A.
The root cause was that bytes under a name were mutable and the hash was
checked at points, not bound to what the reviewer saw. Rules four and five are
the answer by design: the name carries the hash and its bytes never change,
and the reviewer, the approval and the index each read the pinned bytes or
nothing. That scenario is a test (`texts.integration.spec.ts`, "the reviewed
race").

The third review found two ways left. First, the two tiers disagreed on what a
ZIP is: the BFF decided by the file's name, the api tier also by the part's
content type. A ZIP sent as `innocent.pdf` with `Content-Type: application/zip`
was hashed as one file no record names, passed the guard, and was extracted by
the api tier over the named text, whose country mark survives a change of
bytes. A member named `x.pdf\0y.pdf` did the same: one ZIP reader keeps the
NUL, the other cuts the name there. The root cause was that the rule "a named
file's bytes never change" was enforced by a tier that does not write the
file, on its own reading of the upload. It is now enforced by the store, and
the two readings are one. Second, "fetched" trusted any `origin: url`, and a
capture any source: one author could propose a source whose host is theirs,
fetch through it in the same draft, approve alone and publish. The sixth rule
now says what a fetch went through and lets only a reviewed source count.

**Operations.** `platform-knowledge-text-import` (a URL),
`platform-knowledge-text-upload` (multipart), `platform-knowledge-text-get`
(the text a manifestation names, or `TEXT_CHANGED`) and
`platform-knowledge-text-list` (where each file belongs), all on the platform door. `platform-knowledge-document-upload`
stays for the corpus itself, and says that no country reads what it adds.

**Deleted.** The advice "upload it, then publish again", and with it the state
in which a published request had no text. Nothing else is removed: the plain
corpus upload stays, because the corpus is also maintained as files (re-ingest,
Dokumentart, removal).

**Ready for another country.** Nothing here names Austria. A German or EU text
is attached in a request of that country and indexed under it; a source for
its publisher is a `source` record of the same request, usable there for 24
hours before it is released (ADR-0174).

**Known limits.**

- The corpus is keyed by file name across all countries. `NAME_TAKEN` keeps two
  records from sharing a name; it does not give a country its own namespace.
- A name the corpus does not hold yet takes any bytes, once. A plain upload
  under a name racing the first revision that names it can therefore be first.
  The file then holds other bytes than its pin for good: the reviewer is
  shown nothing, KC-1 refuses the submit and the approval, and the way out is a
  new proposal of the manifestation, since the same text would take the same
  name. Nothing re-checks a released file's bytes after its indexing; no path
  of the product changes them.
- `built_in` is the BFF's word: it is recorded when no source record, released
  or in this draft, configures the key, and the api tier then answers for the
  key from the repository or not at all. The database cannot see the
  repository, so it takes that word; a `released` origin it checks itself.
- A rollback of a source's release holds what was fetched through it in every
  request not yet approved. A request approved before the rollback stays
  approved, and what it published stays published: withdrawing those is a
  rollback of their own.
- A plain upload named like an attached text (`<key>-<12 hex>.pdf`) is refused
  by the api tier unless the twelve digits are its bytes' hash, so nobody holds
  the name a real import would take. A ZIP that holds one member path twice is
  refused whole in both tiers: one reader keeps the first copy, the other the
  last.
- A text's name carries twelve hex digits of its hash, 48 bits. Two texts of
  one manifestation that collide are refused (`NAME_TAKEN`), never merged.
- A file a record only names (proposed with `corpusFile` set by hand) keeps the
  name it had. Its bytes are as immutable as an attached text's from the
  moment a revision names it.
- A manifestation revision written before revisions kept a hash names a file
  with no `sha256`. In a draft it fails KC-1 until its text is attached again;
  published without one, its indexing run fails with that reason.
- No corpus file is replaced by an upload any more, a legacy one included: to
  change one, a person removes it and uploads it again. That is a change for
  whoever maintained the corpus as files by uploading over a name.
- A file uploaded and published within minutes is first indexed by the job its
  upload queued, which carries no country: `oib_sync.mark_for_reingest` leaves
  a waiting or running job alone. That job no longer makes the file read as
  indexed. Each mark is a new generation on the file's row
  (`oib_corpus_files.mark_generation`, bumped in the transaction that writes
  the mark), a job records the generation it was prepared at
  (`job_mark_generation`), and marking and preparing share the file's lock, so
  a job is prepared wholly before a mark or wholly after it. The write that
  records a file as indexed takes only a job at the current generation
  (`corpus_store.mark_ingested`, one statement); `oib_sync.settle` drops any
  other, and the next sync cycle queues one that carries the mark. Until that
  one is done the index status says pending. No clock is read: the first form
  compared two times to the second, the job's from the api tier and the
  mark's from the database, and missed a mark set in the job's own second or
  inside the skew. A job in flight when these columns arrive has no
  generation and is done once more.
- An attach that finds its manifestation proposed again while the text was
  being stored is refused (409) and names nothing; attaching again names the
  bytes already stored. A file removed from the corpus between an attach's
  check and its write, or the reverse, is not serialised across the two
  tiers: KC-1 then refuses the request until the text is attached again.
- The same bytes attached again from another origin (an upload, then an import
  from a reviewed source) write a new revision, so the text counts as fetched
  from then on.
- The one-shot legacy import (`agent.legacy_corpus_import`) leaves a name the
  corpus holds alone, with the same bytes or others, under the file's lock.
- The corpus page reads a file's country from the records. The country a
  legacy file was marked with at the cut-over (`AT`, with no record naming it)
  is not shown: such a file is listed as named by no record.

**Confirmation.** `bff/base-knowledge/platform/text-checks.spec.ts` (the kit,
without a database) and `texts.integration.spec.ts` under `task db:test:rls`
(a file nobody uploaded is never written; an attached text is published with
an indexing run the corpus accepts, marked with the request's country; a URL
goes to `corpus-text` and nowhere else; a name is one record's; the corpus
page's read; another text of a manifestation is another file and the released
one is untouched; a name that holds other bytes is not replaced; the plain
upload changes no file any revision names, the pinned bytes included; the
reviewed race, step by step; the reviewer is served the pinned bytes or
`TEXT_CHANGED`; other bytes under a named file fail validate, submit and the
approval and are never indexed; an uploaded or merely named text refuses every
approval until another person's `sourceChecked`, and a fetched one is approved
alone).
The same suite holds the third review's cases: a ZIP sent as a PDF, or with
a NUL in a member's name, is refused before the corpus is asked; a text and a
capture fetched through a source their own draft proposes refuse every
approval until another person's `sourceChecked`; a fetch through a source two
people released is approved alone; one through a source its author released
alone is not; a rollback of the source's release holds the fetch again, and a
newer release of the source does not.
`scripts/rls-test-db.sh` (migration 0224 and its down: a built-in source
counts, a draft's does not, a capture stored before the columns or written by
an older build, and the two CHECK constraints).
`upload-hashes.spec.ts` (a ZIP's members by base name; ZIP or PDF by the first
bytes; unsafe member names; one normal form).
`apps/agent-host/tests/test_oib_documents_routes.py` (a name the corpus keeps
takes the same bytes and no others; both reported uploads replace nothing; one
path twice in a ZIP; a name of the attached-text form with other bytes).
`apps/agent-host/tests/test_public_source_capture_route.py` (the
bytes and their read both come from the fetcher, without a fetcher nothing
is fetched, parsed or kept, and a text is kept under the name of its bytes
and never replaced).

## Amendment (2026-11-11): golden cases are records, and the golden run scores them

**The problem.** The original decision left golden runs "for the slice that
brings them", and no slice did. What stood in their place was a scorecard of
twenty Austrian questions that recorded seconds, the model's own confidence and
a source count, with no expected value. It called four answers "high" whose own
reason named an open point (B1, B9, B10 and B11 of the before-baseline in
[`quality-and-cost.md`](../design/international/quality-and-cost.md)), and a
second country had no way to say what a right answer there is. "Better than
before" could not be measured.

**The decision.** A country's quality bar is data, in the same records and the
same review as its law.

- **`golden_case` is a platform record type** (migration 0228, body
  `knowledge_golden_case_revisions`). One case is one question, the `context`
  it needs (the site's territory, project facts by fact key, a reference day),
  what a right answer says (`expected.values`, `expected.edition` with its role,
  `expected.citations` with designation and locus), what it must not do
  (`mustNot`: a phrase in the answer or in the reason of its confidence,
  optionally only at a confidence level or only while the site's records are
  unpublished; or a cited source of a kind) and tags. The schema names no
  country: every word of a law or a language is a value in the record. The kit
  holds a case to an edition and a territory that exist and to at least one
  thing an answer can be held to (KC-1), and to a captured quote like any
  record (KC-6).
- **Every expectation says where it was taken from** (`grounding`: `records`,
  `text` or `unconfirmed`). An unconfirmed expectation is scored and shown and
  never decides a case, so a proposer never has to invent a value to fill the
  schema; the reviewer confirms or rewrites it.
- **`platform-knowledge-golden-run` asks through the real answer path.** Each
  case is an ask (`askAgent`, ADR-0124): the headless turn an outside agent's
  `agent-ask-create` runs, as the operator, in the platform organization, on its
  budget, traced in Langfuse like any turn. The turn's context is resolved for
  the site the case states, and the case's facts stand where a project's would
  (`bff/base-knowledge/golden/turn.ts`); only a conversation a run asked in is
  read that way, and only in the platform organization, so an office's turn
  pays nothing. A run steps (`-golden-run-advance`), four cases at once, the
  load the before-baseline was measured under.
- **A case is scored by what the reader got**: each expected value present, the
  edition named, each citation resolving to a cited source and its locus, no
  must-not violated; with the server seconds of the ask and the turn's cost from
  the usage ledger. The verdicts are kept (`knowledge_golden_run_cases`) and
  written as Langfuse scores on the answer's trace, under a dataset run of the
  dataset `golden-cases`. The score names are declared in
  `agent.observability.golden_scores`, with the six citation scores the review
  names: three the run writes today on golden cases (`edition-named`,
  `claim-citation-resolves`, `law-cited-from-web`), three declared with no
  writer until a citation carries its edition and role
  (`citation-role-resolved`, `edition-agrees`, `binding-claim-without-records`).
- **The answer suite reads the same cases** (`--set golden --cases <file>`,
  `scripts/turn_census/golden_eval.py`), so a prompt or model change is held to
  every country's bar. Its scorer mirrors the door's; one fixture of recorded
  answers holds both to the same verdicts.

**Considered and not chosen.** Scoring on the api tier behind a route, so that
one implementation serves both the door and the suite: the door's run would
then need a second tier to answer before it could keep a verdict, for forty
lines of string matching. The mirror is held by the parity fixture instead. A
case as a ruleset payload: a case is no rule over facts, and a type of its own
gives the reviewer its claims by name.

**Not built here, and why.**

- **A release gate.** A publish does not wait for a run. A run answers on the
  law released to stable, because no turn reads a preview (above, "a head column
  per channel"); a gate that refused a stable publish would have to answer on
  law that is not released yet. `changeRequestId` therefore chooses whose
  *cases* run, never whose law. The gate comes with a preview a turn can read.
- **Role and edition on a citation.** The run reads the edition from the prose
  and the cited source's name. Holding a citation to the edition it was read
  as needs the hit to carry it.
- **Released cases as the suite's input.** The suite runs with no stack, so it
  reads the cases from a file in the records format, today the pack an operator
  proposes from. Reading a release needs the door to export one (the pack export
  the country-as-data review asks for), and until then a case edited in review
  is edited in the file too.
- **Meaning.** A phrase is found or it is not. Whether a sentence that names an
  edition says it binds is a judge's question (`edition_eval.py` asks one); the
  golden scorer asks none, so a must-not is as sharp as the phrase its reviewer
  accepted.

**Confirmation.** `bff/base-knowledge/golden/score.spec.ts` (the scorer; the
seed cases against the Austria pack; the recorded before-baseline, where B1,
B9, B10 and B11 fail on `confident-despite-open-point`),
`tests/test_golden_eval.py` (the mirror, on the same fixture),
`golden/golden-run.integration.spec.ts` under `task db:test:rls` (a case
released and run, the conversation carrying the case's site, cost from the
ledger, preview, entitlement, a tenant reading nothing) and the 0228 block of
`scripts/rls-test-db.sh`.

**Austria's first cases** are `configs/knowledge-packs/at-golden-cases.json`:
the 20 scorecard questions and the dev-acceptance scenarios A1 to A8, proposed
by an operator once the Austria pack is published. 25 of their 66 expectations
are `unconfirmed`: the values that sit in RIS paragraphs or OIB texts this
repository holds no copy of.
