// @disk-inputs: ui/features/layout/components/chat-area/message-renderer.tsx

import { describe, expect, it } from 'vitest'
import type { Message } from '@/lib/db/schema/messages'
import { mapServerMessageToChatMessage } from './server-message-mapper'

const stored = (provenance: Record<string, unknown>): Message =>
  ({
    id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    conversationId: 's_conv_1',
    role: 'assistant',
    content: 'Die Antwort.',
    metadata: { provenance },
    createdAt: '2026-08-19T10:00:00.000Z' as unknown as Date,
  }) as Message

const restored = (provenance: Record<string, unknown>) =>
  mapServerMessageToChatMessage(stored(provenance))!

describe('a reopened thread restores the cause and the degradations', () => {
  it('puts both onto the message', () => {
    const out = restored({
      researchTruncated: true,
      truncationReason: 'wall_clock',
      degradedReasons: ['no_valid_citations'],
    })
    expect(out.researchTruncated).toBe(true)
    expect(out.truncationReason).toBe('wall_clock')
    expect(out.degradedReasons).toEqual(['no_valid_citations'])
  })

  it('restores a degraded run that was never truncated', () => {
    const out = restored({ degradedReasons: ['no_report_file'] })
    expect(out.degradedReasons).toEqual(['no_report_file'])
    expect(out.researchTruncated).toBeUndefined()
  })

  it('writes nothing for an empty or absent list', () => {
    expect(restored({ degradedReasons: [] }).degradedReasons).toBeUndefined()
    expect(restored({}).degradedReasons).toBeUndefined()
  })

  it('drops non-string entries rather than passing them to the localizer', () => {
    const out = restored({ degradedReasons: ['no_report_file', 3, ''] })
    expect(out.degradedReasons).toEqual(['no_report_file'])
  })
})

describe('ChatArea hands both props to the answer', () => {
  it('passes them straight off the message', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('ui/features/layout/components/chat-area/message-renderer.tsx', 'utf8')
    expect(source).toContain('truncationReason={message.truncationReason}')
    expect(source).toContain('degradedReasons={message.degradedReasons}')
  })
})
