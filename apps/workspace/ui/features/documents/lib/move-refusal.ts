import {
  FOLDER_DELETED_REASON,
  FOLDER_NAME_TAKEN_REASON,
  IFC_IN_RESTRICTED_FOLDER,
} from '@/lib/projects/folder-bin-codes'

export type ShelfRefusal =
  | 'readOnly'
  | 'nameTaken'
  | 'ifcRestricted'
  | 'gone'

interface RefusalBody {
  code?: string
  details?: { code?: string; reason?: string }
}

export async function shelfRefusalOf(response: Response): Promise<ShelfRefusal | null> {
  if (response.status === 403) return 'readOnly'
  const body = (await Promise.resolve()
    .then(() => response.json())
    .catch(() => ({}))) as RefusalBody
  const { code, reason } = body.details ?? {}
  if (code === IFC_IN_RESTRICTED_FOLDER) return 'ifcRestricted'
  if (reason === FOLDER_NAME_TAKEN_REASON) return 'nameTaken'
  if (reason === FOLDER_DELETED_REASON) return 'gone'
  return null
}

export class ShelfRequestError extends Error {
  constructor(readonly refusal: ShelfRefusal | null, status: number) {
    super(`Shelf request failed (${status})`)
  }
}

export async function throwUnlessOk(response: Response): Promise<void> {
  if (response.ok) return
  throw new ShelfRequestError(await shelfRefusalOf(response), response.status)
}

export const refusalOf = (error: unknown): ShelfRefusal | null =>
  error instanceof ShelfRequestError ? error.refusal : null
