import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@/test-utils'
import type { Message } from '@/lib/db/schema/messages'
import type { ChatMessage } from '@/features/chat/types'
import { MessageRenderer } from '@/features/layout/components/chat-area/message-renderer'
import { mapServerMessageToChatMessage } from './server-message-mapper'

const agentResponse = vi.hoisted(() => vi.fn((_props: Record<string, unknown>) => null))

vi.mock('@/features/chat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/chat')>()
  return { ...actual, AgentResponse: (props: Record<string, unknown>) => agentResponse(props) }
})

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
  it('passes them straight off the message', () => {
    const message = {
      id: 'm-1',
      role: 'assistant',
      messageType: 'agent_response',
      content: 'Die Antwort.',
      timestamp: new Date('2026-08-19T10:00:00.000Z'),
      researchTruncated: true,
      truncationReason: 'wall_clock',
      degradedReasons: ['no_valid_citations'],
    } as unknown as ChatMessage

    render(createElement(MessageRenderer, { message }))

    expect(agentResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        truncationReason: 'wall_clock',
        degradedReasons: ['no_valid_citations'],
      })
    )
  })
})
