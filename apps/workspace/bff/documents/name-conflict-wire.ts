export const NAME_CONFLICT_REASON = 'name_conflict'
export const REPLACE_UNAVAILABLE_REASON = 'replace_unavailable'

export const NAME_CONFLICT_RESOLUTIONS = ['replace', 'keep_both', 'skip'] as const
export type NameConflictResolution = (typeof NAME_CONFLICT_RESOLUTIONS)[number]

export interface NameConflict {
  reason: typeof NAME_CONFLICT_REASON
  name: string
  folderId: string | null
  existingDocumentId: string
  existingName: string
  suggestedName: string
  choices?: readonly NameConflictResolution[]
}

export const WITHOUT_REPLACE: readonly NameConflictResolution[] = ['keep_both', 'skip']

export function nameConflictMessage(conflict: NameConflict): string {
  return `A document named "${conflict.existingName}" is already in this folder.`
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null)

export function nameConflictOf(body: unknown): NameConflict | null {
  if (!body || typeof body !== 'object') return null
  const details = (body as { details?: unknown }).details
  if (!details || typeof details !== 'object') return null
  const fields = details as Record<string, unknown>
  const name = text(fields.name)
  const existingDocumentId = text(fields.existingDocumentId)
  const suggestedName = text(fields.suggestedName)
  if (fields.reason !== NAME_CONFLICT_REASON || !name || !existingDocumentId || !suggestedName) return null
  const choices = Array.isArray(fields.choices)
    ? NAME_CONFLICT_RESOLUTIONS.filter((choice) => (fields.choices as unknown[]).includes(choice))
    : null
  return {
    reason: NAME_CONFLICT_REASON,
    name,
    folderId: text(fields.folderId),
    existingDocumentId,
    existingName: text(fields.existingName) ?? name,
    suggestedName,
    ...(choices ? { choices } : {}),
  }
}
