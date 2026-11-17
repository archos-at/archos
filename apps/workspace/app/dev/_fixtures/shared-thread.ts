import { useChatStore } from '@/features/chat/store'
import { PRODUCT_NAME } from '@/lib/brand'

const ME = 'default-user'
const ANNA = 'user_anna'
const TOBIAS = 'user_tobias'

const CONVERSATION_ID = 'dev-shared-conv'

const PEOPLE = {
  [ME]: {
    userId: ME,
    name: 'Matthias Bigl',
    email: 'matthias@example.com',
    profilePictureUrl: null,
  },
  [ANNA]: { userId: ANNA, name: 'Anna Berger', email: 'anna@example.com', profilePictureUrl: null },
  [TOBIAS]: {
    userId: TOBIAS,
    name: 'Tobias Kern',
    email: 'tobias@example.com',
    profilePictureUrl: null,
  },
}

const at = (minute: number): string => new Date(Date.UTC(2026, 6, 29, 9, minute, 0)).toISOString()

const MESSAGE_ROWS = [
  {
    id: 'm1',
    conversationId: CONVERSATION_ID,
    role: 'user',
    authorUserId: ME,
    content:
      'Wir brauchen für den Wohnbau Nord den Nachweis für den zweiten Fluchtweg. Gilt die 40-m-Grenze auch für das nördliche Treppenhaus?',
    metadata: { messageType: 'user' },
    createdAt: at(2),
  },
  {
    id: 'm2',
    conversationId: CONVERSATION_ID,
    role: 'assistant',
    authorUserId: null,
    content:
      'Ja. Nach OIB-Richtlinie 2 darf die Gehweglänge bis zum Ausgang ins Freie oder in einen anderen Brandabschnitt 40 m nicht überschreiten. Für das nördliche Treppenhaus ergeben die Pläne 34 m, der Nachweis ist damit erbracht.',
    metadata: { messageType: 'agent_response', citations: undefined },
    createdAt: at(3),
  },
  {
    id: 'm3',
    conversationId: CONVERSATION_ID,
    role: 'user',
    authorUserId: ANNA,
    content: 'Danke – ich hänge den Fluchtwegplan gleich an, damit wir dieselbe Fassung prüfen.',
    metadata: { messageType: 'user' },
    createdAt: at(8),
  },
  {
    id: 'm4',
    conversationId: CONVERSATION_ID,
    role: 'user',
    authorUserId: ANNA,
    content: 'Achtung: im EG ist der Durchgang zum Innenhof laut Bestandsplan verschlossen.',
    metadata: { messageType: 'user' },
    createdAt: at(9),
  },
  {
    id: 'm5',
    conversationId: CONVERSATION_ID,
    role: 'user',
    authorUserId: TOBIAS,
    content:
      'Dann zählt der Innenhof nicht als zweiter Rettungsweg. @' + PRODUCT_NAME + ' wie wirkt sich das auf den Nachweis aus?',
    metadata: {
      messageType: 'user',
      mentions: [{ targetId: 'agent:piloti', display: PRODUCT_NAME }],
      addressees: { agent: true, users: [] },
    },
    createdAt: at(11),
  },
]

const HANDBACK_ROWS = [
  MESSAGE_ROWS[0],
  MESSAGE_ROWS[1],
  {
    id: 'h1',
    conversationId: CONVERSATION_ID,
    role: 'user',
    authorUserId: ME,
    content:
      '@Anna Berger stimmt das für den Bestand? Der Durchgang zum Innenhof ist laut Plan verschlossen.',
    metadata: {
      messageType: 'user',
      mentions: [{ targetId: ANNA, display: 'Anna Berger' }],
      addressees: { agent: false, users: [ANNA] },
    },
    createdAt: at(9),
  },
  {
    id: 'h2',
    conversationId: CONVERSATION_ID,
    role: 'user',
    authorUserId: ANNA,
    content:
      'Ja, verschlossen — im Bestandsplan von 2019 als Fluchtweg gestrichen. Der Innenhof zählt nicht.',
    metadata: { messageType: 'user', addressees: { agent: false, users: [] } },
    createdAt: at(14),
  },
]

const SHARING_STATE = {
  resourceType: 'conversation',
  resourceId: CONVERSATION_ID,
  visibility: 'project',
  allowedVisibilities: ['private', 'project'],
  myRole: 'collaborator',
  canManage: false,
  canEscalate: false,
  shared: true,
  entries: [
    { person: PEOPLE[ANNA], role: 'owner', reason: 'creator', grantedBy: null },
    { person: PEOPLE[ME], role: 'collaborator', reason: 'grant', grantedBy: ANNA },
    { person: PEOPLE[TOBIAS], role: 'collaborator', reason: 'visibility-project', grantedBy: null },
  ],
}

const variant = (): string | null =>
  typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('variant')

const isHandbackVariant = (): boolean => variant() === 'handback'
const isLiveVariant = (): boolean => variant() === 'live'

const LIVE_FRAMES: unknown[] = [
  {
    type: 'system_intermediate_message',
    id: 'st1',
    content: { name: 'Function Start: knowledge_search', payload: 'Rettungswege Innenhof' },
    status: 'in_progress',
  },
  {
    type: 'system_intermediate_message',
    id: 'st2',
    content: {
      name: 'Function Complete: knowledge_search',
      payload: '3 Treffer in OIB-Richtlinie 2',
    },
    status: 'complete',
  },
  {
    type: 'system_intermediate_message',
    id: 'st3',
    content: {
      name: 'Function Start: shallow_research_agent',
      payload: 'OIB-Richtlinie 2, Abschnitt 3 wird gelesen',
    },
    status: 'in_progress',
  },
  {
    type: 'system_response_message',
    id: 'r0',
    parent_id: 'live-turn',
    content: { text: '' },
    status: 'in_progress',
    answer_meta: {
      v: 1,
      kind: 'ruling',
      topic: 'Innenhof als zweiter Rettungsweg',
      verdict: { value: 'Nein', subject: 'Innenhof als zweiter Rettungsweg' },
    },
  },
  {
    type: 'system_response_message',
    id: 'r1',
    parent_id: 'live-turn',
    content: { text: 'Nein. Ein Innenhof zählt nur dann als zweiter Rettungsweg, wenn er ' },
    status: 'in_progress',
  },
  {
    type: 'system_response_message',
    id: 'r2',
    parent_id: 'live-turn',
    content: { text: 'ins Freie führt und dauerhaft begehbar ist. Ist der Durchgang im EG ' },
    status: 'in_progress',
  },
  {
    type: 'system_response_message',
    id: 'r3',
    parent_id: 'live-turn',
    content: { text: 'verschlossen, entfällt er als Rettungsweg' },
    status: 'in_progress',
  },
]

export function installSharedThreadShim(): void {
  if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') return
  const w = window as unknown as { __sharedThreadShim?: boolean }
  if (!w.__sharedThreadShim) {
    w.__sharedThreadShim = true
    const real = window.fetch.bind(window)
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const href =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const url = new URL(href, window.location.origin).pathname

      if (url === `/api/conversations/${CONVERSATION_ID}`) {
        return Response.json({
          id: CONVERSATION_ID,
          title: 'Brandschutz Stiegenhaus Nord',
          createdAt: at(0),
          updatedAt: at(11),
          shared: true,
          myRole: 'collaborator',
          visibility: 'project',
          myReadState: { lastReadAt: at(4), lastReadMessageId: 'm2' },
        })
      }
      if (url === `/api/conversations/${CONVERSATION_ID}/messages`) {
        return Response.json({
          messages: isHandbackVariant() ? HANDBACK_ROWS : MESSAGE_ROWS,
          nextCursor: null,
        })
      }
      if (url === `/api/conversations/${CONVERSATION_ID}/awaiting`) {
        return Response.json({ pending: [], awaitingMe: false })
      }
      if (url === `/api/sharing/conversation/${CONVERSATION_ID}`) {
        return Response.json(SHARING_STATE)
      }
      if (url === `/api/conversations/${CONVERSATION_ID}/read`) {
        return Response.json({ ok: true })
      }
      return real(input, init)
    }

    class PreviewEventSource {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSED = 2
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      onerror: (() => void) | null = null

      constructor(url: string) {
        const isFrameRelay = url.endsWith('/live')
        setTimeout(() => {
          this.onopen?.()
          if (isFrameRelay) {
            this.replayFrames()
            return
          }
          if (isHandbackVariant()) return
          this.emitEnvelope({
            kind: 'conversation.turn',
            conversationId: CONVERSATION_ID,
            phase: 'started',
            actorUserId: TOBIAS,
          })
          if (isLiveVariant()) {
            setTimeout(
              () =>
                this.emitEnvelope({
                  kind: 'conversation.typing',
                  conversationId: CONVERSATION_ID,
                  userId: ANNA,
                  typing: true,
                  ttlMs: 600_000,
                }),
              600
            )
          }
        }, 40)
      }

      private emitEnvelope(event: unknown): void {
        this.onmessage?.({ data: JSON.stringify({ id: 'preview-1', at: at(11), event }) })
      }

      private replayFrames(): void {
        LIVE_FRAMES.forEach((payload, index) => {
          setTimeout(
            () =>
              this.onmessage?.({
                data: JSON.stringify({ kind: 'frame', seq: index + 1, payload }),
              }),
            30 * (index + 1)
          )
        })
      }

      close(): void {}
      addEventListener(): void {}
      removeEventListener(): void {}
    }
    ;(window as unknown as { EventSource: unknown }).EventSource = PreviewEventSource
  }
}

export function seedSharedThread(): void {
  useChatStore.setState({
    currentUserId: ME,
    currentConversation: {
      id: CONVERSATION_ID,
      userId: ANNA,
      projectId: 'dev',
      title: 'Brandschutz Stiegenhaus Nord',
      messages: [],
      createdAt: new Date(at(0)),
      updatedAt: new Date(at(11)),
    },
    conversations: [
      {
        id: CONVERSATION_ID,
        userId: ANNA,
        projectId: 'dev',
        title: 'Brandschutz Stiegenhaus Nord',
        messages: [],
        createdAt: new Date(at(0)),
        updatedAt: new Date(at(11)),
      },
    ],
    hasHydrated: true,
  })
}
