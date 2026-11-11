/**
 * @vitest-environment node
 *
 * A switch made before the conversation's row exists (ADR-0180 rule 2). The
 * create carries the flag the chat had when it was sent; a switch made while
 * that create is in flight must not be lost, and one that the create already
 * carried must not be sent twice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { markConversationMinted, markConversationOnServer, resetConversationsOnServer } from './conversation-on-server'
import { resetTemporarySettling, setConversationTemporary } from './temporary-conversation'
import { recordCreatedTemporary, resetCreatedTemporary } from './temporary-created'
import { useChatStore } from '../store'
import type { Conversation } from '../types'

const fetchMock = vi.fn()
const conversation: Conversation = {
  id: 'c-1',
  userId: 'u-1',
  title: '',
  messages: [],
  createdAt: new Date('2026-11-10T08:00:00Z'),
  updatedAt: new Date('2026-11-10T08:00:00Z'),
}
const stored = (): boolean | undefined => useChatStore.getState().conversations[0]?.temporary
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  useChatStore.setState({ currentConversation: conversation, conversations: [conversation] })
  markConversationMinted('c-1')
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetConversationsOnServer()
  resetTemporarySettling()
  resetCreatedTemporary()
  useChatStore.setState({ currentConversation: null, conversations: [] })
})

describe('setConversationTemporary before the row exists', () => {
  it('asks nothing when the create carried the choice', async () => {
    await setConversationTemporary('c-1', true)
    recordCreatedTemporary('c-1', true)
    markConversationOnServer('c-1')
    await settled()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(stored()).toBe(true)
  })

  it('sends the choice once the row exists when the create went out without it', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'c-1', temporary: true }))
    await setConversationTemporary('c-1', true)
    // The create was sent before the switch: the server answered `false`.
    recordCreatedTemporary('c-1', false)
    markConversationOnServer('c-1')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    expect(fetchMock.mock.calls[0][0]).toBe('/api/conversations/c-1')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ temporary: true })
    expect(stored()).toBe(true)
  })

  it('takes the server’s word when that follow-up fails, so the screen claims nothing it does not hold', async () => {
    fetchMock.mockResolvedValueOnce(new Response('down', { status: 502 }))
    await setConversationTemporary('c-1', true)
    recordCreatedTemporary('c-1', false)
    markConversationOnServer('c-1')

    await vi.waitFor(() => expect(stored()).toBe(false))
  })

  it('two switches before the create wait once and settle on the last word', async () => {
    await setConversationTemporary('c-1', true)
    await setConversationTemporary('c-1', false)
    recordCreatedTemporary('c-1', false)
    markConversationOnServer('c-1')
    await settled()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(stored()).toBe(false)
  })
})
