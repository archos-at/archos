/**
 * The project-memory vocabularies, free of drizzle.
 *
 * `db/schema/project-memory.ts` is where they belong by subject and the wrong
 * place to import them FROM: a client component (a memory proposal card, the
 * proposals contract) must not drag the schema into the browser bundle. The
 * tuples live here, the schema imports and re-exports them, so no existing
 * caller moves (the `tasks/task-vocabulary.ts` arrangement).
 */

import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'

export const PROJECT_MEMORY_KINDS = [
  'decision',
  'constraint',
  'open_question',
  'derived_fact',
  'preference',
] as const
export type ProjectMemoryKind = (typeof PROJECT_MEMORY_KINDS)[number]

export const PROJECT_MEMORY_CONFIDENCES = ['low', 'medium', 'high'] as const
export type ProjectMemoryConfidence = (typeof PROJECT_MEMORY_CONFIDENCES)[number]

export const PROJECT_MEMORY_STATUSES = ['active', 'superseded', 'dismissed'] as const
export type ProjectMemoryStatus = (typeof PROJECT_MEMORY_STATUSES)[number]

/**
 * A note of the project's or the office's memory (ADR-0179): born `active`,
 * the only state a digest, a recall or a dedup probe reads. Each move is a
 * compare-and-set against {@link Lifecycle.sourcesOf} in its writer
 * (`memory-service.ts`, `memory-status.ts`); anything else is a 409.
 *
 * - `supersede`: a newer note replaces this one. The write-time consolidation
 *   makes it for an agent's write only on a note that is not human-curated
 *   (pinned, user-confirmed or written by a person: `isAgentSupersedable`);
 *   a correction of a curated note is recorded beside it (`conflicts_with_id`)
 *   instead. A person may make it by hand (the item routes' `status`).
 * - `dismiss`: a person sets a note aside as wrong for now (the closing
 *   debrief, the item routes). No agent write dismisses.
 * - `restore`: a person takes a dismissed or superseded note back. A note
 *   whose text an active note of the shelf already says is refused by the
 *   0010 index (409); restoring a superseded note leaves the note that
 *   replaced it active, for the person to dismiss if they mean to.
 *
 * There was a fourth status, `proposed`: nothing ever wrote it or read it (a
 * proposed memory is a row of `proposals`, ADR-0105, until a person accepts
 * it), so it is gone from the vocabulary. Personal memory
 * (`bff/personal-memory/`) has no status on purpose: removing a personal note
 * deletes it (ADR-0180).
 */
export const PROJECT_MEMORY_LIFECYCLE = defineLifecycle<ProjectMemoryStatus, 'supersede' | 'dismiss' | 'restore'>({
  id: 'project-memory',
  initial: 'active',
  states: {
    active: { on: { supersede: 'superseded', dismiss: 'dismissed' } },
    superseded: { on: { restore: 'active' } },
    dismissed: { on: { restore: 'active' } },
  },
})

export const PROJECT_MEMORY_VERIFICATIONS = [
  'unverified',
  'source_grounded',
  'user_confirmed',
] as const
export type ProjectMemoryVerification = (typeof PROJECT_MEMORY_VERIFICATIONS)[number]
