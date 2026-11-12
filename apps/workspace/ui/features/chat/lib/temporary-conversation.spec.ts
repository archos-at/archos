/**
 * @vitest-environment node
 *
 * The temporary switch wired to the store, the create and the turn (ADR-0180
 * rule 2). The machine's every move is in `temporary-switch-machine.spec.ts`;
 * this holds the wiring: the create's reports reach the switch, the store
 * keeps what the server holds, and a turn waits while the two differ.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { markConversationMinted, markConversationOnServer, resetConversationsOnServer } from './conversation-on-server'
import { afterTemporarySettled, onTemporaryRefused, resetTemporarySettling, setConversationTemporary } from './temporary-conversation'
import { recordCreateStarted, recordCreatedTemporary, resetCreatedTemporary } from './temporary-created'
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

/** The create answered: the store's create path reports this, then marks the row. */
function rowCreated(temporary: boolean): void {
  recordCreatedTemporary('c-1', temporary)
  markConversationOnServer('c-1')
}

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

describe('a switch before the row exists', () => {
  it('is carried by the create: nothing else is sent and no turn waits', () => {
    setConversationTemporary('c-1', true)
    expect(stored()).toBe(true)
    recordCreateStarted('c-1', true)
    const send = vi.fn()
    afterTemporarySettled('c-1', send)
    expect(send).toHaveBeenCalledTimes(1)
    rowCreated(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('a switch while the create is in flight', () => {
  // The race: switched after the create left without the flag, then sent at
  // once. Before the machine the store said `true` here, the turn opened on
  // the created row, and the PATCH came after.
  it('keeps the store at what the create carries and holds the turn until the PATCH is answered', async () => {
    let answer!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
    recordCreateStarted('c-1', false)
    setConversationTemporary('c-1', true)
    expect(stored()).toBeFalsy()

    const send = vi.fn()
    afterTemporarySettled('c-1', send)
    rowCreated(false)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ temporary: true })
    expect(send).not.toHaveBeenCalled()
    expect(stored()).toBeFalsy()

    answer(Response.json({ id: 'c-1', temporary: true }))
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(stored()).toBe(true)
  })

  it('when the PATCH fails, the store stays at the created row, the person is told, and the turn goes on honestly', async () => {
    fetchMock.mockResolvedValueOnce(new Response('down', { status: 502 }))
    const refused = vi.fn()
    const stop = onTemporaryRefused(refused)
    recordCreateStarted('c-1', false)
    setConversationTemporary('c-1', true)
    const send = vi.fn()
    afterTemporarySettled('c-1', send)
    rowCreated(false)

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    expect(refused).toHaveBeenCalledTimes(1)
    expect(stored()).toBeFalsy()
    stop()
  })
})

describe('a stored chat', () => {
  it('is switched with one PATCH and the store takes the server’s answer', async () => {
    markConversationOnServer('c-1')
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'c-1', temporary: true }))
    setConversationTemporary('c-1', true)
    expect(stored()).toBeFalsy()
    await vi.waitFor(() => expect(stored()).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
