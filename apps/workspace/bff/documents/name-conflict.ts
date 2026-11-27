import { z } from 'zod'
import { BadRequestError, ConflictError } from '@/lib/api/errors'
import { documentDisplayName } from './display-name'
import {
  NAME_CONFLICT_REASON,
  NAME_CONFLICT_RESOLUTIONS,
  REPLACE_UNAVAILABLE_REASON,
  WITHOUT_REPLACE,
  nameConflictMessage,
  type NameConflict,
  type NameConflictResolution,
} from './name-conflict-wire'

export const nameConflictResolutionSchema = z.enum(NAME_CONFLICT_RESOLUTIONS)

export class NameConflictError extends ConflictError {
  constructor(
    readonly conflict: NameConflict,
    message = `${nameConflictMessage(conflict)} Ask the person, then send onConflict: replace, keep_both (stored as suggestedName) or skip.`,
  ) {
    super(message, conflict)
  }
}

export class RenameConflictError extends NameConflictError {
  constructor(conflict: NameConflict) {
    super(conflict, `${nameConflictMessage(conflict)} Choose another name, such as "${conflict.suggestedName}".`)
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
