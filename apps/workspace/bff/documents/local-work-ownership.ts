export const BACKGROUND_JOB_METADATA_FIELD = 'bffJobId'

export interface LocalWorkOwnership {
  storageKey?: string
  backgroundJobId?: string | null
  unnamedCounts?: boolean
}

export interface LocalWorkRow {
  status: string
  storageKey: string | null
  metadata: unknown
}

function namedBackgroundJob(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const named = (metadata as Record<string, unknown>)[BACKGROUND_JOB_METADATA_FIELD]
  return typeof named === 'string' ? named : null
}

export function localWorkOwnsRow(row: LocalWorkRow, owned: LocalWorkOwnership): boolean {
  if (row.status !== 'processing') return false
  if (owned.storageKey && row.storageKey !== owned.storageKey) return false
  if (!owned.backgroundJobId) return true
  const named = namedBackgroundJob(row.metadata)
  if (named === null) return owned.unnamedCounts === true
  return named === owned.backgroundJobId
}
