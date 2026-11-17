import { z } from 'zod'

export interface DocumentListCursor {
  createdAt: string
  id: string
}

const MICROSECOND_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/

export const CURSOR_TIMESTAMP_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US'

const cursorSchema = z.object({
  t: z.string().regex(MICROSECOND_UTC),
  i: z.guid(),
})

export const DOCUMENT_LIST_CURSOR_MAX_LENGTH = 200

export function encodeDocumentListCursor(cursor: DocumentListCursor): string {
  return Buffer.from(JSON.stringify({ t: cursor.createdAt, i: cursor.id }), 'utf8').toString('base64url')
}

export function decodeDocumentListCursor(encoded: string): DocumentListCursor | null {
  if (encoded.length === 0 || encoded.length > DOCUMENT_LIST_CURSOR_MAX_LENGTH) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const result = cursorSchema.safeParse(parsed)
  if (!result.success) return null
  return { createdAt: result.data.t, id: result.data.i }
}

export const DOCUMENT_LEVEL_SORTS = ['added', 'name', 'size'] as const
export type DocumentLevelSort = (typeof DOCUMENT_LEVEL_SORTS)[number]

export const DOCUMENT_LEVEL_DIRECTIONS = ['asc', 'desc'] as const
export type DocumentLevelDirection = (typeof DOCUMENT_LEVEL_DIRECTIONS)[number]

export interface DocumentLevelCursor {
  sort: DocumentLevelSort
  dir: DocumentLevelDirection
  value: string
  id: string
}

const INTEGER_TEXT = /^-?\d{1,12}$/

const LEVEL_CURSOR_VALUE_MAX_LENGTH = 1024

export const DOCUMENT_LEVEL_CURSOR_MAX_LENGTH = 6000

const levelCursorSchema = z
  .object({
    s: z.enum(DOCUMENT_LEVEL_SORTS),
    d: z.enum(DOCUMENT_LEVEL_DIRECTIONS),
    v: z.string().max(LEVEL_CURSOR_VALUE_MAX_LENGTH),
    i: z.guid(),
  })
  .refine(({ s, v }) => (s === 'added' ? MICROSECOND_UTC.test(v) : s === 'size' ? INTEGER_TEXT.test(v) : true))

export function encodeDocumentLevelCursor(cursor: DocumentLevelCursor): string {
  return Buffer.from(
    JSON.stringify({ s: cursor.sort, d: cursor.dir, v: cursor.value, i: cursor.id }),
    'utf8',
  ).toString('base64url')
}

export function decodeDocumentLevelCursor(encoded: string): DocumentLevelCursor | null {
  if (encoded.length === 0 || encoded.length > DOCUMENT_LEVEL_CURSOR_MAX_LENGTH) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const result = levelCursorSchema.safeParse(parsed)
  if (!result.success) return null
  return { sort: result.data.s, dir: result.data.d, value: result.data.v, id: result.data.i }
}

export const documentListCursorParam = z
  .string()
  .max(DOCUMENT_LEVEL_CURSOR_MAX_LENGTH)
  .refine(
    (value) => decodeDocumentListCursor(value) !== null || decodeDocumentLevelCursor(value) !== null,
    { message: 'Invalid cursor' },
  )
  .optional()
