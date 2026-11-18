import { act, useEffect } from 'react'
import { expect, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { fireEvent, screen, waitFor, within } from '@/test-utils'
import { server } from '@/mocks/server'
import type { TurnSocket, TurnSocketOptions } from '@/adapters/api/turn-socket'
import type { ClientMessage } from '@/adapters/api/wire-v2'
import type { RoomFrame, RoomPost } from '@/lib/annotations/room-types'
import type { AnnotationView } from '@/lib/annotations/types'
import { eventOf, frameOf } from '@/test-utils/wire-v2-fixtures'
import { createCanvasTurnClient, type CanvasTurnClientOptions } from '../../lib/canvas-turn-client'
import { useDocumentReview, type ReviewRevision } from '../../hooks/use-document-review'
import type { RoomTransport } from '../../hooks/use-document-room'
import { useCheckFixed } from './check-fixed'
import { AgentAnswerCard } from './agent-answer-card'
import { ReviewPageLayer } from './review-page-layer'
import { ReviewPanel } from './review-panel'
import { DraftCard, ThreadCard } from './thread-card'

export const view = (overrides: Partial<AnnotationView>): AnnotationView => ({
  id: 'ann_1',
  documentId: 'doc_1',
  number: 1,
  page: 1,
  shape: 'point',
  x: 0.25,
  y: 0.5,
  w: null,
  h: null,
  kind: 'defect',
  body: 'Tür ohne Feuerwiderstandsklasse',
  basis: null,
  authorKind: 'person',
  status: 'open',
  assigneeUserId: null,
  assigneeName: null,
  dueOn: null,
  revisionNumber: 2,
  onCurrentRevision: true,
  createdBy: 'user_me',
  createdByName: 'Miriam Hofer',
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
  acceptedBy: null,
  acceptedByName: null,
  closedBy: null,
  closedByName: null,
  closedAt: null,
  delegatedBy: null,
  delegatedByName: null,
  delegatedAt: null,
  replies: [],
  canEdit: true,
  canDelete: true,
  ...overrides,
})

export const pickerOption = (scope: HTMLElement, targetId: string): HTMLElement => {
  const row = within(scope)
    .getAllByTestId('mention-option')
    .find((option) => option.getAttribute('data-target-id') === targetId)
  if (!row) throw new Error(`no picker row for ${targetId}`)
  return row
}

export function scriptedRoom() {
  let deliver: ((frame: RoomFrame) => void) | null = null
  const posts: RoomPost[] = []
  const transport: RoomTransport = {
    connect({ onFrame, onOpen }) {
      deliver = onFrame
      onOpen()
      onFrame({ kind: 'welcome', self: { userId: 'user_me', name: 'Miriam Hofer', kind: 'person' } })
      return () => {
        deliver = null
      }
    },
    post: (post) => posts.push(post),
  }
  return { transport, posts, send: (frame: RoomFrame) => act(() => deliver?.(frame)) }
}

export const ANNA = { peerId: 'peer_anna_0001', userId: 'user_anna', name: 'Anna Berger', kind: 'person' as const }

export function scriptedAgent() {
  const sent: ClientMessage[] = []
  let options: TurnSocketOptions | null = null
  const socket: TurnSocket = {
    connect: async () => options?.onStatus?.('open'),
    send: (message) => {
      sent.push(message)
      return true
    },
    accepts: (entry) => entry === 'steer',
    reconnect: () => {},
    close: () => {},
  }
  const createClient = (given: CanvasTurnClientOptions) =>
    createCanvasTurnClient({
      ...given,
      createSocket: (socketOptions) => {
        options = socketOptions
        return socket
      },
    })
  const questions = () =>
    sent.filter((message): message is Extract<ClientMessage, { message_id: string }> => message.type === 'user_message')
  return {
    sent,
    questions,
    createClient,
    deliver: (seq: number, body: Record<string, unknown>) => {
      const turnId = questions().at(-1)?.message_id ?? 'turn-1'
      act(() => options?.onEvent(eventOf(frameOf(seq, body, turnId))))
    },
  }
}

export function Harness({
  transport,
  onReady,
  agent,
  canPickAssignee = false,
  revision = null,
}: {
  transport: RoomTransport
  onReady?: (review: ReturnType<typeof useDocumentReview>) => void
  agent?: ReturnType<typeof scriptedAgent>
  canPickAssignee?: boolean
  revision?: ReviewRevision | null
}) {
  const review = useDocumentReview('doc_1', {
    enabled: true,
    transport,
    revision,
    piloti: agent ? { projectId: 'proj_1', fileName: 'Grundriss.pdf', createClient: agent.createClient } : undefined,
  })
  const checkFixed = useCheckFixed(review, { documentName: 'Grundriss Index C.pdf', revisionLabel: 'Revision 3' })
  useEffect(() => {
    onReady?.(review)
  })
  const selected = review.annotations.find((annotation) => annotation.id === review.selectedId)
  return (
    <>
      <div data-testid="sheet" style={{ position: 'relative', width: 800, height: 600 }}>
        <div>
          <ReviewPageLayer
            page={1}
            review={review}
            focused
            renderAsk={(ask, { placement }) => <AgentAnswerCard review={review} ask={ask} placement={placement} />}
            renderThread={({ placement }) =>
              review.draft ? (
                <DraftCard review={review} draft={review.draft} placement={placement} canPickAssignee={canPickAssignee} />
              ) : selected ? (
                <ThreadCard review={review} annotation={selected} placement={placement} canPickAssignee={canPickAssignee} />
              ) : null
            }
          />
        </div>
      </div>
      <button type="button" onClick={() => review.setTool('region')}>
        region tool
      </button>
      <button type="button" onClick={() => review.setTool('point')}>
        point tool
      </button>
      <button type="button" onClick={() => review.setTool('ask')}>
        agent tool
      </button>
      {/* A mark of an earlier Fassung is not on the sheet: its thread opens on its own, as the review places it. */}
      {selected && !selected.onCurrentRevision && (
        <ThreadCard review={review} annotation={selected} placement="detached" canPickAssignee={canPickAssignee} />
      )}
      <ReviewPanel review={review} onOpen={(annotation) => review.select(annotation.id)} onCheckFixed={checkFixed} />
    </>
  )
}

export const serve = (annotations: AnnotationView[], canAnnotate = true, agentWakes = false) =>
  server.use(
    http.get('/api/documents/:id/annotations', () => HttpResponse.json({ annotations, canAnnotate, pilotiWakes: agentWakes })),
    http.get('/api/documents/:id/annotations/:annotationId', ({ params }) => {
      const found = annotations.find((annotation) => annotation.id === params.annotationId)
      return found
        ? HttpResponse.json({ annotation: found })
        : HttpResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 })
    })
  )

export function captureSurface() {
  const capture = within(screen.getByTestId('sheet')).getByTestId('review-capture')
  vi.spyOn(capture, 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect)
  capture.setPointerCapture = () => {}
  return capture
}

export function serveConversation() {
  const posted: Array<{ path: string; body: unknown }> = []
  server.use(
    http.post('/api/documents/:id/thread', async ({ request }) => {
      posted.push({ path: 'thread', body: await request.json() })
      return HttpResponse.json({ conversationId: 's_thread_doc_1' })
    }),
    http.post('/api/conversations', async ({ request }) => {
      posted.push({ path: 'conversation', body: await request.json() })
      return HttpResponse.json({}, { status: 201 })
    }),
    http.post('/api/conversations/:id/messages', async ({ request }) => {
      posted.push({ path: 'message', body: await request.json() })
      return HttpResponse.json([], { status: 201 })
    })
  )
  return posted
}

export async function askAboutABox(agent: ReturnType<typeof scriptedAgent>) {
  await userEvent.click(screen.getByRole('button', { name: 'agent tool' }))
  const capture = captureSurface()
  fireEvent.pointerDown(capture, { button: 0, clientX: 80, clientY: 120, pointerId: 1 })
  fireEvent.pointerMove(capture, { clientX: 320, clientY: 300, pointerId: 1 })
  fireEvent.pointerUp(capture, { clientX: 320, clientY: 300, pointerId: 1 })

  const card = await screen.findByTestId('agent-answer-card')
  expect(within(card).getByTestId('agent-composer')).toBeInTheDocument()
  expect(within(screen.getByTestId('sheet')).getByTestId('agent-ask-box')).toHaveAttribute('data-status', 'composing')
  await userEvent.click(within(card).getByTestId('agent-quick-dimensions'))
  await waitFor(() => expect(agent.questions()).toHaveLength(1))
}
