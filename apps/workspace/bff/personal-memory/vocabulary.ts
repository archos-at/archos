export const PERSONAL_MEMORY_KINDS = ['preference', 'profile'] as const
export type PersonalMemoryKind = (typeof PERSONAL_MEMORY_KINDS)[number]

export const PERSONAL_MEMORY_PROVENANCES = ['agent', 'user', 'distillation'] as const
export type PersonalMemoryProvenance = (typeof PERSONAL_MEMORY_PROVENANCES)[number]

export const PERSONAL_MEMORY_MAX_CONTENT_CHARS = 2000
