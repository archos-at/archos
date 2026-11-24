import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor, within } from '@/test-utils'
import { installLayoutObservers } from '@/test-utils/layout-observers'
import { server } from '@/mocks/server'
import type { AnnotationView } from '@/lib/annotations/types'
import { wakeTurnId } from '@/lib/annotations/wake-ids'
import { useChatStore } from '@/features/chat/store'
import { PRODUCT_NAME } from '@/lib/brand'
import { view, pickerOption, scriptedRoom, scriptedAgent, Harness, serve, serveConversation, askAboutABox } from './review.fixtures'

beforeEach(() => useChatStore.setState({ currentUserId: 'user_me' }))
beforeEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe('the review', () => {
  it('asks the agent about a box drawn with its tool, and streams the answer beside it', async () => {
    serve([])
    const posted = serveConversation()
    const agent = scriptedAgent()
    render(<Harness transport={scriptedRoom().transport} agent={agent} />)
    await screen.findByTestId('review-empty')

    await askAboutABox(agent)

    expect(posted[0]).toEqual({ path: 'thread', body: { title: 'Grundriss.pdf · Review' } })
    expect(posted.some((entry) => entry.path === 'conversation')).toBe(false)
    expect(agent.questions()[0].conversation_id).toBe('s_thread_doc_1')
    expect(posted[1]).toEqual({
      path: 'message',
      body: {
        id: agent.questions()[0].message_id,
        role: 'user',
        content: 'Check the dimensions in this detail: are they complete, consistent and plausible?',
        messageType: 'user',
      },
    })
    expect(agent.questions()[0]).toMatchObject({
      text: 'Check the dimensions in this detail: are they complete, consistent and plausible?',
      focus_document_id: 'doc_1',
      focus_file_name: 'Grundriss.pdf',
      focus_region: { page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.3 },
      reasoning_effort: 'low',
    })
    expect(agent.questions()[0]).not.toHaveProperty('reply_in_thread')

    const card = screen.getByTestId('agent-answer-card')
    expect(within(card).getByTestId('agent-answer-card-thinking')).toBeInTheDocument()
    expect(within(screen.getByTestId('sheet')).getByTestId('agent-ask-box')).toHaveAttribute('data-status', 'thinking')

    agent.deliver(1, { type: 'RUN_STARTED', message_id: 'a-1' })
    agent.deliver(2, { type: 'TEXT_MESSAGE_START', message_id: 'a-1' })
    agent.deliver(3, { type: 'TEXT_MESSAGE_CONTENT', message_id: 'a-1', delta: 'Die Raumhöhe ist ' })
    agent.deliver(4, { type: 'TEXT_MESSAGE_CONTENT', message_id: 'a-1', delta: 'nicht kotiert.' })
    expect(await within(card).findByText(/Die Raumhöhe ist nicht kotiert\./)).toBeInTheDocument()

    agent.deliver(5, {
      type: 'RUN_FINISHED',
      outcome: 'answered',
      result: { message_id: 'a-1', text: 'Die Raumhöhe ist nicht kotiert.\n\n[[card:1]]' },
    })
    await waitFor(() => expect(within(card).queryByTestId('agent-answer-card-thinking')).toBeNull())
    expect(within(card).queryByText(/card:1/)).toBeNull()
    expect(within(card).getByTestId('agent-card-chat')).toHaveAttribute(
      'href',
      '/app/projects/proj_1/chat?session=s_thread_doc_1'
    )
  })

  it("takes the agent's answer over as an Anmerkung at the box", async () => {
    serve([])
    serveConversation()
    const created: unknown[] = []
    server.use(
      http.post('/api/documents/:id/annotations', async ({ request }) => {
        created.push(await request.json())
        return HttpResponse.json(
          { annotation: view({ id: 'kept', shape: 'region', x: 0.1, y: 0.2, w: 0.3, h: 0.3, kind: 'hint', body: 'Raumhöhe fehlt.' }) },
          { status: 201 }
        )
      })
    )
    const agent = scriptedAgent()
    render(<Harness transport={scriptedRoom().transport} agent={agent} />)
    await screen.findByTestId('review-empty')
    await askAboutABox(agent)
    agent.deliver(1, { type: 'RUN_STARTED', message_id: 'a-1' })
    agent.deliver(2, { type: 'RUN_FINISHED', outcome: 'answered', result: { message_id: 'a-1', text: '**Raumhöhe** fehlt.' } })

    await userEvent.click(await screen.findByTestId('agent-card-adopt'))

    await waitFor(() =>
      expect(created).toEqual([
        { page: 1, shape: 'region', x: 0.1, y: 0.2, w: 0.3, h: 0.3, kind: 'hint', body: 'Raumhöhe fehlt.' },
      ])
    )
    await waitFor(() => expect(screen.queryByTestId('agent-answer-card')).toBeNull())
    expect(within(screen.getByTestId('sheet')).queryByTestId('agent-ask-box')).toBeNull()
    expect(await screen.findByTestId('review-thread')).toBeInTheDocument()
  })

  it('brings the agent into a thread by mention: the reply is saved, then this tab asks the agent while wakes are off', async () => {
    serve([view({ id: 'ann_1', shape: 'region', x: 0.1, y: 0.2, w: 0.3, h: 0.25 })])
    serveConversation()
    const replies: unknown[] = []
    server.use(
      http.post('/api/documents/:id/annotations/:annotationId/replies', async ({ request }) => {
        replies.push(await request.json())
        return HttpResponse.json({
          annotation: view({
            id: 'ann_1',
            shape: 'region',
            x: 0.1,
            y: 0.2,
            w: 0.3,
            h: 0.25,
            replies: [
              {
                id: 'r1',
                annotationId: 'ann_1',
                authorKind: 'person',
                body: 'Stimmt die Breite?',
                createdBy: 'user_me',
                createdByName: 'Miriam Hofer',
                createdAt: '2026-10-01T09:00:00.000Z',
                addressesPiloti: true,
              },
            ],
          }),
          replyId: 'r1',
          wake: 'off',
        })
      })
    )
    const agent = scriptedAgent()
    render(<Harness transport={scriptedRoom().transport} agent={agent} />)

    await userEvent.click(await screen.findByTestId('review-row'))
    const thread = await screen.findByTestId('review-thread')
    const box = within(thread).getByTestId('thread-reply')
    await userEvent.type(box, `@${PRODUCT_NAME.slice(0, 3).toLowerCase()}`)
    await userEvent.click(pickerOption(thread, 'agent:core'))
    expect(box).toHaveValue(`@${PRODUCT_NAME} `)
    await userEvent.type(box, 'Stimmt die Breite?{Enter}')

    await waitFor(() =>
      expect(replies).toEqual([
        {
          body: `@${PRODUCT_NAME} Stimmt die Breite?`,
          addressesPiloti: true,
          mentions: [{ targetId: 'agent:core', display: PRODUCT_NAME }],
        },
      ])
    )
    await waitFor(() => expect(agent.questions()).toHaveLength(1))
    expect(agent.questions()[0]).toMatchObject({
      message_id: wakeTurnId('r1'),
      conversation_id: 's_thread_doc_1',
      text: `@${PRODUCT_NAME} Stimmt die Breite?`,
      reply_in_thread: true,
      focus_region: { page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.25, annotation_id: 'ann_1' },
    })
    expect(screen.queryByTestId('agent-answer-card')).toBeNull()
    expect(within(screen.getByTestId('review-thread')).getByTestId('thread-agent-pending')).toBeInTheDocument()

    agent.deliver(1, { type: 'RUN_STARTED', message_id: 'a-1' })
    agent.deliver(2, { type: 'RUN_FINISHED', outcome: 'answered', result: { message_id: 'a-1', text: 'Ja, 1,20 m.' } })
    await waitFor(() => expect(screen.queryByTestId('thread-agent-pending')).toBeNull())
  })

  it('leaves a reply that mentions the agent to the server when it wakes the agent, and shows the work as the server knows it', async () => {
    const mark = view({ id: 'ann_1', shape: 'region', x: 0.1, y: 0.2, w: 0.3, h: 0.25 })
    const asked: AnnotationView['replies'][number] = {
      id: 'r1',
      annotationId: 'ann_1',
      authorKind: 'person',
      body: 'Stimmt die Breite?',
      createdBy: 'user_me',
      createdByName: 'Miriam Hofer',
      createdAt: '2026-10-01T09:00:00.000Z',
      addressesPiloti: true,
    }
    serve([mark], true, true)
    const posted = serveConversation()
    server.use(
      http.post('/api/documents/:id/annotations/:annotationId/replies', () =>
        HttpResponse.json(
          {
            annotation: {
              ...mark,
              replies: [asked],
              pilotiWork: {
                state: 'queued',
                trigger: 'thread_mention',
                forUserId: 'user_me',
                forName: 'Miriam Hofer',
                reasonKind: null,
                since: '2026-10-01T09:00:00.000Z',
              },
            },
            replyId: 'r1',
            wake: 'queued',
          },
          { status: 201 }
        )
      )
    )
    const agent = scriptedAgent()
    const room = scriptedRoom()
    render(<Harness transport={room.transport} agent={agent} />)

    await userEvent.click(await screen.findByTestId('review-row'))
    const thread = await screen.findByTestId('review-thread')
    const box = within(thread).getByTestId('thread-reply')
    await userEvent.type(box, `@${PRODUCT_NAME.slice(0, 3).toLowerCase()}`)
    await userEvent.click(pickerOption(thread, 'agent:core'))
    await userEvent.type(box, 'Stimmt die Breite?{Enter}')

    const work = await within(screen.getByTestId('review-thread')).findByTestId('thread-agent-work')
    expect(work).toHaveAttribute('data-state', 'queued')
    expect(work).toHaveTextContent('Miriam Hofer')
    expect(agent.questions()).toEqual([])
    expect(posted).toEqual([])

    const answered = {
      ...mark,
      replies: [
        asked,
        { ...asked, id: 'r2', authorKind: 'piloti' as const, body: '1,20 m im Schnitt B-B.', addressesPiloti: false },
      ],
    }
    serve([answered], true, true)
    room.send({
      kind: 'event',
      event: {
        kind: 'annotations.changed',
        annotationIds: ['ann_1'],
        change: 'replied',
        actor: { peerId: null, userId: 'user_me', name: PRODUCT_NAME, kind: 'piloti' },
      },
    })
    await waitFor(() => expect(screen.queryByTestId('thread-agent-work')).toBeNull())
    expect(within(screen.getByTestId('review-thread')).getByText('1,20 m im Schnitt B-B.')).toBeInTheDocument()
  })

  it('says why a woken agent did not answer, from the mark as the server reads it', async () => {
    serve(
      [
        view({
          id: 'ann_1',
          pilotiWork: {
            state: 'failed',
            trigger: 'thread_mention',
            forUserId: 'user_me',
            forName: 'Miriam Hofer',
            reasonKind: 'budget',
            since: '2026-10-01T09:00:00.000Z',
          },
        }),
      ],
      true,
      true
    )
    render(<Harness transport={scriptedRoom().transport} agent={scriptedAgent()} />)

    await userEvent.click(await screen.findByTestId('review-row'))
    const work = await within(await screen.findByTestId('review-thread')).findByTestId('thread-agent-work')
    expect(work).toHaveAttribute('data-state', 'failed')
    expect(work).toHaveTextContent(/budget/i)
  })

  it('delegates an open mark to the agent from the thread, and shows for whom the agent works it', async () => {
    serve([view({ id: 'ann_1' })], true, true)
    const patches: unknown[] = []
    server.use(
      http.patch('/api/documents/:id/annotations/:annotationId', async ({ request }) => {
        patches.push(await request.json())
        return HttpResponse.json({
          annotation: view({
            id: 'ann_1',
            delegatedBy: 'user_me',
            delegatedByName: 'Miriam Hofer',
            delegatedAt: '2026-10-13T09:00:00.000Z',
          }),
          wake: 'queued',
        })
      })
    )
    render(<Harness transport={scriptedRoom().transport} />)

    await userEvent.click(await screen.findByTestId('review-row'))
    const thread = await screen.findByTestId('review-thread')
    expect(within(thread).queryByTestId('thread-delegate')).toBeNull()
    await userEvent.click(within(thread).getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: `Delegate to ${PRODUCT_NAME}` }))

    await waitFor(() => expect(patches).toEqual([{ delegateToPiloti: true }]))
    expect(await within(screen.getByTestId('review-thread')).findByTestId('thread-delegate')).toHaveTextContent(
      `${PRODUCT_NAME} is working on it · for Miriam Hofer`
    )
  })

  it('offers no delegation while the organization does not let events wake the agent', async () => {
    serve([view({ id: 'ann_1' })])
    render(<Harness transport={scriptedRoom().transport} />)

    await userEvent.click(await screen.findByTestId('review-row'))
    const thread = await screen.findByTestId('review-thread')
    await userEvent.click(within(thread).getByRole('button', { name: 'More' }))
    expect(await screen.findByRole('menuitem', { name: 'Copy link' }).catch(() => null)).toBeDefined()
    expect(screen.queryByRole('menuitem', { name: `Delegate to ${PRODUCT_NAME}` })).toBeNull()
  })

  it("draws the agent's own pointer and what it points out, from the room", async () => {
    const restore = installLayoutObservers({ frameWidth: 800 })
    serve([])
    const room = scriptedRoom()
    render(<Harness transport={room.transport} />)
    await screen.findByTestId('review-empty')
    const AGENT = { peerId: 'agent_peer_01', userId: 'agent', name: PRODUCT_NAME, kind: 'piloti' as const }

    room.send({ kind: 'event', event: { kind: 'presence', peer: AGENT, state: 'here', ttlMs: 25_000 } })
    room.send({ kind: 'event', event: { kind: 'cursor', peer: AGENT, cursor: { page: 1, x: 0.4, y: 0.4 } } })
    room.send({
      kind: 'event',
      event: { kind: 'activity', peer: AGENT, state: 'reading', label: 'Liest die Stiege', box: { page: 1, x: 0.5, y: 0.1, w: 0.2, h: 0.3 } },
    })

    const sheet = screen.getByTestId('sheet')
    expect(await within(sheet).findByText(`${PRODUCT_NAME} · Liest die Stiege`, { selector: '[data-slot="live-cursor"] *' })).toBeInTheDocument()
    const highlight = await within(sheet).findByTestId('agent-highlight')
    expect(highlight.style.left).toBe('50%')
    restore()
  })
})

describe('The agent checks what is fixed in the current Fassung', () => {
  const HERE = { documentId: 'doc_1', documentName: 'Grundriss Index C.pdf' }

  function serveLists(lists: Record<string, AnnotationView[]>) {
    const patched: Array<{ documentId: string; annotationId: string; change: Record<string, unknown> }> = []
    server.use(
      http.get('/api/documents/:id/annotations', ({ params }) =>
        HttpResponse.json({ annotations: lists[String(params.id)] ?? [], canAnnotate: true, pilotiWakes: false })
      ),
      http.patch('/api/documents/:id/annotations/:annotationId', async ({ params, request }) => {
        const change = (await request.json()) as Record<string, unknown>
        const documentId = String(params.id)
        const annotationId = String(params.annotationId)
        patched.push({ documentId, annotationId, change })
        const mark = (lists[documentId] ?? []).find((annotation) => annotation.id === annotationId) as AnnotationView
        const after = { ...mark, status: 'resolved' as const, closedBy: 'user_me', closedAt: '2026-10-18T09:00:00.000Z', carryTarget: null }
        lists[documentId] = (lists[documentId] ?? []).map((annotation) => (annotation.id === annotationId ? after : annotation))
        return HttpResponse.json({ annotation: after })
      })
    )
    return patched
  }

  it('asks the agent, from the earlier Fassungen’ bar, to answer in each mark’s thread whether it is fixed, and changes nothing itself', async () => {
    const patched = serveLists({
      doc_1: [
        view({ id: 'ann_2', number: 2, onCurrentRevision: false, revisionNumber: 1, carryTarget: HERE }),
        view({ id: 'ann_1', number: 1, onCurrentRevision: false, revisionNumber: 2, carryTarget: HERE }),
        view({ id: 'ann_3', number: 3 }),
      ],
    })
    serveConversation()
    const agent = scriptedAgent()
    render(<Harness transport={scriptedRoom().transport} agent={agent} />)

    const bar = await screen.findByTestId('review-earlier-bar')
    await userEvent.click(within(bar).getByRole('button', { name: `Have ${PRODUCT_NAME} check what is fixed` }))

    await waitFor(() => expect(agent.questions()).toHaveLength(1))
    const question = agent.questions()[0]
    expect(question.text).toContain('open annotations 1 and 2 from an earlier revision are fixed in Revision 3')
    expect(question.text).toContain('“Fixed in Revision 3:” or “Still open:”')
    expect(question.text).toContain('Do not resolve or otherwise change any annotation')
    expect(question).toMatchObject({ focus_document_id: 'doc_1' })
    expect(question.focus_region ?? null).toBeNull()
    expect(question).not.toHaveProperty('reply_in_thread')
    expect(within(bar).getByTestId('review-check-fixed-earlier')).toHaveTextContent(`${PRODUCT_NAME} is checking what is fixed …`)
    expect(within(bar).getByTestId('review-check-fixed-earlier')).toBeDisabled()

    agent.deliver(1, { type: 'RUN_STARTED', message_id: 'a-1' })
    agent.deliver(2, { type: 'RUN_FINISHED', outcome: 'answered', result: { message_id: 'a-1', text: 'Erledigt.' } })
    await waitFor(() => expect(within(bar).getByTestId('review-check-fixed-earlier')).toBeEnabled())
    expect(within(bar).getByTestId('review-check-fixed-earlier')).toHaveTextContent(`Have ${PRODUCT_NAME} check what is fixed`)
    expect(patched).toEqual([])
  })

  it('offers no check where the agent cannot be asked', async () => {
    serveLists({ doc_1: [view({ id: 'ann_1', number: 1, onCurrentRevision: false, carryTarget: HERE })] })
    render(<Harness transport={scriptedRoom().transport} />)

    const bar = await screen.findByTestId('review-earlier-bar')
    expect(within(bar).queryByTestId('review-check-fixed-earlier')).toBeNull()
  })

  it('checks the replaced document’s marks, shows the agent’s answer on each row, and lets the person resolve one there', async () => {
    const lists: Record<string, AnnotationView[]> = {
      doc_1: [],
      doc_b: [
        view({ id: 'ann_b4', documentId: 'doc_b', number: 4, body: 'Brüstung unter 1,00 m', carryTarget: HERE }),
        view({ id: 'ann_b5', documentId: 'doc_b', number: 5, body: 'Lüftung fehlt in der Legende', carryTarget: HERE }),
      ],
    }
    const patched = serveLists(lists)
    serveConversation()
    const agent = scriptedAgent()
    render(
      <Harness
        transport={scriptedRoom().transport}
        agent={agent}
        revision={{ replacedBy: null, replaces: [{ id: 'doc_b', filename: 'Grundriss Index B.pdf' }] }}
      />
    )

    const group = await screen.findByTestId('review-carried-group')
    await userEvent.click(within(group).getByTestId('review-check-fixed-from'))
    await waitFor(() => expect(agent.questions()).toHaveLength(1))
    expect(agent.questions()[0].text).toContain(
      'open annotations 4 and 5 on “Grundriss Index B.pdf” are fixed in this document, “Grundriss Index C”'
    )
    expect(agent.questions()[0].text).toContain('answer in its thread on “Grundriss Index B.pdf”')

    const verdict = (annotationId: string, body: string) => ({
      id: `${annotationId}-agent`,
      annotationId,
      authorKind: 'piloti' as const,
      body,
      createdBy: 'user_me',
      createdByName: 'Miriam Hofer',
      createdAt: '2026-10-18T09:00:00.000Z',
      addressesPiloti: false,
      mentions: [],
    })
    lists.doc_b = lists.doc_b.map((annotation) =>
      annotation.id === 'ann_b4'
        ? { ...annotation, replies: [verdict('ann_b4', 'In Grundriss Index C behoben: Brüstung jetzt mit 1,00 m kotiert.')] }
        : { ...annotation, replies: [verdict('ann_b5', 'Weiterhin offen: Die Legende nennt keinen Lüftungsquerschnitt.')] }
    )
    agent.deliver(1, { type: 'RUN_STARTED', message_id: 'a-1' })
    agent.deliver(2, { type: 'RUN_FINISHED', outcome: 'answered', result: { message_id: 'a-1', text: 'Geprüft.' } })

    const verdicts = await within(group).findAllByTestId('review-carried-verdict')
    expect(verdicts.map((line) => line.textContent)).toEqual([
      `${PRODUCT_NAME}’s answer: In Grundriss Index C behoben: Brüstung jetzt mit 1,00 m kotiert.`,
      `${PRODUCT_NAME}’s answer: Weiterhin offen: Die Legende nennt keinen Lüftungsquerschnitt.`,
    ])

    await userEvent.click(within(group).getByRole('button', { name: 'Resolve annotation 4 on “Grundriss Index B.pdf”' }))
    await waitFor(() =>
      expect(patched).toEqual([
        { documentId: 'doc_b', annotationId: 'ann_b4', change: { status: 'resolved', expectedStatus: 'open' } },
      ])
    )
    await waitFor(() => expect(within(screen.getByTestId('review-carried-group')).getAllByTestId('review-carried-row')).toHaveLength(1))
  })
})
