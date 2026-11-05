// @disk-inputs: ui/features/layout/components/chat-area/chat-message-list.tsx, ui/features/layout/components/chat-area/chat-area-states.tsx, ui/features/layout/components/ChatArea.tsx, ui/features/layout/components/InputArea.tsx, ui/features/layout/components/ChatToolbar.tsx, ui/features/chat/components/NoSourcesBanner.tsx, ui/features/chat/components/ChatUsageNotice.tsx
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { THREAD_COLUMN, THREAD_COLUMN_INNER, THREAD_GUTTER } from './thread-column'

/**
 * Ticket #38, topic 8: the answer stood wider than the input under it, because
 * the transcript said `max-w-5xl` and the composer `max-w-4xl`. Every surface of
 * the chat column takes its width from `thread-column.ts`, and none spells one
 * of its own, so the two cannot drift apart again.
 */
const ROOT = join(__dirname, '..', '..', '..')

const COLUMN_SURFACES = [
  'ui/features/layout/components/chat-area/chat-message-list.tsx',
  'ui/features/layout/components/chat-area/chat-area-states.tsx',
  'ui/features/layout/components/ChatArea.tsx',
  'ui/features/layout/components/InputArea.tsx',
  'ui/features/layout/components/ChatToolbar.tsx',
  'ui/features/chat/components/NoSourcesBanner.tsx',
  'ui/features/chat/components/ChatUsageNotice.tsx',
] as const

const rem = (cls: string, pattern: RegExp): number => {
  const match = cls.match(pattern)
  if (!match) throw new Error(`no ${pattern} in ${cls}`)
  return Number(match[1])
}

describe('the chat column', () => {
  test.each(COLUMN_SURFACES)('%s takes its width from thread-column.ts', (path) => {
    const source = readFileSync(join(ROOT, path), 'utf8')
    expect(source).toContain("from '@/components/ui/thread-column'")
    // A Tailwind max-width scale step (`max-w-4xl`, `max-w-5xl`) is a column of
    // its own. Small, local caps (`max-w-md`, `max-w-[420px]`) are not columns.
    expect(source).not.toMatch(/max-w-\dxl/)
  })

  test('the inner column is the column less the `sm` gutter on both sides', () => {
    // max-w-5xl is 64rem in Tailwind's scale.
    expect(THREAD_COLUMN).toContain('max-w-5xl')
    const gutter = rem(THREAD_GUTTER, /sm:pl-\[max\(([\d.]+)rem/)
    expect(rem(THREAD_GUTTER, /sm:pr-\[max\(([\d.]+)rem/)).toBe(gutter)
    expect(rem(THREAD_COLUMN_INNER, /max-w-\[([\d.]+)rem\]/)).toBe(64 - 2 * gutter)
  })
})
