import { nameConflictOf, type NameConflict, type NameConflictResolution } from '@/lib/documents/name-conflict'

export type ConflictChoice = NameConflictResolution
export type SentConflictChoice = Exclude<ConflictChoice, 'skip'>

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
  document: { id: string; name: string; path: string },
  conflict: NameConflict,
): ConflictRow {
  return {
    key: document.id,
    path: document.path,
    name: document.name,
    existingName: conflict.existingName,
    within: 'folder',
    choice: 'keep_both',
    keepBothAs: conflict.suggestedName,
  }
}
