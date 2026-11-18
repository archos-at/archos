import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor, within } from '@/test-utils'
import { server } from '@/mocks/server'
import type { AnnotationView } from '@/lib/annotations/types'
import { useDocumentReview } from '../../hooks/use-document-review'
import { useChatStore } from '@/features/chat/store'
import { PRODUCT_NAME } from '@/lib/brand'
import { view, pickerOption, scriptedRoom, scriptedAgent, Harness, serve, serveConversation } from './review.fixtures'

beforeEach(() => useChatStore.setState({ currentUserId: 'user_me' }))
beforeEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe('one’s own reply in the thread', () => {
  const ANNA_MENTION = { targetId: 'user_anna', display: 'Anna Berger' }
  const reply = (overrides: Partial<AnnotationView['replies'][number]> = {}): AnnotationView['replies'][number] => ({
    id: 'rep_1',
    annotationId: 'ann_1',
    authorKind: 'person',
    body: '@Anna Berger bitte prüfen',
    createdBy: 'user_me',
    createdByName: 'Miriam Hofer',
    createdAt: '2026-10-01T09:00:00.000Z',
    addressesPiloti: false,
    mentions: [ANNA_MENTION],
    editedAt: null,
    ...overrides,
  })

  const openThread = async () => {
    await userEvent.click(await screen.findByTestId('review-row'))
    return screen.findByTestId('review-thread')
  }

  it('lets its author reword it in the thread’s composer, keeping whom it mentions, and says it was edited', async () => {
    const mark = view({ id: 'ann_1', replies: [reply()] })
    serve([mark])
    const patched: Array<{ path: string; body: unknown }> = []
    server.use(
      http.patch('/api/documents/:id/annotations/:annotationId/replies/:replyId', async ({ request, params }) => {
        const body = (await request.json()) as { body: string; mentions: unknown }
        patched.push({ path: String(params.replyId), body })
        return HttpResponse.json({
          annotation: { ...mark, replies: [reply({ body: body.body, editedAt: '2026-10-01T09:05:00.000Z' })] },
        })
      })
    )
    render(<Harness transport={scriptedRoom().transport} />)

    const thread = await openThread()
    await userEvent.click(within(thread).getByTestId('thread-reply-more'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    const box = within(screen.getByTestId('review-thread')).getByTestId('thread-reply-edit-body')
    expect(box).toHaveValue('@Anna Berger bitte prüfen')
    await userEvent.type(box, ' bis Freitag{Enter}')

    await waitFor(() =>
      expect(patched).toEqual([
        { path: 'rep_1', body: { body: '@Anna Berger bitte prüfen bis Freitag', mentions: [ANNA_MENTION] } },
      ])
    )
    const after = screen.getByTestId('review-thread')
    expect(within(after).queryByTestId('thread-reply-edit')).toBeNull()
    expect(within(after).getByTestId('thread-edited')).toHaveTextContent('edited')
  })

  it('gives the focus back to the reply’s ⋯ when the edit is saved or let go, never to the page', async () => {
    const mark = view({ id: 'ann_1', replies: [reply()] })
    serve([mark])
    server.use(
      http.patch('/api/documents/:id/annotations/:annotationId/replies/:replyId', async ({ request }) => {
        const body = (await request.json()) as { body: string }
        return HttpResponse.json({ annotation: { ...mark, replies: [reply({ body: body.body, editedAt: '2026-10-01T09:05:00.000Z' })] } })
      })
    )
    render(<Harness transport={scriptedRoom().transport} />)
    const thread = await openThread()
    const edit = async () => {
      await userEvent.click(within(screen.getByTestId('review-thread')).getByTestId('thread-reply-more'))
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
      return within(screen.getByTestId('review-thread')).getByTestId('thread-reply-edit-body')
    }

    expect(await edit()).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(within(thread).getByTestId('thread-reply-more')).toHaveFocus()

    await edit()
    await userEvent.click(within(screen.getByTestId('review-thread')).getByRole('button', { name: 'Cancel' }))
    expect(within(thread).getByTestId('thread-reply-more')).toHaveFocus()

    await userEvent.type(await edit(), ' bis Freitag{Enter}')
    await waitFor(() => expect(within(screen.getByTestId('review-thread')).queryByTestId('thread-reply-edit')).toBeNull())
    expect(within(screen.getByTestId('review-thread')).getByTestId('thread-reply-more')).toHaveFocus()
  })

  it('says a rewording that failed was not saved, and keeps the words', async () => {
    serve([view({ id: 'ann_1', replies: [reply()] })])
    server.use(
      http.patch('/api/documents/:id/annotations/:annotationId/replies/:replyId', () =>
        HttpResponse.json({ error: 'down', code: 'INTERNAL' }, { status: 500 })
      )
    )
    render(<Harness transport={scriptedRoom().transport} />)

    const thread = await openThread()
    await userEvent.click(within(thread).getByTestId('thread-reply-more'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Edit' }))
    await userEvent.type(within(screen.getByTestId('review-thread')).getByTestId('thread-reply-edit-body'), ' bis Freitag{Enter}')

    const edit = within(screen.getByTestId('review-thread')).getByTestId('thread-reply-edit')
    expect(await within(edit).findByText('Could not be saved. Your text is still here.')).toBeInTheDocument()
    expect(within(edit).getByTestId('thread-reply-edit-body')).toHaveValue('@Anna Berger bitte prüfen bis Freitag')
  })

  it('deletes it after asking, and the thread shows it gone', async () => {
    serve([view({ id: 'ann_1', replies: [reply()] })])
    const deleted: string[] = []
    server.use(
      http.delete('/api/documents/:id/annotations/:annotationId/replies/:replyId', ({ params }) => {
        deleted.push(String(params.replyId))
        return new HttpResponse(null, { status: 204 })
      })
    )
    render(<Harness transport={scriptedRoom().transport} />)

    const thread = await openThread()
    await userEvent.click(within(thread).getByTestId('thread-reply-more'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deleted).toEqual(['rep_1']))
    await waitFor(() => expect(within(screen.getByTestId('review-thread')).queryByTestId('thread-reply-entry')).toBeNull())
  })

  it('says the agent took it up when the server refuses the change, without the colleague’s-move notice', async () => {
    serve([view({ id: 'ann_1', replies: [reply()] })])
    server.use(
      http.delete('/api/documents/:id/annotations/:annotationId/replies/:replyId', () =>
        HttpResponse.json(
          { error: 'Taken up', code: 'CONFLICT', details: { reason: 'piloti-took-it-up' } },
          { status: 409 }
        )
      )
    )
    render(<Harness transport={scriptedRoom().transport} />)

    const thread = await openThread()
    await userEvent.click(within(thread).getByTestId('thread-reply-more'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    expect(
      await within(screen.getByTestId('review-thread')).findByText(
        `${PRODUCT_NAME} has already taken this reply up. It stays as it is; write a new one.`
      )
    ).toBeInTheDocument()
  })

  it('offers no change of a reply that mentions the agent while this tab’s own ask of the agent about it is thinking (wakes off)', async () => {
    const asked = reply({ id: 'r1', body: `@${PRODUCT_NAME} Stimmt die Breite?`, mentions: [], addressesPiloti: true })
    serve([view({ id: 'ann_1', shape: 'region', x: 0.1, y: 0.2, w: 0.3, h: 0.25 })])
    serveConversation()
    server.use(
      http.post('/api/documents/:id/annotations/:annotationId/replies', () =>
        HttpResponse.json({
          annotation: view({ id: 'ann_1', shape: 'region', x: 0.1, y: 0.2, w: 0.3, h: 0.25, replies: [asked] }),
          replyId: 'r1',
          wake: 'off',
        })
      )
    )
    const agent = scriptedAgent()
    render(<Harness transport={scriptedRoom().transport} agent={agent} />)

    const thread = await openThread()
    const box = within(thread).getByTestId('thread-reply')
    await userEvent.type(box, `@${PRODUCT_NAME.slice(0, 3).toLowerCase()}`)
    await userEvent.click(pickerOption(thread, 'agent:core'))
    await userEvent.type(box, 'Stimmt die Breite?{Enter}')
    await waitFor(() => expect(agent.questions()).toHaveLength(1))

    const asking = screen.getByTestId('review-thread')
    expect(within(asking).getByTestId('thread-agent-pending')).toBeInTheDocument()
    expect(within(asking).getAllByTestId('thread-reply-entry')).toHaveLength(1)
    expect(within(asking).queryByTestId('thread-reply-more')).toBeNull()

    agent.deliver(1, { type: 'RUN_STARTED', message_id: 'a-1' })
    agent.deliver(2, { type: 'RUN_ERROR', code: 'workflow_error', message: 'The connection closed.', details: null })
    await waitFor(() => expect(within(screen.getByTestId('review-thread')).getByTestId('thread-reply-more')).toBeInTheDocument())
  })

  it('offers no change of a colleague’s reply, of the agent’s, on a closed mark, or of one the agent answered', async () => {
    const forAgent = reply({ body: `@${PRODUCT_NAME} stimmt das?`, mentions: [], addressesPiloti: true })
    const answer = reply({
      id: 'rep_2',
      authorKind: 'piloti',
      body: 'Ja.',
      mentions: [],
      createdAt: '2026-10-01T09:01:00.000Z',
    })
    for (const mark of [
      view({ id: 'ann_1', replies: [reply({ createdBy: 'user_anna', createdByName: 'Anna Berger' })] }),
      view({ id: 'ann_1', replies: [reply({ authorKind: 'piloti', mentions: [] })] }),
      view({ id: 'ann_1', status: 'resolved', replies: [reply()] }),
      view({ id: 'ann_1', replies: [forAgent, answer] }),
    ]) {
      serve([mark])
      let review: ReturnType<typeof useDocumentReview> | null = null
      const { unmount } = render(<Harness transport={scriptedRoom().transport} onReady={(next) => (review = next)} />)
      await waitFor(() => expect(review?.load).toBe('ready'))
      act(() => review?.select('ann_1'))
      const thread = await screen.findByTestId('review-thread')
      expect(within(thread).getAllByTestId('thread-reply-entry').length).toBeGreaterThan(0)
      expect(within(thread).queryByTestId('thread-reply-more')).toBeNull()
      unmount()
    }
  })
})
