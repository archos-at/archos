import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor, within } from '@/test-utils'
import { server } from '@/mocks/server'
import type { AnnotationView } from '@/lib/annotations/types'
import { wakeTurnId } from '@/lib/annotations/wake-ids'
import type { RoomTransport } from '../../hooks/use-document-room'
import { useChatStore } from '@/features/chat/store'
import { view, scriptedRoom, scriptedAgent, Harness, serve, serveConversation } from './review.fixtures'

beforeEach(() => useChatStore.setState({ currentUserId: 'user_me' }))
beforeEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe('closing the loop on a mark', () => {
  const ANNA_MENTION = { targetId: 'user_anna', display: 'Anna Berger' }

  const servePatches = (mark: AnnotationView) => {
    const patched: Array<Record<string, unknown>> = []
    server.use(
      http.patch('/api/documents/:id/annotations/:annotationId', async ({ request }) => {
        const change = (await request.json()) as Record<string, unknown>
        patched.push(change)
        return HttpResponse.json({ annotation: { ...mark, ...change } })
      })
    )
    return patched
  }

  const silentRoom = (): RoomTransport => ({
    connect: ({ onOpen }) => {
      onOpen()
      return () => {}
    },
    post: () => {},
  })

  it('asks the agent itself when an answer to its open Rückfrage meets a rule the switch keeps off', async () => {
    const question = view({ id: 'ann_1', kind: 'question', authorKind: 'piloti', acceptedBy: 'user_me', createdBy: 'user_me' })
    serve([question])
    serveConversation()
    server.use(
      http.post('/api/documents/:id/annotations/:annotationId/replies', () =>
        HttpResponse.json({ annotation: question, replyId: 'r7', wake: 'off' })
      )
    )
    const agent = scriptedAgent()
    render(<Harness transport={scriptedRoom().transport} agent={agent} />)

    await userEvent.click(await screen.findByTestId('review-row'))
    const box = within(await screen.findByTestId('review-thread')).getByTestId('thread-reply')
    await userEvent.type(box, 'Ab Fertigfußboden.{Enter}')

    await waitFor(() => expect(agent.questions()).toHaveLength(1))
    expect(agent.questions()[0]).toMatchObject({
      message_id: wakeTurnId('r7'),
      text: 'Ab Fertigfußboden.',
      reply_in_thread: true,
    })
  })

  it('asks the agent nothing for a reply no rule met, or one the server already woke the agent for', async () => {
    serve([view({ id: 'ann_1' })])
    serveConversation()
    const wakes = ['none', 'queued']
    server.use(
      http.post('/api/documents/:id/annotations/:annotationId/replies', () =>
        HttpResponse.json({ annotation: view({ id: 'ann_1' }), replyId: 'r1', wake: wakes.shift() })
      )
    )
    const agent = scriptedAgent()
    render(<Harness transport={scriptedRoom().transport} agent={agent} />)

    await userEvent.click(await screen.findByTestId('review-row'))
    const box = within(await screen.findByTestId('review-thread')).getByTestId('thread-reply')
    await userEvent.type(box, 'Passt.{Enter}')
    await waitFor(() => expect(wakes).toHaveLength(1))
    await userEvent.type(box, 'Noch etwas.{Enter}')
    await waitFor(() => expect(wakes).toHaveLength(0))
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(agent.questions()).toHaveLength(0)
  })

  it('offers as Zuständige who may write the document, and „Assign to me" picks the reader', async () => {
    const mark = view({ id: 'ann_1', createdBy: 'user_anna', createdByName: 'Anna Berger' })
    serve([mark])
    const asked: string[] = []
    server.use(
      http.get('/api/assignments/:type/:id/candidates', ({ request }) => {
        asked.push(new URL(request.url).search)
        return HttpResponse.json({
          candidates: [{ userId: 'user_anna', name: 'Anna Berger', email: 'anna@buero.at', profilePictureUrl: null }],
        })
      })
    )
    const patched = servePatches(mark)
    render(<Harness transport={scriptedRoom().transport} canPickAssignee />)

    await userEvent.click(await screen.findByTestId('review-row'))
    await userEvent.click(within(await screen.findByTestId('review-thread')).getByTestId('thread-assignee'))
    await userEvent.click(await screen.findByTestId('assign-pick-self'))

    await waitFor(() => expect(patched).toEqual([{ assigneeUserId: 'user_me' }]))
    expect(asked).toEqual(['?access=write'])
  })

  it('clears a date from its chip, as the Zuständige chip clears its person', async () => {
    const mark = view({ id: 'ann_1', dueOn: '2026-10-20' })
    serve([mark])
    const patched = servePatches(mark)
    render(<Harness transport={scriptedRoom().transport} />)

    await userEvent.click(await screen.findByTestId('review-row'))
    const thread = await screen.findByTestId('review-thread')
    await userEvent.click(within(thread).getByRole('button', { name: 'Remove due date' }))

    await waitFor(() => expect(patched).toEqual([{ dueOn: null }]))
  })

  it('counts the agent’s untaken proposals apart on the Open tab, as Dateien’s chip does', async () => {
    serve([
      view({ id: 'ann_1', number: 1, body: 'Offen' }),
      view({ id: 'p1', number: 2, authorKind: 'piloti', status: 'proposed' }),
      view({ id: 'p2', number: 3, authorKind: 'piloti', status: 'proposed' }),
    ])
    render(<Harness transport={silentRoom()} />)
    await waitFor(() => expect(screen.getAllByTestId('review-row')).toHaveLength(3))

    expect(screen.getByTestId('review-filter-open')).toHaveTextContent(/^Open1· 2 proposals$/)
    expect(screen.getByTestId('review-filter-open-proposed')).toHaveTextContent('2 proposals')
  })

  it('finds the reader’s marks under „For you" while the room has not welcomed the tab, and not what they only set', async () => {
    serve([
      view({ id: 'ann_1', number: 1, createdBy: 'user_anna', assigneeUserId: 'user_me', body: 'Mir zugewiesen' }),
      view({ id: 'ann_2', number: 2, createdBy: 'user_anna', body: 'Nicht meins' }),
      view({ id: 'ann_3', number: 3, createdBy: 'user_me', assigneeUserId: 'user_anna', body: 'Für Anna' }),
    ])
    render(<Harness transport={silentRoom()} />)
    await waitFor(() => expect(screen.getAllByTestId('review-row')).toHaveLength(3))

    expect(screen.getByTestId('review-filter-mine')).toHaveTextContent('For you')
    await userEvent.click(screen.getByTestId('review-filter-mine'))

    const rows = screen.getAllByTestId('review-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Mir zugewiesen')
    expect(screen.getByTestId('review-filter-open')).toHaveTextContent('1')
  })

  it('lets the author reword their mark: the composer starts from its text, keeps whom it mentions, and adds whom was picked', async () => {
    const mark = view({ id: 'ann_1', body: '@Anna Berger Brüstung prüfen', mentions: [ANNA_MENTION] })
    serve([mark])
    const patched = servePatches(mark)
    render(<Harness transport={scriptedRoom().transport} />)

    await userEvent.click(await screen.findByTestId('review-row'))
    const thread = await screen.findByTestId('review-thread')
    await userEvent.click(within(thread).getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))

    const box = within(screen.getByTestId('review-thread')).getByTestId('thread-edit-body')
    expect(box).toHaveValue('@Anna Berger Brüstung prüfen')
    await userEvent.type(box, ' auf 1,00 m{Enter}')

    await waitFor(() =>
      expect(patched).toEqual([{ body: '@Anna Berger Brüstung prüfen auf 1,00 m', mentions: [ANNA_MENTION] }])
    )
    expect(within(screen.getByTestId('review-thread')).queryByTestId('thread-edit')).toBeNull()
    expect(within(screen.getByTestId('review-thread')).getByRole('button', { name: 'More' })).toHaveFocus()
  })

  it('offers no rewording of someone else’s mark, nor of the agent’s', async () => {
    serve([
      view({ id: 'ann_1', number: 1, createdBy: 'user_anna', createdByName: 'Anna Berger' }),
      view({ id: 'ann_2', number: 2, authorKind: 'piloti', status: 'proposed', x: 0.7 }),
    ])
    render(<Harness transport={scriptedRoom().transport} />)

    for (const index of [0, 1]) {
      await waitFor(() => expect(screen.getAllByTestId('review-row')).toHaveLength(2))
      await userEvent.click(screen.getAllByTestId('review-row')[index] as HTMLElement)
      const thread = await screen.findByTestId('review-thread')
      await userEvent.click(within(thread).getByRole('button', { name: 'More' }))
      await screen.findAllByRole('menuitem')
      expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull()
      await userEvent.keyboard('{Escape}')
    }
  })

  it('withholds deleting the author’s own mark a colleague answered in, says why, and offers resolving instead', async () => {
    const mark = view({ id: 'ann_1', canDelete: false, deleteRefused: 'discussed' })
    serve([mark])
    const patched = servePatches(mark)
    render(<Harness transport={scriptedRoom().transport} />)

    await userEvent.click(await screen.findByTestId('review-row'))
    const thread = await screen.findByTestId('review-thread')
    await userEvent.click(within(thread).getByRole('button', { name: 'More' }))
    const withheld = await screen.findByTestId('thread-delete-refused')
    expect(withheld).toHaveAttribute('aria-disabled', 'true')
    expect(withheld).toHaveTextContent('Others have answered in its thread. Resolve the annotation instead.')

    await userEvent.click(screen.getByRole('menuitem', { name: 'Resolve instead' }))
    await waitFor(() => expect(patched).toEqual([{ status: 'resolved', expectedStatus: 'open' }]))
  })
})
