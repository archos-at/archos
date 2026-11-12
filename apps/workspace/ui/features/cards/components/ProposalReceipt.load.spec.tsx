/**
 * A receipt card whose read of the proposal failed (ADR-0105).
 *
 * The card's read is one state: loading, loaded or failed. Failed means there
 * is no object to draw or decide, so the card says so and offers nothing to
 * press; and failed is not final. The card asks again on what already makes it
 * re-read: its channel coming up or saying something, and the reader coming
 * back to the tab. The other receipt specs (`ProposalReceipts.spec.tsx`) hold
 * the loaded card.
 */
import { act, render, screen, waitFor } from '@/test-utils'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '@/mocks/server'
import type { ProposedChangeView } from '@/lib/proposals/types'
import { resetDecidedProposals } from '../decided-proposals'
import { HTTP_PROPOSAL_TRANSPORT, ProposalTransportProvider } from '../hooks/proposal-transport'
import { MemoryProposalCard } from './MemoryProposalCard'
import {
  decidedByAnna,
  gets,
  openStream,
  PROPOSAL_ID,
  proposalBase,
  resetKit,
  startRecording,
  useFakeStream,
} from './proposal-test-kit'

const mockStoreState = () => ({
  projectId: 'proj-1',
  currentConversation: { id: 'conv-1', messages: [{ id: 'msg-1', cardInteractions: undefined }] },
  conversations: [],
  setCardDecision: vi.fn(),
})

vi.mock('@/features/chat/store', () => {
  const useChatStore = (selector: (s: ReturnType<typeof mockStoreState>) => unknown) => selector(mockStoreState())
  useChatStore.getState = () => mockStoreState()
  return { useChatStore }
})

type MemoryProposal = Extract<ProposedChangeView, { kind: 'memory' }>

const NOTE = 'Das Büro setzt bei GK 4 durchgängig REI 90 an.'

const memoryProposal = (patch: Partial<MemoryProposal> = {}): MemoryProposal => ({
  ...proposalBase(),
  kind: 'memory',
  payload: { scope: 'organization', kind: 'preference', content: NOTE, confidence: 'high', supersedes: null },
  ...patch,
})

const memoryCard = (
  <MemoryProposalCard
    title="Remember this?"
    content={NOTE}
    kind="preference"
    confidence="high"
    proposalId={PROPOSAL_ID}
    messageId="msg-1"
    cardKey="memory_proposal-0"
  />
)

/** The reads the server answers, in order: a proposal, or `'down'` for a 502. The last one repeats. */
const serveReads = (...answers: Array<MemoryProposal | 'down'>) => {
  let read = 0
  server.use(
    http.get(`/api/proposals/${PROPOSAL_ID}`, () => {
      const answer = answers[Math.min(read, answers.length - 1)]
      read += 1
      return answer === 'down'
        ? HttpResponse.json({ error: 'Bad gateway' }, { status: 502 })
        : HttpResponse.json({ proposal: answer })
    })
  )
}

const LOAD_ERROR = 'The state of this proposal could not be loaded.'

const comeBackToTheTab = () => act(() => void window.dispatchEvent(new Event('focus')))

beforeEach(() => startRecording())

afterEach(() => {
  resetKit()
  resetDecidedProposals()
})

describe('a receipt card whose first read failed', () => {
  it('says so, offers nothing to press, and reads again when its channel comes up', async () => {
    useFakeStream()
    serveReads('down', memoryProposal())
    render(memoryCard)

    expect(await screen.findByText(LOAD_ERROR)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()

    await openStream()

    expect(await screen.findByRole('button', { name: 'Apply' })).toBeInTheDocument()
    expect(screen.queryByText(LOAD_ERROR)).toBeNull()
  })

  it('reads again when the reader comes back to the tab, where there is no channel', async () => {
    serveReads('down', 'down', memoryProposal())
    render(
      <ProposalTransportProvider value={{ ...HTTP_PROPOSAL_TRANSPORT, live: false }}>{memoryCard}</ProposalTransportProvider>
    )
    expect(await screen.findByText(LOAD_ERROR)).toBeInTheDocument()

    // Still down: the card stays as it is, and the next return asks again.
    comeBackToTheTab()
    await waitFor(() => expect(gets()).toHaveLength(2))
    expect(screen.getByText(LOAD_ERROR)).toBeInTheDocument()

    comeBackToTheTab()

    expect(await screen.findByRole('button', { name: 'Apply' })).toBeInTheDocument()
    expect(screen.queryByText(LOAD_ERROR)).toBeNull()
  })

  it('stops asking once the proposal is read', async () => {
    serveReads('down', memoryProposal(decidedByAnna('dismissed')))
    render(
      <ProposalTransportProvider value={{ ...HTTP_PROPOSAL_TRANSPORT, live: false }}>{memoryCard}</ProposalTransportProvider>
    )
    expect(await screen.findByText(LOAD_ERROR)).toBeInTheDocument()

    comeBackToTheTab()
    expect(await screen.findByTestId('proposal-decided-by')).toHaveTextContent(/^Discarded by Anna Berger · /)
    comeBackToTheTab()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })

    expect(gets()).toHaveLength(2)
  })
})

describe('a click that came second, whose re-read failed', () => {
  // „Could not be loaded“ beside „Apply“ and „Discard“ was two answers at once:
  // the object the buttons would decide is the one that could not be read.
  it('shows the failed read alone, then the colleague’s decision once it can be read', async () => {
    serveReads(memoryProposal(), 'down', memoryProposal(decidedByAnna('dismissed')))
    server.use(
      http.post(`/api/proposals/${PROPOSAL_ID}/apply`, () =>
        HttpResponse.json({ error: 'Already decided', code: 'PROPOSAL_DECIDED' }, { status: 409 })
      )
    )
    const user = userEvent.setup()
    // The stream is never opened here, so the only reads are the first one,
    // the 409's and the one the return to the tab asks for.
    useFakeStream()
    render(memoryCard)
    await user.click(await screen.findByRole('button', { name: 'Apply' }))

    expect(await screen.findByText(LOAD_ERROR)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()

    comeBackToTheTab()

    expect(await screen.findByTestId('proposal-decided-by')).toHaveTextContent(/^Discarded by Anna Berger · /)
    expect(screen.getByTestId('proposal-overtaken')).toBeInTheDocument()
    // The shell cross-fades: the outgoing body is still in the DOM for a moment.
    await waitFor(() => expect(screen.queryByText(LOAD_ERROR)).toBeNull())
  })
})
