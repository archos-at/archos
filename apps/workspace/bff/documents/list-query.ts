import { z } from 'zod'
import { BadRequestError } from '@/lib/api/api-error'
import { DOCUMENT_AUTHORS, type DocumentAuthor } from './document-authors'
import { DOCUMENT_READ_FAMILIES, type DocumentReadFamily } from './document-status'
import { shelfSelectorFields } from './shelf-scope'
import {
  DOCUMENT_LEVEL_DIRECTIONS,
  DOCUMENT_LEVEL_SORTS,
  decodeDocumentLevelCursor,
  documentListCursorParam,
  type DocumentLevelCursor,
  type DocumentLevelDirection,
  type DocumentLevelSort,
} from './list-cursor'

export const DOCUMENT_LEVEL_PAGE_SIZE = 100

export const DOCUMENT_LEVEL_LIMIT_MIN = 1
export const DOCUMENT_LEVEL_LIMIT_MAX = 500

export const DOCUMENT_LEVEL_QUERY_MAX_LENGTH = 200

const STATE_LIST = new RegExp(`^(${DOCUMENT_READ_FAMILIES.join('|')})(,(${DOCUMENT_READ_FAMILIES.join('|')}))*$`)

export const documentListFilterSchema = z.object({
  authoredBy: z.enum(DOCUMENT_AUTHORS).optional(),
  includeArchived: z.literal('true').optional(),
  cursor: documentListCursorParam,
  folderId: z.union([z.literal('root'), z.guid()]).optional(),
  sort: z.enum(DOCUMENT_LEVEL_SORTS).optional(),
  dir: z.enum(DOCUMENT_LEVEL_DIRECTIONS).optional(),
  q: z.string().max(DOCUMENT_LEVEL_QUERY_MAX_LENGTH).optional(),
  state: z
    .string()
    .max(100)
    .regex(STATE_LIST)
    .optional()
    .describe('Comma-separated read-state families.'),
  limit: z.coerce.number().int().optional(),
})

export type DocumentListFilter = z.infer<typeof documentListFilterSchema>

const STATE_DESCRIPTION =
  `Read-state families, comma-separated: ${DOCUMENT_READ_FAMILIES.join(', ')}. ` +
  'Held files await a reviewer (quarantine-list); review requests are in inbox-list, filter `requests`.'

export const documentListQuerySchema = documentListFilterSchema.extend({
  ...shelfSelectorFields,
  state: documentListFilterSchema.shape.state.describe(STATE_DESCRIPTION),
})

export const documentSummaryFilterSchema = documentListFilterSchema.pick({ authoredBy: true, includeArchived: true })

export type DocumentSummaryFilter = z.infer<typeof documentSummaryFilterSchema>

export interface DocumentLevelQuery {
  folderId?: string | null
  sort: DocumentLevelSort
  dir: DocumentLevelDirection
  q?: string
  states?: readonly DocumentReadFamily[]
  limit: number
  cursor?: DocumentLevelCursor
}

export interface DocumentListOptions {
  authoredBy?: DocumentAuthor
  includeArchived: boolean
  level: DocumentLevelQuery
}

export function documentListOptions(query: DocumentListFilter): DocumentListOptions {
  return {
    authoredBy: query.authoredBy,
    includeArchived: query.includeArchived === 'true',
    level: documentLevelQuery(query),
  }
}

export function documentLevelQuery(query: DocumentListFilter): DocumentLevelQuery {
  const sort = query.sort ?? 'added'
  const dir = query.dir ?? (sort === 'name' ? 'asc' : 'desc')
  const q = query.q?.trim() ?? ''
  return {
    folderId: query.folderId === undefined ? undefined : query.folderId === 'root' ? null : query.folderId,
    sort,
    dir,
    ...(q === '' ? {} : { q }),
    ...(query.state ? { states: [...new Set(query.state.split(','))] as DocumentReadFamily[] } : {}),
    limit: clampLevelLimit(query.limit),
    ...(query.cursor ? { cursor: levelCursorFor(query.cursor, sort, dir) } : {}),
  }
}

export function clampLevelLimit(limit: number | undefined): number {
  if (limit === undefined) return DOCUMENT_LEVEL_PAGE_SIZE
  return Math.min(Math.max(DOCUMENT_LEVEL_LIMIT_MIN, limit), DOCUMENT_LEVEL_LIMIT_MAX)
}

function levelCursorFor(encoded: string, sort: DocumentLevelSort, dir: DocumentLevelDirection): DocumentLevelCursor {
  const cursor = decodeDocumentLevelCursor(encoded)
  if (!cursor) throw new BadRequestError('Invalid cursor: this cursor belongs to the shelf listing')
  if (cursor.sort !== sort || cursor.dir !== dir) {
    throw new BadRequestError('Invalid cursor: it was read under another order')
  }
  return cursor
}
