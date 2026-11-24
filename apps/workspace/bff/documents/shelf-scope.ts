import { z } from 'zod'
import { BadRequestError } from '@/lib/api/api-error'
import type { DocumentShelf } from './shelf'

export const SHELF_SCOPES = ['project', 'office_shelf', 'personal'] as const
export type ShelfScope = (typeof SHELF_SCOPES)[number]

export const SHARED_SHELF_SCOPES = ['project', 'office_shelf'] as const

export const agentShelfScope = {
  scope: z
    .enum(SHARED_SHELF_SCOPES)
    .optional()
    .describe('Default `project` (with `projectId`).'),
}

export const shelfSelectorFields = {
  scope: z
    .enum(SHELF_SCOPES)
    .optional()
    .describe('Default `project` (with `projectId`). `personal` is always the caller’s own shelf.'),
  projectId: z.string().min(1).optional(),
}

const isShelfScope = (value: string | null): value is ShelfScope =>
  value !== null && (SHELF_SCOPES as readonly string[]).includes(value)

export function shelfOf(
  selector: { scope?: ShelfScope; projectId?: string },
  request: Request,
  reader: { userId: string },
): DocumentShelf {
  const fromQuery = new URL(request.url).searchParams.get('scope')
  const scope = selector.scope ?? (isShelfScope(fromQuery) ? fromQuery : 'project')
  if (scope !== 'project') {
    if (selector.projectId) throw new BadRequestError(`projectId names a project; the ${scope} shelf takes none`)
    return scope === 'office_shelf' ? { kind: 'office_shelf' } : { kind: 'personal', userId: reader.userId }
  }
  if (!selector.projectId) throw new BadRequestError('projectId is required for the project shelf')
  return { kind: 'project', projectId: selector.projectId }
}
