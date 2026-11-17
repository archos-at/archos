// @disk-inputs: ui/features/layout/components/chat-area/chat-message-list.tsx, ui/features/layout/components/chat-area/chat-area-states.tsx, ui/features/layout/components/ChatArea.tsx, ui/features/layout/components/InputArea.tsx, ui/features/layout/components/ChatToolbar.tsx, ui/features/chat/components/NoSourcesBanner.tsx, ui/features/chat/components/ChatUsageNotice.tsx
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { THREAD_COLUMN, THREAD_COLUMN_INNER, THREAD_GUTTER } from './thread-column'

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
    expect(source).not.toMatch(/max-w-\dxl/)
  })

  test('the inner column is the column less the `sm` gutter on both sides', () => {
    expect(THREAD_COLUMN).toContain('max-w-5xl')
    const gutter = rem(THREAD_GUTTER, /sm:pl-\[max\(([\d.]+)rem/)
    expect(rem(THREAD_GUTTER, /sm:pr-\[max\(([\d.]+)rem/)).toBe(gutter)
    expect(rem(THREAD_COLUMN_INNER, /max-w-\[([\d.]+)rem\]/)).toBe(64 - 2 * gutter)
  })
})
