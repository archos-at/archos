import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderHook, waitFor } from '@/test-utils'
import { server } from '@/mocks/server'
import type { AnnotationView } from '@/lib/annotations/types'
import { useDocumentReview } from './use-document-review'
import { useChatStore } from '@/features/chat/store'
import { view, scriptedRoom, ANNA } from '../components/review/review.fixtures'

beforeEach(() => useChatStore.setState({ currentUserId: 'user_me' }))

describe('the review', () => {
  it("never draws a mark of the document left behind: a re-read that answers after the switch lands nowhere", async () => {
    let release: () => void = () => {}
    server.use(
      http.get('/api/documents/:id/annotations', () => HttpResponse.json({ annotations: [], canAnnotate: true })),
      http.get('/api/documents/:id/annotations/:annotationId', async () => {
        await new Promise<void>((resolve) => (release = resolve))
        return HttpResponse.json({ annotation: view({ id: 'theirs', documentId: 'doc_1', body: 'Auf Dokument A' }) })
      })
    )
    const room = scriptedRoom()
    const { result, rerender } = renderHook(({ id }) => useDocumentReview(id, { enabled: true, transport: room.transport }), {
      initialProps: { id: 'doc_1' },
    })
    await waitFor(() => expect(result.current.load).toBe('ready'))
    room.send({
      kind: 'event',
      event: { kind: 'annotations.changed', annotationIds: ['theirs'], change: 'created', actor: { ...ANNA } },
    })
    await act(() => new Promise((resolve) => setTimeout(resolve, 200)))

    rerender({ id: 'doc_2' })
    await waitFor(() => expect(result.current.load).toBe('ready'))
    release()
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))

    expect(result.current.annotations).toEqual([])
  })

  it('sends a decision held by a key to the document it was taken on, even after the pane moved on', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const patchedOn: string[] = []
    server.use(
      http.get('/api/documents/:id/annotations', ({ params }) =>
        HttpResponse.json({
          annotations: params.id === 'doc_1' ? [view({ id: 'm', documentId: 'doc_1' })] : [],
          canAnnotate: true,
        })
      ),
      http.patch('/api/documents/:id/annotations/:annotationId', ({ params }) => {
        patchedOn.push(String(params.id))
        return HttpResponse.json({ annotation: view({ id: 'm', documentId: String(params.id), status: 'resolved' }) })
      })
    )
    try {
      const room = scriptedRoom()
      const { result, rerender } = renderHook(
        ({ id }) => useDocumentReview(id, { enabled: true, transport: room.transport }),
        { initialProps: { id: 'doc_1' } }
      )
      await waitFor(() => expect(result.current.annotations).toHaveLength(1))
      act(() => {
        result.current.decide(result.current.annotations[0], 'resolved')
      })

      rerender({ id: 'doc_2' })
      await waitFor(() => expect(result.current.load).toBe('ready'))
      await act(async () => {
        vi.advanceTimersByTime(6_000)
      })

      await waitFor(() => expect(patchedOn).toEqual(['doc_1']))
      expect(result.current.annotations.map((annotation) => annotation.id)).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('sends a change asked while a held decision is on its way, rather than taking back a write already sent', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const sent: Array<{ status?: string; expectedStatus?: string }> = []
    let answerFirst: () => void = () => {}
    server.use(
      http.get('/api/documents/:id/annotations', () =>
        HttpResponse.json({ annotations: [view({ id: 'm' })], canAnnotate: true })
      ),
      http.patch('/api/documents/:id/annotations/:annotationId', async ({ request }) => {
        const body = (await request.json()) as { status?: string; expectedStatus?: string }
        sent.push(body)
        if (sent.length === 1) await new Promise<void>((resolve) => (answerFirst = resolve))
        return HttpResponse.json({ annotation: view({ id: 'm', status: (body.status ?? 'open') as AnnotationView['status'] }) })
      })
    )
    try {
      const room = scriptedRoom()
      const { result } = renderHook(() => useDocumentReview('doc_1', { enabled: true, transport: room.transport }))
      await waitFor(() => expect(result.current.annotations).toHaveLength(1))
      act(() => {
        result.current.decide(result.current.annotations[0], 'resolved')
      })
      await act(async () => {
        vi.advanceTimersByTime(6_000)
      })
      await waitFor(() => expect(sent).toHaveLength(1))

      let reopened: Promise<unknown> = Promise.resolve()
      act(() => {
        reopened = result.current.update('m', { status: 'open', expectedStatus: 'resolved' })
      })
      answerFirst()
      await act(async () => {
        await reopened
      })
      expect(sent).toEqual([
        { status: 'resolved', expectedStatus: 'open' },
        { status: 'open', expectedStatus: 'resolved' },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets only the latest re-read of a mark land: an older answer cannot bring back a mark a newer one found gone', async () => {
    const answers: Array<() => void> = []
    let reads = 0
    server.use(
      http.get('/api/documents/:id/annotations', () =>
        HttpResponse.json({ annotations: [view({ id: 'm', body: 'Wird gelöscht' })], canAnnotate: true })
      ),
      http.get('/api/documents/:id/annotations/:annotationId', async () => {
        reads += 1
        if (reads === 1) {
          await new Promise<void>((resolve) => answers.push(resolve))
          return HttpResponse.json({ annotation: view({ id: 'm', body: 'Wird gelöscht' }) })
        }
        return HttpResponse.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404 })
      })
    )
    const room = scriptedRoom()
    const { result } = renderHook(() => useDocumentReview('doc_1', { enabled: true, transport: room.transport }))
    await waitFor(() => expect(result.current.annotations).toHaveLength(1))
    const hint = (change: 'updated' | 'deleted') =>
      room.send({ kind: 'event', event: { kind: 'annotations.changed', annotationIds: ['m'], change, actor: { ...ANNA } } })

    hint('updated')
    await waitFor(() => expect(answers).toHaveLength(1))
    hint('deleted')
    await waitFor(() => expect(result.current.annotations).toEqual([]))

    answers[0]?.()
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(result.current.annotations).toEqual([])
  })
})
