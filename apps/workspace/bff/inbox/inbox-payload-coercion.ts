import 'server-only'
import { markMentionsSchema, type MarkMention } from '@/lib/annotations/types'

export function coerceText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed
}

export function coerceMentions(value: unknown): MarkMention[] {
  const parsed = markMentionsSchema.safeParse(value)
  return parsed.success ? parsed.data : []
}

export function coerceVariant(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z][a-z_]{0,31}$/.test(value) ? value : null
}

export function coerceDay(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

export function coerceCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10_000 ? value : null
}

export function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}
