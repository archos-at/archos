import { z } from 'zod'
import { BadRequestError } from './api-error'

export const DEFAULT_PAGE_LIMIT = 50
export const MAX_PAGE_LIMIT = 200

export const pageQueryShape = {
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_LIMIT)
    .optional()
    .describe(`Default ${DEFAULT_PAGE_LIMIT}, max ${MAX_PAGE_LIMIT}.`),
  cursor: z.string().max(64).optional(),
}

export interface OffsetPage {
  limit: number
  offset: number
}

export interface PageOf<T> {
  items: T[]
  nextCursor: string | null
}

export function offsetPageOf(query: { limit?: number; cursor?: string }): OffsetPage {
  const limit = query.limit ?? DEFAULT_PAGE_LIMIT
  if (query.cursor === undefined || query.cursor === '') return { limit, offset: 0 }
  const offset = Number(query.cursor)
  if (!/^\d+$/.test(query.cursor) || !Number.isSafeInteger(offset)) {
    throw new BadRequestError('Invalid cursor: pass the nextCursor of the previous page.')
  }
  return { limit, offset }
}

export function nextOffsetCursor(page: OffsetPage, fetched: number): string | null {
  return fetched > page.limit ? String(page.offset + page.limit) : null
}

export function pageOfList<T>(rows: readonly T[], page: OffsetPage): { rows: T[]; nextCursor: string | null } {
  return {
    rows: rows.slice(page.offset, page.offset + page.limit),
    nextCursor: nextOffsetCursor(page, rows.length - page.offset),
  }
}

export async function collectPages<T>(
  fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor?: string | null }>
): Promise<T[]> {
  const all: T[] = []
  let cursor: string | null = null
  do {
    const page: { items: T[]; nextCursor?: string | null } = await fetchPage(cursor)
    all.push(...page.items)
    cursor = page.nextCursor ?? null
  } while (cursor !== null)
  return all
}
