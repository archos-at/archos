import { parseJsonBody, type ApiContext } from '@/lib/api/handler'
import { BadRequestError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { createFolderSchema, ensureFoldersSchema, updateFolderSchema } from './folder-wire'
import { FOLDER_NAME_TAKEN_REASON } from '@/lib/projects/folder-bin-codes'
import { FOLDER_NAME_TAKEN, type DeleteFolderResult, type FolderRow } from './shelf-folders'

type Outcome<T> = ({ ok: true } & T) | { ok: false; error: string }

function unwrap<T extends object>(outcome: Outcome<T>): T {
  if (outcome.ok) return outcome
  const details = outcome.error === FOLDER_NAME_TAKEN ? { reason: FOLDER_NAME_TAKEN_REASON } : undefined
  throw new BadRequestError(outcome.error, details)
}

export function listFoldersHandler<P>(list: (params: P, session: AuthorizedSession) => Promise<FolderRow[]>) {
  return async ({ session, params }: ApiContext<P>): Promise<unknown> => ({ folders: await list(params, session) })
}

export function createFolderHandler<P>(
  create: (
    params: P,
    session: AuthorizedSession,
    input: { name: string; parentId: string | null },
  ) => Promise<Outcome<{ folder: FolderRow }>>,
) {
  return async ({ session, params, request }: ApiContext<P>): Promise<unknown> => {
    const { name, parentId } = await parseJsonBody(request, createFolderSchema)
    const { folder } = unwrap(await create(params, session, { name, parentId: parentId ?? null }))
    return { folder }
  }
}

export function updateFolderHandler<P extends { folderId: string }>(
  update: (
    params: P,
    session: AuthorizedSession,
    patch: { name?: string; parentId?: string | null; description?: string | null },
    request: Request,
  ) => Promise<Outcome<{ folder: FolderRow }>>,
) {
  return async ({ session, params, request }: ApiContext<P>): Promise<unknown> => {
    const body = await parseJsonBody(request, updateFolderSchema)
    const { folder } = unwrap(
      await update(params, session, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
      }, request),
    )
    return { folder }
  }
}

export function deleteFolderHandler<P extends { folderId: string }>(
  remove: (params: P, session: AuthorizedSession, request: Request) => Promise<Outcome<{ result: DeleteFolderResult }>>,
) {
  return async ({ session, params, request }: ApiContext<P>): Promise<unknown> =>
    unwrap(await remove(params, session, request)).result
}

export function ensureFoldersHandler<P>(
  ensure: (
    params: P,
    session: AuthorizedSession,
    input: { parentId: string | null; paths: string[] },
  ) => Promise<Outcome<{ folders: FolderRow[]; folderIdByPath: Record<string, string> }>>,
) {
  return async ({ session, params, request }: ApiContext<P>): Promise<unknown> => {
    const { parentId, paths } = await parseJsonBody(request, ensureFoldersSchema)
    const { folders, folderIdByPath } = unwrap(
      await ensure(params, session, { parentId: parentId ?? null, paths }),
    )
    return { folders, folderIdByPath }
  }
}
