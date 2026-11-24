import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@/test-utils'
import { http, HttpResponse } from 'msw'
import { toast } from 'sonner'
import { server } from '@/mocks/server'
import { onDocumentsChanged } from '@/lib/documents/document-changes'
import { INGEST_ALREADY_DONE, INGEST_RUNNING } from '@/lib/documents/reingest-codes'
import { useDocumentActions } from './use-document-actions'

const DOCUMENT = { id: 'doc-1', filename: 'Einreichplan_EG.pdf', displayName: null, status: 'processing' }

function refuseWith(details: Record<string, unknown>) {
  server.use(
    http.post('/api/documents/doc-1/reingest', () =>
      HttpResponse.json({ error: 'Conflict', code: 'CONFLICT', details }, { status: 409 })
    )
  )
}

function setup() {
  const onReingested = vi.fn()
  const changed = vi.fn()
  const unsubscribe = onDocumentsChanged(changed)
  const hook = renderHook(() => useDocumentActions({ document: DOCUMENT, scope: 'officeShelf', onReingested }))
  return { hook, onReingested, changed, unsubscribe }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useDocumentActions — reingest refusals', () => {
  it('says it is already being read, and refreshes, when the job is running', async () => {
    refuseWith({ status: 'processing', code: INGEST_RUNNING })
    const info = vi.spyOn(toast, 'info')
    const error = vi.spyOn(toast, 'error')
    const { hook, onReingested, changed, unsubscribe } = setup()

    let result: string | null = null
    await act(async () => {
      result = await hook.result.current.reingest()
    })

    expect(result).toBe('processing')
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/bereits gelesen|already being read/i))
    expect(error).not.toHaveBeenCalled()
    expect(onReingested).toHaveBeenCalledWith('doc-1', 'processing')
    expect(changed).toHaveBeenCalled()
    unsubscribe()
  })

  it('says it is already finished, and reports the healed status, after a heal', async () => {
    refuseWith({ status: 'completed', code: INGEST_ALREADY_DONE })
    const info = vi.spyOn(toast, 'info')
    const error = vi.spyOn(toast, 'error')
    const { hook, onReingested, changed, unsubscribe } = setup()

    await act(async () => {
      await hook.result.current.reingest()
    })

    expect(info).toHaveBeenCalledWith(expect.stringMatching(/bereits fertig|already finished/i))
    expect(error).not.toHaveBeenCalled()
    expect(onReingested).toHaveBeenCalledWith('doc-1', 'completed')
    expect(changed).toHaveBeenCalled()
    unsubscribe()
  })

  it('keeps the generic error for a refusal it has no words for', async () => {
    refuseWith({ status: 'stored', code: 'INGEST_NOT_ELIGIBLE' })
    const error = vi.spyOn(toast, 'error')
    const { hook, onReingested, unsubscribe } = setup()

    let result: string | null = 'unset'
    await act(async () => {
      result = await hook.result.current.reingest()
    })

    expect(result).toBeNull()
    expect(error).toHaveBeenCalled()
    expect(onReingested).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('reports the new status and refreshes on success', async () => {
    server.use(http.post('/api/documents/doc-1/reingest', () => HttpResponse.json({ status: 'pending' })))
    const { hook, onReingested, changed, unsubscribe } = setup()

    await act(async () => {
      await hook.result.current.reingest()
    })

    expect(onReingested).toHaveBeenCalledWith('doc-1', 'pending')
    expect(changed).toHaveBeenCalled()
    unsubscribe()
  })
})

describe('useDocumentActions — move refusals', () => {
  it('says why an IFC model cannot go into a restricted folder, instead of "try again" (ADR-0087)', async () => {
    server.use(
      http.patch('/api/documents/doc-1/folder', () =>
        HttpResponse.json({ error: 'IFC models cannot be filed in a restricted folder yet', code: 'CONFLICT' }, { status: 409 })
      )
    )
    const error = vi.spyOn(toast, 'error')
    const onMoved = vi.fn()
    const hook = renderHook(() => useDocumentActions({ document: DOCUMENT, scope: 'files', onMoved }))

    let moved: boolean | null = null
    await act(async () => {
      moved = await hook.result.current.move('f-restricted', 'Verwaltung')
    })

    expect(moved).toBe(false)
    expect(error).toHaveBeenCalledWith(expect.stringMatching(/not everyone may read yet|den nicht alle lesen dürfen/))
    expect(onMoved).not.toHaveBeenCalled()
  })
})

describe('useDocumentActions — deleting', () => {
  it('moves a project document to the bin and says until when it can be restored', async () => {
    const permanent = vi.fn()
    server.use(
      http.post('/api/documents/doc-1/bin', () =>
        HttpResponse.json({ documentId: 'doc-1', binEntryId: 'holder-1', purgeAfter: '2026-12-04T10:00:00.000Z' })
      ),
      http.delete('/api/documents/doc-1', () => {
        permanent()
        return new HttpResponse(null, { status: 204 })
      })
    )
    const success = vi.spyOn(toast, 'success').mockImplementation(() => 'id')
    const onDeleted = vi.fn()
    const hook = renderHook(() => useDocumentActions({ document: DOCUMENT, scope: 'files', onDeleted }))

    let removed = false
    await act(async () => {
      removed = await hook.result.current.remove()
    })

    expect(removed).toBe(true)
    expect(permanent).not.toHaveBeenCalled()
    expect(onDeleted).toHaveBeenCalledWith('doc-1')
    expect(success).toHaveBeenCalledWith(expect.stringMatching(/^“Einreichplan_EG\.pdf” is in the bin\. Restorable until .*2026\.$/))
  })

  it('moves an office shelf document to the Bürobibliothek’s bin and says until when (KAN-90)', async () => {
    const binned = vi.fn()
    const permanent = vi.fn()
    server.use(
      http.post('/api/documents/doc-1/bin', () => {
        binned()
        return HttpResponse.json({ documentId: 'doc-1', binEntryId: 'holder-1', purgeAfter: '2026-12-08T10:00:00.000Z' })
      }),
      http.delete('/api/documents/doc-1', () => {
        permanent()
        return new HttpResponse(null, { status: 204 })
      })
    )
    const success = vi.spyOn(toast, 'success').mockImplementation(() => 'id')
    const hook = renderHook(() => useDocumentActions({ document: DOCUMENT, scope: 'officeShelf' }))

    await act(async () => {
      await hook.result.current.remove()
    })

    expect(binned).toHaveBeenCalledTimes(1)
    expect(permanent).not.toHaveBeenCalled()
    expect(success).toHaveBeenCalledWith(expect.stringMatching(/Einreichplan_EG\.pdf.*(bin|Papierkorb)/))
  })

  it('deletes a held project file for good, so its name never shows in the project bin', async () => {
    const binned = vi.fn()
    const permanent = vi.fn()
    server.use(
      http.post('/api/documents/doc-1/bin', () => {
        binned()
        return HttpResponse.json({ documentId: 'doc-1', binEntryId: 'holder-1', purgeAfter: '2026-12-04T10:00:00.000Z' })
      }),
      http.delete('/api/documents/doc-1', () => {
        permanent()
        return new HttpResponse(null, { status: 204 })
      })
    )
    vi.spyOn(toast, 'success').mockImplementation(() => 'id')
    const held = { ...DOCUMENT, status: 'quarantined' }
    const hook = renderHook(() => useDocumentActions({ document: held, scope: 'files' }))

    expect(hook.result.current.erases).toBe(true)
    await act(async () => {
      await hook.result.current.remove()
    })

    expect(binned).not.toHaveBeenCalled()
    expect(permanent).toHaveBeenCalledTimes(1)
  })

  it('says a legal hold keeps the document, when the bin refuses for that', async () => {
    server.use(
      http.post('/api/documents/doc-1/bin', () =>
        HttpResponse.json({ error: 'Conflict', code: 'CONFLICT', details: { reason: 'legal_hold' } }, { status: 409 })
      )
    )
    const error = vi.spyOn(toast, 'error').mockImplementation(() => 'id')
    const hook = renderHook(() => useDocumentActions({ document: DOCUMENT, scope: 'files' }))

    let removed = true
    await act(async () => {
      removed = await hook.result.current.remove()
    })

    expect(removed).toBe(false)
    expect(error).toHaveBeenCalledWith('The document is under a legal hold and cannot be deleted')
  })
})
