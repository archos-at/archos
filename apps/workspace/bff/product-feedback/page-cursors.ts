import 'server-only'
import type { ProductFeedback } from '@/lib/db/schema/product-feedback'

export function encodeCursor(row: Pick<ProductFeedback, 'createdAt' | 'id'>): string {
  return `${new Date(row.createdAt).toISOString()}|${row.id}`
}

export function decodeCursor(cursor: string | undefined): { createdAt: Date; id: string } | undefined {
  if (!cursor) return undefined
  const [iso, id] = cursor.split('|')
  const createdAt = new Date(iso ?? '')
  if (!id || Number.isNaN(createdAt.getTime())) return undefined
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined
  return { createdAt, id }
}

const OFFSET_CURSOR = /^o:(\d{1,6})$/

export function decodeOffset(cursor: string | undefined): number {
  const match = cursor ? OFFSET_CURSOR.exec(cursor) : null
  return match ? Number(match[1]) : 0
}
