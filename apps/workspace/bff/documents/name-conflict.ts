import { z } from 'zod'
import { BadRequestError, ConflictError } from '@/lib/api/errors'
import { documentDisplayName, splitDocumentName } from './display-name'
import { documentNameKey, documentNameMatchKey } from './name-match'

export const NAME_CONFLICT_REASON = 'name_conflict'

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
}

export class NameConflictError extends ConflictError {
  constructor(readonly conflict: NameConflict) {
    super(
      `A document named "${conflict.existingName}" is already in this folder. Ask the person, then send onConflict: replace, keep_both (stored as suggestedName) or skip.`,
      conflict,
    )
  }
}

export function nameConflictWith(
  holder: { id: string; filename: string; displayName?: string | null },
  name: string,
  folderId: string | null,
  suggestedName: string,
): NameConflict {
  return {
    reason: NAME_CONFLICT_REASON,
    name,
    folderId,
    existingDocumentId: holder.id,
    existingName: documentDisplayName(holder),
    suggestedName,
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
  return {
    reason: NAME_CONFLICT_REASON,
    name,
    folderId: text(fields.folderId),
    existingDocumentId,
    existingName: text(fields.existingName) ?? name,
    suggestedName,
  }
}
