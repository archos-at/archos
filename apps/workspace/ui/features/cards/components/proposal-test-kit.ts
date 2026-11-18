import { waitFor } from '@/test-utils'
import { http, HttpResponse } from 'msw'
import { expect, vi } from 'vitest'
import { server } from '@/mocks/server'
import { __resetRealtimeConnection } from '@/features/realtime/connection'
import type { ProposedChangeView } from '@/lib/proposals/types'
import { AGENT_KIND } from '@/lib/agent-kind'

export const PROPOSAL_ID = '00000000-0000-4000-8000-0000000000a1'
export const CHANNEL = `proposal:${PROPOSAL_ID}`

type Base = Omit<ProposedChangeView, 'kind' | 'payload'>

export const proposalBase = (patch: Partial<Base> = {}): Base => ({
  id: PROPOSAL_ID,
  projectId: 'proj-1',
  status: 'proposed',
  proposedByKind: AGENT_KIND,
  onBehalfOf: 'user_me',
  onBehalfOfName: 'Mia Huber',
  originConversationId: 'conv-1',
  originMessageId: 'msg-1',
  createdAt: '2026-10-13T08:00:00.000Z',
  decidedBy: null,
  decidedByName: null,
  decidedAt: null,
  results: null,
  canDecide: true,
  ...patch,
})

export const decidedByAnna = (
  status: Base['status'],
  results: Base['results'] = null
): Partial<Base> => ({
  status,
  results,
  decidedBy: 'user_anna',
  decidedByName: 'Anna Berger',
  decidedAt: '2026-10-13T09:29:00.000Z',
  canDecide: false,
})

export const requests: string[] = []
const record = ({ request }: { request: Request }) => {
  requests.push(`${request.method} ${new URL(request.url).pathname}`)
}

export const startRecording = () => {
  requests.length = 0
  server.events.on('request:start', record)
}

export const gets = () => requests.filter((line) => line.startsWith('GET'))

export const serve = (initial: ProposedChangeView) => {
  const state = { current: initial }
  server.use(http.get(`/api/proposals/${PROPOSAL_ID}`, () => HttpResponse.json({ proposal: state.current })))
  return state
}

export class FakeEventSource {
  static instances: FakeEventSource[] = []
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  closed = false
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }
  close() {
    this.closed = true
  }
  open() {
    this.onopen?.(new Event('open'))
  }
  say(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent<string>)
  }
}

export const hint = (status: string, proposalId = PROPOSAL_ID) => ({
  kind: 'event',
  ch: CHANNEL,
  event: { kind: 'proposal.decided', proposalId, status },
})

export const openStream = async (): Promise<FakeEventSource> => {
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
  const stream = FakeEventSource.instances[0]
  stream.open()
  return stream
}

export const useFakeStream = () => vi.stubGlobal('EventSource', FakeEventSource)

export const resetKit = () => {
  server.events.removeAllListeners()
  __resetRealtimeConnection()
  vi.unstubAllGlobals()
  FakeEventSource.instances = []
}
