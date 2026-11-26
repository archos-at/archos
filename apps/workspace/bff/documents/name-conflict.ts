import { z } from 'zod'
import { BadRequestError, ConflictError } from '@/lib/api/errors'
import { documentDisplayName, splitDocumentName } from './display-name'
import { documentNameKey, documentNameMatchKey } from './name-match'

export const NAME_CONFLICT_REASON = 'name_conflict'
export const REPLACE_UNAVAILABLE_REASON = 'replace_unavailable'

export const NAME_CONFLICT_RESOLUTIONS = ['replace', 'keep_both', 'skip'] as const
export type NameConflictResolution = (typeof NAME_CONFLICT_RESOLUTIONS)[number]
export const nameConflictResolutionSchema = z.enum(NAME_CONFLICT_RESOLUTIONS)

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

export class NameConflictError extends ConflictError {
  constructor(readonly conflict: NameConflict) {
    super(
      `${nameConflictMessage(conflict)} Ask the person, then send onConflict: replace, keep_both (stored as suggestedName) or skip.`,
      conflict,
    )
  }
}

export class ReplaceUnavailableError extends ConflictError {
  constructor(readonly documentId: string) {
    super('Meine Ablage has no bin, so replacing on a move would delete this document for good. Keep both, or skip.', {
      reason: REPLACE_UNAVAILABLE_REASON,
      documentId,
      choices: WITHOUT_REPLACE,
    })
  }
}

export function nameConflictWith(
  holder: { id: string; filename: string; displayName?: string | null },
  name: string,
  folderId: string | null,
  suggestedName: string,
  choices?: readonly NameConflictResolution[],
): NameConflict {
  return {
    reason: NAME_CONFLICT_REASON,
    name,
    folderId,
    existingDocumentId: holder.id,
    existingName: documentDisplayName(holder),
    suggestedName,
    ...(choices ? { choices } : {}),
  }
}

export function nextFreeDocumentName(name: string, takenKeys: ReadonlySet<string>): string {
  const { stem, extension } = splitDocumentName(documentNameKey(name))
  for (let number = 2; ; number += 1) {
    const candidate = `${stem} ${number}${extension}`
    if (!takenKeys.has(documentNameMatchKey(candidate))) return candidate
  }
}

export function readNameConflictResolution(value: FormDataEntryValue | null): NameConflictResolution | undefined {
  if (value === null || value === '') return undefined
  const parsed = nameConflictResolutionSchema.safeParse(value)
  if (!parsed.success) {
    throw new BadRequestError(`onConflict must be one of ${NAME_CONFLICT_RESOLUTIONS.join(', ')}`, {
      reason: 'invalid_on_conflict',
    })
  }
  return parsed.data
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
