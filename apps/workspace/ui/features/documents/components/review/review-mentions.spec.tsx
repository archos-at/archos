import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { fireEvent, render, screen, waitFor, within } from '@/test-utils'
import { server } from '@/mocks/server'
import type { AnnotationView } from '@/lib/annotations/types'
import type { RoomTransport } from '../../hooks/use-document-room'
import { useChatStore } from '@/features/chat/store'
import { view, pickerOption, scriptedRoom, Harness, serve, captureSurface } from './review.fixtures'

beforeEach(() => useChatStore.setState({ currentUserId: 'user_me' }))
beforeEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe('mentioning a colleague on a mark', () => {
  const ANNA_PERSON = { userId: 'user_anna', name: 'Anna Berger', email: 'anna@buero.at', profilePictureUrl: null }
  const ANNA_MENTION = { targetId: 'user_anna', display: 'Anna Berger' }

  const serveCandidates = () => {
    const asked: string[] = []
    server.use(
      http.get('/api/assignments/:type/:id/candidates', ({ request }) => {
        asked.push(new URL(request.url).pathname)
        return HttpResponse.json({ candidates: [ANNA_PERSON] })
      })
    )
    return asked
  }

  const replyView = (body: string, mentions: AnnotationView['replies'][number]['mentions']) => ({
    id: 'r1',
    annotationId: 'ann_1',
    authorKind: 'person' as const,
    body,
    createdBy: 'user_me',
    createdByName: 'Miriam Hofer',
    createdAt: '2026-10-01T09:00:00.000Z',
    addressesPiloti: false,
    mentions,
  })

  it('offers who may open the document, sends whom was picked, and shows the chip in the thread', async () => {
    serve([view({ id: 'ann_1' })])
    const asked = serveCandidates()
    const replies: unknown[] = []
    server.use(
      http.post('/api/documents/:id/annotations/:annotationId/replies', async ({ request }) => {
        const sent = (await request.json()) as { body: string }
        replies.push(sent)
        return HttpResponse.json({
          annotation: view({ id: 'ann_1', replies: [replyView(sent.body, [ANNA_MENTION])] }),
          replyId: 'r1',
          wake: 'none',
        })
      })
    )
    render(<Harness transport={scriptedRoom().transport} />)

    await userEvent.click(await screen.findByTestId('review-row'))
    const thread = await screen.findByTestId('review-thread')
    const box = within(thread).getByTestId('thread-reply')
    await userEvent.type(box, '@an')
    await userEvent.click(await waitFor(() => pickerOption(thread, 'user_anna')))
    expect(box).toHaveValue('@Anna Berger ')
    await userEvent.type(box, 'bitte die Breite prüfen{Enter}')

    expect(asked).toEqual(['/api/assignments/document/doc_1/candidates'])
    await waitFor(() =>
      expect(replies).toEqual([{ body: '@Anna Berger bitte die Breite prüfen', mentions: [ANNA_MENTION] }])
    )
    const chip = await within(screen.getByTestId('review-thread')).findByTestId('mention-chip')
    expect(chip).toHaveTextContent('@Anna Berger')
    expect(chip).toHaveAttribute('data-mention-target', 'user_anna')
    expect(within(screen.getByTestId('review-thread')).queryByTestId('thread-reply-untold')).toBeNull()
  })

  it('sends nobody for a name typed by hand, and says whom the server did not tell', async () => {
    serve([view({ id: 'ann_1' })])
    serveCandidates()
    const replies: Array<{ body: string; mentions?: unknown }> = []
    server.use(
      http.post('/api/documents/:id/annotations/:annotationId/replies', async ({ request }) => {
        const sent = (await request.json()) as { body: string; mentions?: unknown }
        replies.push(sent)
        return HttpResponse.json({
          annotation: view({ id: 'ann_1', replies: [replyView(sent.body, [])] }),
          replyId: 'r1',
          wake: 'none',
        })
      })
    )
    render(<Harness transport={scriptedRoom().transport} />)

    await userEvent.click(await screen.findByTestId('review-row'))
    const thread = await screen.findByTestId('review-thread')
    const box = within(thread).getByTestId('thread-reply')

    await userEvent.type(box, '@Max')
    expect(await within(thread).findByTestId('mention-no-results-hint')).toHaveTextContent(
      'You can mention anyone who can open this document.'
    )
    await userEvent.type(box, ' schau mal{Enter}')
    await waitFor(() => expect(replies).toEqual([{ body: '@Max schau mal' }]))
    expect(within(screen.getByTestId('review-thread')).queryByTestId('mention-chip')).toBeNull()

    await userEvent.type(box, '@an')
    await userEvent.click(await waitFor(() => pickerOption(thread, 'user_anna')))
    await userEvent.type(box, 'bitte{Enter}')
    await waitFor(() => expect(replies[1]).toEqual({ body: '@Anna Berger bitte', mentions: [ANNA_MENTION] }))
    expect(await within(screen.getByTestId('review-thread')).findByTestId('thread-reply-untold')).toHaveTextContent(
      /^Anna Berger was not told\.$/
    )
  })

  it('mentions a colleague in a new mark, and offers no agent there: setting a mark wakes nobody', async () => {
    serve([])
    serveCandidates()
    const posted: unknown[] = []
    server.use(
      http.post('/api/documents/:id/annotations', async ({ request }) => {
        posted.push(await request.json())
        return HttpResponse.json(
          { annotation: view({ id: 'new', body: '@Anna Berger Brüstung prüfen', mentions: [ANNA_MENTION] }) },
          { status: 201 }
        )
      })
    )
    render(<Harness transport={scriptedRoom().transport} />)
    await screen.findByTestId('review-empty')
    await userEvent.click(screen.getByRole('button', { name: 'region tool' }))
    const capture = captureSurface()
    fireEvent.pointerDown(capture, { button: 0, clientX: 80, clientY: 120, pointerId: 1 })
    fireEvent.pointerMove(capture, { clientX: 320, clientY: 300, pointerId: 1 })
    fireEvent.pointerUp(capture, { clientX: 320, clientY: 300, pointerId: 1 })

    const draft = await screen.findByTestId('review-draft')
    const box = within(draft).getByTestId('review-draft-body')
    await userEvent.type(box, '@')
    await waitFor(() => pickerOption(draft, 'user_anna'))
    expect(within(draft).getAllByTestId('mention-option').map((row) => row.getAttribute('data-target-id'))).toEqual([
      'user_anna',
    ])
    await userEvent.click(pickerOption(draft, 'user_anna'))
    await userEvent.type(box, 'Brüstung prüfen{Enter}')

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ body: '@Anna Berger Brüstung prüfen', mentions: [ANNA_MENTION] })
    const row = await screen.findByTestId('review-row')
    expect(within(row).getByTestId('mention-chip')).toHaveTextContent('@Anna Berger')
  })

  const serveReplies = (respond?: (sent: { body: string; mentions?: AnnotationView['mentions'] }) => Response) => {
    const sent: Array<{ body: string; mentions?: AnnotationView['mentions'] }> = []
    server.use(
      http.post('/api/documents/:id/annotations/:annotationId/replies', async ({ request }) => {
        const body = (await request.json()) as { body: string; mentions?: AnnotationView['mentions'] }
        sent.push(body)
        return (
          respond?.(body) ??
          HttpResponse.json({
            annotation: view({ id: 'ann_1', replies: [replyView(body.body, body.mentions ?? [])] }),
            replyId: 'r1',
            wake: 'none',
          })
        )
      })
    )
    return sent
  }

  const openThread = async () => {
    await userEvent.click(await screen.findByTestId('review-row'))
    const thread = await screen.findByTestId('review-thread')
    return { thread, box: within(thread).getByTestId('thread-reply') }
  }

  it('sends the Anna picked last when a namesake was picked and taken back first', async () => {
    serve([view({ id: 'ann_1' })])
    const wien = { ...ANNA_PERSON, userId: 'user_wien' }
    const graz = { ...ANNA_PERSON, userId: 'user_graz', email: 'anna@graz.at' }
    server.use(http.get('/api/assignments/:type/:id/candidates', () => HttpResponse.json({ candidates: [wien, graz] })))
    const sent = serveReplies()
    render(<Harness transport={scriptedRoom().transport} />)
    const { thread, box } = await openThread()

    await userEvent.type(box, '@an')
    await userEvent.click(await waitFor(() => pickerOption(thread, 'user_wien')))
    await userEvent.clear(box)
    await userEvent.type(box, '@an')
    await userEvent.click(await waitFor(() => pickerOption(thread, 'user_graz')))
    await userEvent.type(box, 'bitte{Enter}')

    await waitFor(() =>
      expect(sent).toEqual([{ body: '@Anna Berger bitte', mentions: [{ targetId: 'user_graz', display: 'Anna Berger' }] }])
    )
  })

  it('↵ after „@Le" mentions Lena, the name typed, not a colleague whose address matches', async () => {
    serve([view({ id: 'ann_1' })])
    const anna = { ...ANNA_PERSON, email: 'anna@lehner-architekten.at' }
    const jakob = { userId: 'user_jakob', name: 'Jakob Huber', email: 'jakob.huber@lechner.at', profilePictureUrl: null }
    const lena = { userId: 'user_lena', name: 'Lena Fuchs', email: 'lena@buero.at', profilePictureUrl: null }
    server.use(
      http.get('/api/assignments/:type/:id/candidates', () => HttpResponse.json({ candidates: [anna, jakob, lena] }))
    )
    const sent = serveReplies()
    render(<Harness transport={scriptedRoom().transport} />)
    const { thread, box } = await openThread()

    await userEvent.type(box, '@Le')
    await waitFor(() =>
      expect(within(thread).getAllByTestId('mention-option').map((row) => row.getAttribute('data-target-id'))).toEqual([
        'user_lena',
        'user_anna',
        'user_jakob',
      ])
    )
    await userEvent.type(box, '{Enter}')
    expect(box).toHaveValue('@Lena Fuchs ')
    await userEvent.type(box, 'bitte{Enter}')

    await waitFor(() =>
      expect(sent).toEqual([{ body: '@Lena Fuchs bitte', mentions: [{ targetId: 'user_lena', display: 'Lena Fuchs' }] }])
    )
  })

  it('says the chat’s words when the mention budget is spent, and the bound before sending too many names', async () => {
    serve([view({ id: 'ann_1' })])
    const many = Array.from({ length: 11 }, (_, index) => ({
      userId: `user_${index}`,
      name: `Person ${String.fromCharCode(65 + index)}`,
      email: null,
      profilePictureUrl: null,
    }))
    server.use(http.get('/api/assignments/:type/:id/candidates', () => HttpResponse.json({ candidates: many })))
    const sent = serveReplies(() =>
      HttpResponse.json(
        { error: 'Too many mentions.', code: 'FORBIDDEN', details: { reason: 'mention-rate-limited' } },
        { status: 403 }
      )
    )
    render(<Harness transport={scriptedRoom().transport} />)
    const { thread, box } = await openThread()

    await userEvent.type(box, '@')
    await userEvent.click(await waitFor(() => pickerOption(thread, 'user_0')))
    await userEvent.type(box, 'bitte{Enter}')
    await waitFor(() => expect(sent).toHaveLength(1))
    expect(await within(thread).findByText('Too many mentions. Please wait a few minutes.')).toBeInTheDocument()

    await userEvent.clear(box)
    for (const person of many) {
      await userEvent.type(box, '@')
      await userEvent.click(await waitFor(() => pickerOption(thread, person.userId)))
    }
    await userEvent.type(box, '{Enter}')
    expect(await within(thread).findByText('Mention at most 10 people at once.')).toBeInTheDocument()
    expect(sent).toHaveLength(1)
  })

  it('says the people could not be loaded, and asks again on the next „@"', async () => {
    serve([view({ id: 'ann_1' })])
    let asked = 0
    server.use(
      http.get('/api/assignments/:type/:id/candidates', () => {
        asked += 1
        return asked === 1
          ? HttpResponse.json({ error: 'down' }, { status: 503 })
          : HttpResponse.json({ candidates: [ANNA_PERSON] })
      })
    )
    render(<Harness transport={scriptedRoom().transport} />)
    const { thread, box } = await openThread()

    await userEvent.type(box, '@an')
    expect(await within(thread).findByTestId('mention-picker-notice')).toHaveTextContent(
      'Could not load the people. Type "@" again.'
    )
    await userEvent.type(box, ' @an')
    await waitFor(() => pickerOption(thread, 'user_anna'))
    expect(within(thread).queryByTestId('mention-picker-notice')).toBeNull()
    expect(asked).toBe(2)
  })

  it('marks a mention of the reader as the room knows them, and keeps line breaks only in the thread', async () => {
    const me = { targetId: 'user_room', display: 'Rita Raum' }
    serve([view({ id: 'ann_1', body: '@Rita Raum bitte\nprüfen', mentions: [me] })])
    const transport: RoomTransport = {
      connect({ onFrame, onOpen }) {
        onOpen()
        onFrame({ kind: 'welcome', self: { userId: 'user_room', name: 'Rita Raum', kind: 'person' } })
        return () => {}
      },
      post: () => {},
    }
    render(<Harness transport={transport} />)

    const row = await screen.findByTestId('review-row')
    await waitFor(() => expect(within(row).getByTestId('mention-chip')).toHaveAttribute('data-mention-me', 'true'))
    expect(within(row).getByTestId('mention-text')).toHaveClass('whitespace-normal')

    await userEvent.click(row)
    const thread = await screen.findByTestId('review-thread')
    const text = within(thread).getByTestId('mention-text')
    expect(text).toHaveClass('whitespace-pre-wrap')
    expect(text).not.toHaveClass('whitespace-normal')
  })
})
