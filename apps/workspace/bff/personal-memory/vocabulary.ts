/**
 * The words of a personal memory note (ADR-0180), in a file with no schema
 * import so a client component can read them without pulling the database
 * schema into the browser bundle (`bff/projects/memory-vocabulary.ts` says why).
 *
 * Two kinds, and the pair is the quality filter: a note that is neither how
 * the person wants the agent to work nor who the person is at the office is
 * not about the person, and belongs to the project or nowhere.
 */

/** `preference`: how the person wants the agent to work. `profile`: their role, responsibilities and recurring topics. */
export const PERSONAL_MEMORY_KINDS = ['preference', 'profile'] as const
export type PersonalMemoryKind = (typeof PERSONAL_MEMORY_KINDS)[number]

/** Who wrote the note: the agent in a turn, the person in the panel, or the reflection stage after an answer. */
export const PERSONAL_MEMORY_PROVENANCES = ['agent', 'user', 'distillation'] as const
export type PersonalMemoryProvenance = (typeof PERSONAL_MEMORY_PROVENANCES)[number]

/** The longest note the store keeps; migration 0229's CHECK holds the same number. */
export const PERSONAL_MEMORY_MAX_CONTENT_CHARS = 2000
