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

**Amended 2026-11-10 (migration 0216):** every change request needs a domain expert's approval, besides counsel and a privacy reviewer where ADR-0174 asks for them; before, one approval in any role approved a request that needed no other role. A trigger holds a request's status to its lifecycle (draft → submitted → approved → published → rolled back, or rejected), and moves it to approved only once every role it needs has approved it and no claim is edited, rejected or unreviewed. Drafting takes `platform:knowledge:write`, review and release `platform:knowledge:review`, no longer `platform:settings:manage`.

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
