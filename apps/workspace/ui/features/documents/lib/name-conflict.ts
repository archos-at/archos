import { splitDocumentName } from '@/lib/documents/display-name'
import { documentAliasKey } from '@/lib/documents/name-match'

export const CONFLICT_CHOICES = ['replace', 'keep_both', 'skip'] as const
export type ConflictChoice = (typeof CONFLICT_CHOICES)[number]
export type SentConflictChoice = Exclude<ConflictChoice, 'skip'>

export const NAME_CONFLICT_REASON = 'name_conflict'

export type ConflictOperation = 'upload' | 'move'

export interface ConflictRow {
  key: string
  path: string
  name: string
  existingName?: string
  within: 'folder' | 'drop'
  choice: ConflictChoice
  keepBothAs: string
}

export const nameMatchKey = documentAliasKey

export function nextFreeDocumentName(name: string, takenKeys: ReadonlySet<string>): string {
  const { stem, extension } = splitDocumentName(name.normalize('NFC').trim())
  for (let number = 2; ; number += 1) {
    const candidate = `${stem} ${number}${extension}`
    if (!takenKeys.has(nameMatchKey(candidate))) return candidate
  }
}

export interface NameConflict {
  name: string
  folderId: string | null
  existingDocumentId: string | null
  existingName: string
  suggestedName: string
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null)

export function nameConflictOf(body: unknown): NameConflict | null {
  if (!body || typeof body !== 'object') return null
  const details = (body as { details?: unknown }).details
  const source = (details && typeof details === 'object' ? details : body) as Record<string, unknown>
  if (source.reason !== NAME_CONFLICT_REASON) return null
  const name = text(source.name)
  if (!name) return null
  return {
    name,
    folderId: text(source.folderId),
    existingDocumentId: text(source.existingDocumentId),
    existingName: text(source.existingName) ?? name,
    suggestedName: text(source.suggestedName) ?? nextFreeDocumentName(name, new Set([nameMatchKey(name)])),
  }
}

export async function nameConflictOfResponse(response: Response): Promise<NameConflict | null> {
  if (response.status !== 409) return null
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null)
  return nameConflictOf(body)
}

export function conflictListText(paths: readonly string[]): string {
  return paths.join('\n')
}

export function movePatchBody(folderId: string | null, onConflict?: SentConflictChoice): string {
  return JSON.stringify(onConflict ? { folderId, onConflict } : { folderId })
}

export function moveConflictRow(
  document: { id: string; name: string },
  conflict: NameConflict,
): ConflictRow {
  return {
    key: document.id,
    path: document.name,
    name: document.name,
    existingName: conflict.existingName,
    within: 'folder',
    choice: 'keep_both',
    keepBothAs: conflict.suggestedName,
  }
}
