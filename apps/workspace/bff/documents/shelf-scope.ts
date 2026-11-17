import { z } from 'zod'
import { BadRequestError } from '@/lib/api/api-error'
import type { DocumentShelf } from './shelf'

export const SHELF_SCOPES = ['project', 'office_shelf'] as const
export type ShelfScope = (typeof SHELF_SCOPES)[number]

export const shelfSelectorFields = {
  scope: z
    .enum(SHELF_SCOPES)
    .optional()
    .describe('Default `project` (with `projectId`).'),
  projectId: z.string().min(1).optional(),
}

export function shelfOf(selector: { scope?: ShelfScope; projectId?: string }, request: Request): DocumentShelf {
  const fromQuery = new URL(request.url).searchParams.get('scope')
  const scope = selector.scope ?? (fromQuery === 'office_shelf' ? 'office_shelf' : 'project')
  if (scope === 'office_shelf') {
    if (selector.projectId) throw new BadRequestError('projectId names a project; the office shelf takes none')
    return { kind: 'office_shelf' }
  }
  if (!selector.projectId) throw new BadRequestError('projectId is required for the project shelf')
  return { kind: 'project', projectId: selector.projectId }
}
