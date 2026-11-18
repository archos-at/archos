import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { render, screen, waitFor, within } from '@/test-utils'
import { server } from '@/mocks/server'
import type { AnnotationView } from '@/lib/annotations/types'
import { CARRY_AT_ONCE } from '../../hooks/use-document-review'
import { useChatStore } from '@/features/chat/store'
import { view, scriptedRoom, Harness, serve } from './review.fixtures'

beforeEach(() => useChatStore.setState({ currentUserId: 'user_me' }))
beforeEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
})

describe('a mark goes on with the current Fassung', () => {
  const HERE = { documentId: 'doc_1', documentName: 'Grundriss EG.pdf' }

  function serveDocuments(lists: Record<string, AnnotationView[]>, { failingReads = {} }: { failingReads?: Record<string, number> } = {}) {
    const patched: Array<{ documentId: string; annotationId: string; change: Record<string, unknown> }> = []
    const failing = { ...failingReads }
    server.use(
      http.get('/api/documents/:id/annotations', ({ params }) => {
        const id = String(params.id)
        if ((failing[id] ?? 0) > 0) {
          failing[id] -= 1
          return HttpResponse.json({ error: 'Unavailable', code: 'UNAVAILABLE' }, { status: 503 })
        }
        return HttpResponse.json({ annotations: lists[id] ?? [], canAnnotate: true, pilotiWakes: false })
      }),
      http.patch('/api/documents/:id/annotations/:annotationId', async ({ params, request }) => {
        const change = (await request.json()) as Record<string, unknown>
        const documentId = String(params.id)
        const annotationId = String(params.annotationId)
        patched.push({ documentId, annotationId, change })
        const mark = (lists[documentId] ?? []).find((annotation) => annotation.id === annotationId) as AnnotationView
        if (documentId === 'doc_1') {
          const moved = { ...mark, onCurrentRevision: true, revisionNumber: 3, carryTarget: null }
          lists.doc_1 = lists.doc_1.map((annotation) => (annotation.id === annotationId ? moved : annotation))
          return HttpResponse.json({ annotation: moved })
        }
        const copy = view({
          ...mark,
          id: `${annotationId}_on_doc_1`,
          documentId: 'doc_1',
          number: 9,
          carriedFrom: { annotationId, documentId, number: mark.number, documentName: 'Grundriss Index B.pdf' },
          carryTarget: null,
        })
        lists[documentId] = (lists[documentId] ?? []).map((annotation) =>
          annotation.id === annotationId ? { ...annotation, status: 'resolved', carryTarget: null } : annotation
        )
        lists.doc_1 = [...(lists.doc_1 ?? []), copy]
        return HttpResponse.json({ annotation: copy })
      })
    )
    return patched
  }

  it('carries a mark of an earlier Fassung from its card, keeping its number, and the card stops saying it is not drawn', async () => {
    const patched = serveDocuments({
      doc_1: [view({ id: 'ann_4', number: 4, onCurrentRevision: false, revisionNumber: 2, carryTarget: HERE })],
    })
    render(<Harness transport={scriptedRoom().transport} />)

    await userEvent.click(await screen.findByTestId('review-row'))
    const thread = await screen.findByTestId('review-thread')
    expect(within(thread).getByTestId('thread-earlier')).toHaveTextContent('From revision 2. The hollow pin shows where it stood there.')
    await userEvent.click(within(thread).getByTestId('thread-carry'))

    await waitFor(() =>
      expect(patched).toEqual([
        { documentId: 'doc_1', annotationId: 'ann_4', change: { carryToCurrent: true, expectedStatus: 'open' } },
      ])
    )
    await waitFor(() => expect(within(screen.getByTestId('review-thread')).queryByTestId('thread-earlier')).toBeNull())
    expect(screen.getByTestId('review-thread')).toHaveTextContent('#4')
  })

  it('offers no carry the server says this reader’s carry would not go through: closed, read-only, or refused', async () => {
    serveDocuments({
      doc_1: [
        view({ id: 'ann_closed', number: 1, onCurrentRevision: false, status: 'resolved', closedBy: 'user_me', closedAt: '2026-10-02T08:00:00.000Z' }),
        view({ id: 'ann_ro', number: 2, onCurrentRevision: false, canEdit: false }),
        view({ id: 'ann_refused', number: 3, onCurrentRevision: false, carryTarget: null }),
      ],
    })
    render(<Harness transport={scriptedRoom().transport} />)

    for (const index of [0, 1]) {
      await waitFor(() => expect(screen.getAllByTestId('review-row').length).toBeGreaterThan(index))
      await userEvent.click(screen.getAllByTestId('review-row')[index] as HTMLElement)
      expect(within(await screen.findByTestId('review-thread')).queryByTestId('thread-carry')).toBeNull()
    }
    expect(screen.queryByTestId('review-earlier-bar')).toBeNull()
  })

  it('carries every open mark of earlier Fassungen at once from the list', async () => {
    const patched = serveDocuments({
      doc_1: [
        view({ id: 'ann_1', number: 1, onCurrentRevision: false, revisionNumber: 1, carryTarget: HERE }),
        view({ id: 'ann_2', number: 2, onCurrentRevision: false, revisionNumber: 2, carryTarget: HERE }),
        view({ id: 'ann_3', number: 3 }),
      ],
    })
    render(<Harness transport={scriptedRoom().transport} />)

    const bar = await screen.findByTestId('review-earlier-bar')
    expect(bar).toHaveTextContent('Open from earlier revisions: 2')
    await userEvent.click(within(bar).getByTestId('review-carry-all-earlier'))

    await waitFor(() => expect(patched.map((patch) => patch.annotationId)).toEqual(['ann_1', 'ann_2']))
    await waitFor(() => expect(screen.queryByTestId('review-earlier-bar')).toBeNull())
  })

  function serveThirty({ from, failing = new Set<string>() }: { from: 'doc_1' | 'doc_b'; failing?: ReadonlySet<string> }) {
    const marks = Array.from({ length: 30 }, (_, index) =>
      view({
        id: `ann_${index + 1}`,
        documentId: from,
        number: index + 1,
        onCurrentRevision: from === 'doc_b',
        revisionNumber: 2,
        carryTarget: HERE,
      })
    )
    const counts = { patches: 0, inFlight: 0, mostInFlight: 0, reads: { doc_1: 0, doc_b: 0 } as Record<string, number> }
    server.use(
      http.get('/api/documents/:id/annotations', ({ params }) => {
        const id = String(params.id)
        counts.reads[id] = (counts.reads[id] ?? 0) + 1
        return HttpResponse.json({ annotations: id === from ? marks : [], canAnnotate: true, pilotiWakes: false })
      }),
      http.patch('/api/documents/:id/annotations/:annotationId', async ({ params }) => {
        counts.patches += 1
        counts.inFlight += 1
        counts.mostInFlight = Math.max(counts.mostInFlight, counts.inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        counts.inFlight -= 1
        const annotationId = String(params.annotationId)
        if (failing.has(annotationId)) return HttpResponse.json({ error: 'Unavailable', code: 'UNAVAILABLE' }, { status: 503 })
        const index = marks.findIndex((mark) => mark.id === annotationId)
        const mark = marks[index] as AnnotationView
        if (from === 'doc_1') {
          marks[index] = { ...mark, onCurrentRevision: true, revisionNumber: 3, carryTarget: null }
          return HttpResponse.json({ annotation: marks[index] })
        }
        marks[index] = { ...mark, status: 'resolved', carryTarget: null }
        return HttpResponse.json({ annotation: view({ ...mark, id: `${annotationId}_on_doc_1`, documentId: 'doc_1', carryTarget: null }) })
      })
    )
    return counts
  }

  it('carries thirty marks of an earlier Fassung with four PATCHes at a time, and reads no list again', async () => {
    const counts = serveThirty({ from: 'doc_1' })
    render(<Harness transport={scriptedRoom().transport} />)
    const bar = await screen.findByTestId('review-earlier-bar')
    const readsBefore = { ...counts.reads }

    await userEvent.click(within(bar).getByTestId('review-carry-all-earlier'))

    await waitFor(() => expect(screen.queryByTestId('review-earlier-bar')).toBeNull())
    expect(counts.patches).toBe(30)
    expect(counts.mostInFlight).toBe(CARRY_AT_ONCE)
    expect(counts.reads).toEqual(readsBefore)
  })

  it('carries thirty marks of the replaced document and reads each list once after the last', async () => {
    const counts = serveThirty({ from: 'doc_b' })
    render(
      <Harness
        transport={scriptedRoom().transport}
        revision={{ replacedBy: null, replaces: [{ id: 'doc_b', filename: 'Grundriss Index B.pdf' }] }}
      />
    )
    const group = await screen.findByTestId('review-carried-group')
    const readsBefore = { ...counts.reads }

    await userEvent.click(within(group).getByTestId('review-carry-all-from'))

    await waitFor(() => expect(screen.queryByTestId('review-carried-group')).toBeNull())
    expect(counts.patches).toBe(30)
    expect(counts.mostInFlight).toBeLessThanOrEqual(CARRY_AT_ONCE)
    expect(counts.reads).toEqual({ doc_1: (readsBefore.doc_1 ?? 0) + 1, doc_b: (readsBefore.doc_b ?? 0) + 1 })
  })

  it('says when not all of them went, and carries the rest', async () => {
    const counts = serveThirty({ from: 'doc_1', failing: new Set(['ann_7', 'ann_19']) })
    render(<Harness transport={scriptedRoom().transport} />)
    const bar = await screen.findByTestId('review-earlier-bar')

    await userEvent.click(within(bar).getByTestId('review-carry-all-earlier'))

    expect(await within(bar).findByText('Not every annotation could be carried on. Please try again.')).toBeInTheDocument()
    expect(counts.patches).toBe(30)
    expect(bar).toHaveTextContent('Open from earlier revisions: 2')
  })

  it('lists the open marks of the document this one replaces, read-only, and carries one on as a mark of this one', async () => {
    const patched = serveDocuments({
      doc_1: [],
      doc_b: [
        view({ id: 'ann_b4', documentId: 'doc_b', number: 4, body: 'Brüstung unter 1,00 m', carryTarget: HERE }),
        view({ id: 'ann_b5', documentId: 'doc_b', number: 5, status: 'resolved', closedBy: 'user_me', closedAt: '2026-10-02T08:00:00.000Z' }),
        view({
          id: 'ann_b6',
          documentId: 'doc_b',
          number: 6,
          body: 'Geländerhöhe prüfen',
          delegatedBy: 'user_me',
          delegatedAt: '2026-10-02T08:00:00.000Z',
          carryTarget: null,
        }),
      ],
    })
    render(
      <Harness
        transport={scriptedRoom().transport}
        revision={{ replacedBy: null, replaces: [{ id: 'doc_b', filename: 'Grundriss Index B.pdf' }] }}
      />
    )

    const group = await screen.findByTestId('review-carried-group')
    expect(group).toHaveTextContent('From revision “Grundriss Index B.pdf”')
    const rows = within(group).getAllByTestId('review-carried-row')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Brüstung unter 1,00 m')
    expect(within(rows[1] as HTMLElement).queryByTestId('review-carry-from')).toBeNull()
    expect(within(group).queryByTestId('review-carry-all-from')).toBeNull()
    expect(within(group).queryByTestId('review-row')).toBeNull()

    await userEvent.click(within(group).getByRole('button', { name: 'Carry annotation 4 to the current revision' }))

    await waitFor(() =>
      expect(patched).toEqual([
        { documentId: 'doc_b', annotationId: 'ann_b4', change: { carryToCurrent: true, expectedStatus: 'open' } },
      ])
    )
    await waitFor(() => expect(within(screen.getByTestId('review-carried-group')).getAllByTestId('review-carried-row')).toHaveLength(1))
    expect(await screen.findByTestId('review-row')).toHaveTextContent('Brüstung unter 1,00 m')
  })

  it('says when the replaced document’s marks could not be read, and reads them again on retry', async () => {
    serveDocuments(
      { doc_1: [], doc_b: [view({ id: 'ann_b4', documentId: 'doc_b', number: 4, body: 'Brüstung unter 1,00 m', carryTarget: HERE })] },
      { failingReads: { doc_b: 1 } }
    )
    render(
      <Harness
        transport={scriptedRoom().transport}
        revision={{ replacedBy: null, replaces: [{ id: 'doc_b', filename: 'Grundriss Index B.pdf' }] }}
      />
    )

    const group = await screen.findByTestId('review-carried-group')
    expect(within(group).getByTestId('review-carried-error')).toHaveTextContent(
      'The annotations from “Grundriss Index B.pdf” could not be loaded.'
    )
    expect(within(group).queryByTestId('review-carried-row')).toBeNull()

    await userEvent.click(within(group).getByRole('button', { name: 'Try again' }))

    expect(await within(group).findByTestId('review-carried-row')).toHaveTextContent('Brüstung unter 1,00 m')
    expect(within(group).queryByTestId('review-carried-error')).toBeNull()
  })

  it('lists nothing from a replaced document while another document replaces this one', async () => {
    serveDocuments({ doc_1: [], doc_b: [view({ id: 'ann_b4', documentId: 'doc_b', number: 4 })] })
    render(
      <Harness
        transport={scriptedRoom().transport}
        revision={{
          replacedBy: { id: 'doc_d', filename: 'Grundriss Index D.pdf' },
          replaces: [{ id: 'doc_b', filename: 'Grundriss Index B.pdf' }],
        }}
      />
    )

    await screen.findByTestId('review-empty')
    expect(screen.queryByTestId('review-carried-group')).toBeNull()
  })

  it('offers to carry an open mark of a replaced document to where the carry lands, and says where a carried mark came from', async () => {
    serveDocuments({
      doc_1: [
        view({ id: 'ann_1', number: 1, carryTarget: { documentId: 'doc_d', documentName: 'Grundriss Index D.pdf' } }),
        view({
          id: 'ann_2',
          number: 2,
          status: 'resolved',
          closedBy: 'user_me',
          closedAt: '2026-10-02T08:00:00.000Z',
          carriedTo: { annotationId: 'ann_c7', documentId: 'doc_c', number: 7, documentName: 'Grundriss Index C.pdf' },
        }),
      ],
    })
    render(
      <Harness
        transport={scriptedRoom().transport}
        revision={{ replacedBy: { id: 'doc_c', filename: 'Grundriss Index C.pdf' }, replaces: [] }}
      />
    )

    await userEvent.click((await screen.findAllByTestId('review-row'))[0])
    const thread = await screen.findByTestId('review-thread')
    expect(within(thread).getByTestId('thread-earlier')).toHaveTextContent('This document was replaced by “Grundriss Index C.pdf”.')
    expect(within(thread).getByTestId('thread-carry')).toHaveTextContent('Carry to “Grundriss Index D.pdf”')

    await userEvent.click(screen.getByTestId('review-filter-closed'))
    await userEvent.click(await screen.findByTestId('review-row'))
    expect(await screen.findByTestId('thread-carried-to')).toHaveTextContent('Continues in “Grundriss Index C.pdf” as annotation 7')
  })
})

describe('a mark of an earlier Fassung on the sheet', () => {
  const HERE = { documentId: 'doc_1', documentName: 'Grundriss EG.pdf' }

  it('draws an open one hollow where it stood, named by its Fassung, and opens its card to carry it on', async () => {
    serve([
      view({ id: 'ann_1', number: 1 }),
      view({ id: 'ann_4', number: 4, x: 0.6, onCurrentRevision: false, revisionNumber: 2, carryTarget: HERE }),
      view({ id: 'ann_5', number: 5, onCurrentRevision: false, status: 'resolved', closedBy: 'user_me', closedAt: '2026-10-02T08:00:00.000Z' }),
    ])
    render(<Harness transport={scriptedRoom().transport} />)

    const ghost = await within(screen.getByTestId('sheet')).findByTestId('review-ghost-pin')
    expect(within(screen.getByTestId('sheet')).getAllByTestId('review-ghost-pin')).toHaveLength(1)
    expect(ghost).toHaveTextContent('4')
    expect(ghost).toHaveAttribute('data-ghost', 'true')
    expect(ghost.getAttribute('aria-label')).toBe('Annotation 4: Defect · from revision 2')
    expect(within(screen.getByTestId('sheet')).getAllByTestId('review-pin')).toHaveLength(1)

    await userEvent.click(ghost)

    const thread = await screen.findByTestId('review-thread')
    expect(within(thread).getByTestId('thread-earlier')).toHaveTextContent('From revision 2.')
    expect(within(thread).getByTestId('thread-carry')).toBeInTheDocument()
  })

  it('draws no ghost under „Resolved", nor a mark of the document this one replaces', async () => {
    server.use(
      http.get('/api/documents/:id/annotations', ({ params }) =>
        HttpResponse.json({
          annotations:
            params.id === 'doc_b'
              ? [view({ id: 'ann_b4', documentId: 'doc_b', number: 4, onCurrentRevision: false, carryTarget: HERE })]
              : [view({ id: 'ann_4', number: 4, onCurrentRevision: false, carryTarget: HERE })],
          canAnnotate: true,
          pilotiWakes: false,
        })
      )
    )
    render(
      <Harness
        transport={scriptedRoom().transport}
        revision={{ replacedBy: null, replaces: [{ id: 'doc_b', filename: 'Grundriss Index B.pdf' }] }}
      />
    )
    await screen.findByTestId('review-carried-group')
    expect(within(screen.getByTestId('sheet')).getAllByTestId('review-ghost-pin')).toHaveLength(1)

    await userEvent.click(screen.getByTestId('review-filter-closed'))

    expect(within(screen.getByTestId('sheet')).queryByTestId('review-ghost-pin')).toBeNull()
  })
})
