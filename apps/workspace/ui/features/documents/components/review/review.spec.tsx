import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { fireEvent, render, screen, waitFor, within } from '@/test-utils'
import { installLayoutObservers } from '@/test-utils/layout-observers'
import { server } from '@/mocks/server'
import { useDocumentReview } from '../../hooks/use-document-review'
import { useChatStore } from '@/features/chat/store'
import { view, scriptedRoom, ANNA, Harness, serve } from './review.fixtures'

beforeEach(() => useChatStore.setState({ currentUserId: 'user_me' }))
beforeEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe('the review', () => {
  it('walks the marks the sheet draws in the order the list shows them: proposals first, ghosts too; K from nothing is the last', async () => {
    serve([
      view({ id: 'a', number: 1 }),
      view({ id: 'b', number: 2 }),
      view({ id: 'p', number: 3, authorKind: 'piloti', status: 'proposed' }),
      view({ id: 'ghost', number: 4, onCurrentRevision: false }),
      view({ id: 'gone', number: 5, onCurrentRevision: false, status: 'resolved' }),
      view({ id: 'done', number: 6, status: 'resolved' }),
    ])
    let review: ReturnType<typeof useDocumentReview> | null = null
    render(<Harness transport={scriptedRoom().transport} onReady={(next) => (review = next)} />)
    await screen.findAllByTestId('review-pin')

    const walked: Array<string | undefined> = []
    for (let i = 0; i < 5; i += 1) act(() => void walked.push(review?.step(1)?.id))
    expect(walked).toEqual(['p', 'a', 'b', 'ghost', 'p'])

    act(() => review?.select(null))
    let back: string | undefined
    act(() => void (back = review?.step(-1)?.id))
    expect(back).toBe('ghost')

    await userEvent.click(screen.getByTestId('review-filter-closed'))
    act(() => review?.select(null))
    const closed: Array<string | undefined> = []
    for (let i = 0; i < 2; i += 1) act(() => void closed.push(review?.step(1)?.id))
    expect(closed).toEqual(['done', 'done'])
  })

  it('says each row’s number and state to a screen reader, the pin being drawn for the eye only', async () => {
    serve([
      view({ id: 'a', number: 1 }),
      view({ id: 'p', number: 3, authorKind: 'piloti', status: 'proposed', kind: 'question' }),
      view({ id: 'r', number: 2, status: 'resolved' }),
    ])
    render(<Harness transport={scriptedRoom().transport} />)

    const rows = await screen.findAllByTestId('review-row')
    expect(rows.map((row) => row.querySelector('[data-slot="comment-pin"]')?.getAttribute('aria-hidden'))).toEqual(['true', 'true'])
    expect(rows[0]).toHaveAccessibleName(/^Annotation 3: Question · proposal\. /)
    expect(rows[1]).toHaveAccessibleName(/^Annotation 1: Defect\. Tür ohne Feuerwiderstandsklasse/)

    await userEvent.click(screen.getByTestId('review-filter-closed'))
    expect(screen.getByTestId('review-row')).toHaveAccessibleName(/^Annotation 2: Defect · resolved\. /)
  })

  it('draws a point as a pin and a region as a box with its pin at the corner', async () => {
    serve([
      view({ id: 'a', number: 1 }),
      view({ id: 'b', number: 2, shape: 'region', x: 0.1, y: 0.2, w: 0.3, h: 0.25, kind: 'question' }),
      view({ id: 'c', number: 3, onCurrentRevision: false }),
    ])
    render(<Harness transport={scriptedRoom().transport} />)

    const pins = await within(screen.getByTestId('sheet')).findAllByTestId('review-pin')
    expect(pins).toHaveLength(2)
    const region = within(screen.getByTestId('sheet')).getByTestId('review-region')
    expect(region.style.left).toBe('10%')
    expect(region.style.width).toBe('30%')
    expect(screen.getAllByTestId('review-row')).toHaveLength(3)
  })

  it('sets a region dragged out with the region tool, through the API, from this tab', async () => {
    serve([])
    const posted: Array<{ body: unknown; peer: string | null }> = []
    server.use(
      http.post('/api/documents/:id/annotations', async ({ request }) => {
        posted.push({ body: await request.json(), peer: request.headers.get('x-room-peer') })
        return HttpResponse.json(
          { annotation: view({ id: 'new', shape: 'region', x: 0.1, y: 0.2, w: 0.3, h: 0.3, kind: 'question' }) },
          { status: 201 }
        )
      })
    )
    const room = scriptedRoom()
    render(<Harness transport={room.transport} />)
    await screen.findByTestId('review-empty')

    await userEvent.click(screen.getByRole('button', { name: 'region tool' }))
    const capture = within(screen.getByTestId('sheet')).getByTestId('review-capture')
    vi.spyOn(capture, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON: () => ({}),
    } as DOMRect)
    capture.setPointerCapture = () => {}
    fireEvent.pointerDown(capture, { button: 0, clientX: 80, clientY: 120, pointerId: 1 })
    fireEvent.pointerMove(capture, { clientX: 320, clientY: 300, pointerId: 1 })
    fireEvent.pointerUp(capture, { clientX: 320, clientY: 300, pointerId: 1 })

    const draft = await screen.findByTestId('review-draft')
    await userEvent.click(within(draft).getByTestId('thread-kind-question'))
    await userEvent.type(within(draft).getByTestId('review-draft-body'), 'Raumhöhe nachweisen?{Enter}')

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0].body).toEqual({
      page: 1,
      shape: 'region',
      x: 0.1,
      y: 0.2,
      w: 0.3,
      h: 0.3,
      kind: 'question',
      body: 'Raumhöhe nachweisen?',
      assigneeUserId: null,
      dueOn: null,
    })
    expect(posted[0].peer).toMatch(/^[A-Za-z0-9]{12,}$/)
  })

  it("takes the agent's proposal over: the thread says what it is, and taking it over opens it", async () => {
    serve([view({ id: 'p', authorKind: 'piloti', status: 'proposed', basis: 'OIB-RL 2, Pkt. 3.4', canDelete: false })])
    const patched: unknown[] = []
    server.use(
      http.patch('/api/documents/:id/annotations/:annotationId', async ({ request }) => {
        patched.push(await request.json())
        return HttpResponse.json({ annotation: view({ id: 'p', authorKind: 'piloti', status: 'open', acceptedBy: 'user_me' }) })
      })
    )
    render(<Harness transport={scriptedRoom().transport} />)

    await userEvent.click(await screen.findByTestId('review-row'))
    const thread = await screen.findByTestId('review-thread')
    expect(within(thread).getByText('Proposal')).toBeInTheDocument()
    expect(within(thread).getByText('OIB-RL 2, Pkt. 3.4')).toBeInTheDocument()
    expect(within(thread).queryByTestId('thread-resolve')).not.toBeInTheDocument()

    await userEvent.click(within(thread).getByTestId('thread-accept'))

    await waitFor(() => expect(patched).toEqual([{ status: 'open', expectedStatus: 'proposed' }]))
    await waitFor(() => expect(within(screen.getByTestId('review-thread')).queryByTestId('thread-accept')).toBeNull())
  })

  it('reads again only the mark a hint names, not the list, while pointers keep moving', async () => {
    let listed = 0
    const read: string[] = []
    server.use(
      http.get('/api/documents/:id/annotations', () => {
        listed += 1
        return HttpResponse.json({ annotations: [], canAnnotate: true })
      }),
      http.get('/api/documents/:id/annotations/:annotationId', ({ params }) => {
        read.push(String(params.annotationId))
        return HttpResponse.json({ annotation: view({ id: 'theirs', body: 'Von Anna gesetzt' }) })
      })
    )
    const room = scriptedRoom()
    render(<Harness transport={room.transport} />)
    await screen.findByTestId('review-empty')

    room.send({
      kind: 'event',
      event: { kind: 'annotations.changed', annotationIds: ['theirs'], change: 'created', actor: { ...ANNA } },
    })
    for (let index = 0; index < 16; index += 1) {
      room.send({ kind: 'event', event: { kind: 'cursor', peer: ANNA, cursor: { page: 1, x: index / 20, y: 0.5 } } })
      await act(() => new Promise((resolve) => setTimeout(resolve, 30)))
    }

    expect(await screen.findByText('Von Anna gesetzt')).toBeInTheDocument()
    expect(read).toEqual(['theirs'])
    expect(listed).toBe(1)
  })

  it('takes a mark a hint names off the list when it is not there any more for this reader', async () => {
    serve([view({ id: 'gone', body: 'Wird gelöscht' })])
    const room = scriptedRoom()
    render(<Harness transport={room.transport} />)
    expect(await screen.findByText('Wird gelöscht')).toBeInTheDocument()

    serve([])
    room.send({
      kind: 'event',
      event: { kind: 'annotations.changed', annotationIds: ['gone'], change: 'deleted', actor: { ...ANNA } },
    })
    await waitFor(() => expect(screen.queryByText('Wird gelöscht')).toBeNull())
  })

  it("does not read again for this tab's own write, which it already holds", async () => {
    let calls = 0
    server.use(
      http.get('/api/documents/:id/annotations', () => {
        calls += 1
        return HttpResponse.json({ annotations: [], canAnnotate: true })
      })
    )
    const room = scriptedRoom()
    let peerId = ''
    render(<Harness transport={room.transport} onReady={(review) => (peerId = review.room.peerId)} />)
    await screen.findByTestId('review-empty')

    room.send({
      kind: 'event',
      event: { kind: 'annotations.changed', annotationIds: ['mine'], change: 'created', actor: { ...ANNA, peerId } },
    })
    await act(() => new Promise((resolve) => setTimeout(resolve, 250)))
    expect(calls).toBe(1)
  })

  it("draws a colleague's pointer on their page, and answers a stranger's presence with its own", async () => {
    const restore = installLayoutObservers({ frameWidth: 800 })
    serve([])
    const room = scriptedRoom()
    render(<Harness transport={room.transport} />)
    await screen.findByTestId('review-empty')
    const announced = room.posts.filter((post) => post.presence === 'here').length

    room.send({ kind: 'event', event: { kind: 'presence', peer: ANNA, state: 'here', ttlMs: 25_000 } })
    room.send({ kind: 'event', event: { kind: 'cursor', peer: ANNA, cursor: { page: 1, x: 0.5, y: 0.5 }, tool: 'region' } })

    expect(await within(screen.getByTestId('sheet')).findByText('Anna Berger')).toBeInTheDocument()
    await waitFor(() => expect(room.posts.filter((post) => post.presence === 'here').length).toBe(announced + 1))
    restore()
  })

  it('gives a reader who may not write no tools and no decisions', async () => {
    serve([view({ id: 'p', authorKind: 'piloti', status: 'proposed', canEdit: false, canDelete: false })], false)
    render(<Harness transport={scriptedRoom().transport} />)

    await userEvent.click(await screen.findByTestId('review-row'))
    const thread = await screen.findByTestId('review-thread')
    expect(within(thread).queryByTestId('thread-accept')).not.toBeInTheDocument()
    expect(within(thread).queryByTestId('thread-reply')).not.toBeInTheDocument()
  })
})

describe('a thread with news the reader has not read', () => {
  it('wears a dot on its pin and its row, said in words, until the reader opens it', async () => {
    serve([view({ id: 'ann_1', number: 1 }), view({ id: 'ann_2', number: 2, x: 0.6 })])
    const reads: unknown[] = []
    server.use(
      http.get('/api/inbox/unread-anchors', ({ request }) => {
        const query = new URL(request.url).searchParams
        expect(Object.fromEntries(query)).toEqual({ resourceType: 'document', resourceId: 'doc_1' })
        return HttpResponse.json({ anchorIds: reads.length > 0 ? [] : ['ann_2'] })
      }),
      http.post('/api/inbox/read', async ({ request }) => {
        reads.push(await request.json())
        return HttpResponse.json({ affected: 1, pending: 0 })
      })
    )
    render(<Harness transport={scriptedRoom().transport} />)

    const pins = await within(screen.getByTestId('sheet')).findAllByTestId('review-pin')
    await waitFor(() => expect(pins[1]).toHaveAttribute('data-unread', 'true'))
    expect(pins[0]).not.toHaveAttribute('data-unread')
    expect(pins[1]?.getAttribute('aria-label')).toBe('Annotation 2: Defect · unread')
    const rows = screen.getAllByTestId('review-row')
    expect(rows[1]).toHaveTextContent('unread')
    expect(rows[1]?.querySelector('[data-slot="comment-pin-unread"]')).not.toBeNull()
    expect(rows[0]?.querySelector('[data-slot="comment-pin-unread"]')).toBeNull()

    await userEvent.click(rows[1] as HTMLElement)

    await waitFor(() => expect(reads).toEqual([{ resourceType: 'document', resourceId: 'doc_1', anchorId: 'ann_2' }]))
    expect(screen.getAllByTestId('review-row')[1]?.querySelector('[data-slot="comment-pin-unread"]')).toBeNull()
  })
})
