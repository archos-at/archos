import {
  NAME_CONFLICT_RESOLUTIONS,
  REPLACE_UNAVAILABLE_REASON,
  nameConflictOf,
  type NameConflict,
  type NameConflictResolution,
} from '@/lib/documents/name-conflict-wire'

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
  choices?: readonly ConflictChoice[]
}

export function choicesOf(row: Pick<ConflictRow, 'within' | 'choices'>): readonly ConflictChoice[] {
  if (row.within === 'drop') return ['keep_both', 'skip']
  return row.choices ?? NAME_CONFLICT_RESOLUTIONS
}

export async function replaceUnavailableOfResponse(response: Response): Promise<readonly ConflictChoice[] | null> {
  if (response.status !== 409) return null
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null)
  const details = body && typeof body === 'object' ? (body as { details?: unknown }).details : null
  if (!details || typeof details !== 'object') return null
  const { reason, choices } = details as { reason?: unknown; choices?: unknown }
  if (reason !== REPLACE_UNAVAILABLE_REASON) return null
  const offered = Array.isArray(choices) ? NAME_CONFLICT_RESOLUTIONS.filter((choice) => choices.includes(choice)) : []
  return offered.length > 0 ? offered : ['keep_both', 'skip']
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

export function uploadConflictRow(file: { key: string; path: string; name: string }, conflict: NameConflict): ConflictRow {
  return {
    ...file,
    existingName: conflict.existingName,
    within: 'folder',
    choice: 'keep_both',
    keepBothAs: conflict.suggestedName,
    ...(conflict.choices ? { choices: conflict.choices } : {}),
  }
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
    ...(conflict.choices ? { choices: conflict.choices } : {}),
  }
}
