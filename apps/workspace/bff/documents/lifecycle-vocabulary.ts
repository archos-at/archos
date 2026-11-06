/**
 * The document lifecycle's vocabularies: the states a version passes through,
 * how it began, who submitted it, and whether the document is still in the
 * working set. `./lifecycle-types.ts` re-exports every name, so its callers are
 * unchanged.
 *
 * A leaf, apart from `./lifecycle-types.ts`: the database schema
 * (`db/schema/documents.ts`, `db/schema/document-versions.ts`) and the version
 * repository read these tuples, and they reach hundreds of specs. Importing the
 * whole contract there put its wire schemas, and the mail modules those import
 * (`./mail-origin-schema.ts`), below every one of them
 * (`scripts/blast-radius.mjs`).
 */

/**
 * The editorial states of one version.
 *
 * ```
 * draft → in_review → approved → published → superseded
 *           ├→ changes_requested → (edit, file again) → draft
 *           └→ rejected
 * ```
 *
 * `approved` and `published` stay distinct because approving a Befund on
 * Tuesday and issuing it with the Einreichung on Friday are two acts by two
 * people with two different consequences — and because a later `scheduled`
 * state attaches to publish without touching approval.
 *
 * A tuple, so the set is enumerable at runtime (the CHECK in migration 0082 is
 * generated from it) and the type is derived rather than restated.
 */
export const DOCUMENT_VERSION_STATES = [
  'draft',
  'in_review',
  'changes_requested',
  'approved',
  'published',
  'superseded',
  'rejected',
] as const
export type DocumentVersionState = (typeof DOCUMENT_VERSION_STATES)[number]

/**
 * The states in which a version is still being worked on — at most ONE per
 * document, enforced by a partial unique index in migration 0082.
 *
 * Derived here rather than restated in SQL and in the service: the index's
 * predicate is generated from this list, so widening it is one edit.
 */
export const OPEN_DOCUMENT_VERSION_STATES = [
  'draft',
  'in_review',
  'changes_requested',
] as const satisfies readonly DocumentVersionState[]

/**
 * Whose HAND made a submission (migration 0085).
 *
 * Not whose authority — that is `submitted_by`, and it is a person either way.
 * The distinction exists for exactly one guard: „der Einreichende darf nicht
 * freigeben" is about a person asserting their own work, and a report the agent
 * filed in the commissioning human's session is not their own work.
 */
export const DOCUMENT_SUBMIT_ACTORS = ['human', 'agent'] as const
export type DocumentSubmitActor = (typeof DOCUMENT_SUBMIT_ACTORS)[number]

/**
 * How a version began (migration 0137, ADR-0104).
 *
 * - `upload` — a person put the bytes there (`upload`, born `published`). The
 *   person is the assertion; nobody reviewed it unless somebody asked.
 * - `draft`  — it began as a draft (`create`, a fork), the agent's or a person's
 *   revision, and becomes `published` only through an approval.
 *
 * `document_versions_published_is_approved` demands an approver of a published
 * `draft` and of nothing else, so an upload carries no approval nobody gave.
 */
export const DOCUMENT_VERSION_ORIGINS = ['upload', 'draft'] as const
export type DocumentVersionOrigin = (typeof DOCUMENT_VERSION_ORIGINS)[number]

/** Whether a document is listed by default, or has left the working set. */
export const DOCUMENT_LIFECYCLES = ['active', 'archived'] as const
export type DocumentLifecycle = (typeof DOCUMENT_LIFECYCLES)[number]
