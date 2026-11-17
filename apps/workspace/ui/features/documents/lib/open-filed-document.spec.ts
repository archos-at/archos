import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/store'
import { useFilePreviewStore } from '../stores/file-preview-store'
import { resetFilePeekBinding } from './open-file-peek'
import { openFiledDocument } from './open-filed-document'

const ROW = {
  id: 'doc-9',
  filename: 'Tiefenrecherche_Brandschutz.pdf',
  displayName: null,
  status: 'stored',
  contentType: 'application/pdf',
  fileSize: 1048576,
  createdAt: '2026-01-01T00:00:00.000Z',
  authoredBy: 'agent',
}

function answerWith(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) } as Response)),
  )
}

beforeEach(() => {
  resetFilePeekBinding()
  useFilePreviewStore.setState({ file: null, mode: 'modal', hidden: false, context: {} })
  useChatStore.setState({ composerSubject: null })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('opening the artifact Piloti just filed', () => {
  it('puts it in the peek pane rather than navigating away', async () => {
    answerWith(ROW)
    await expect(openFiledDocument({ documentId: 'doc-9', projectId: 'proj-1' })).resolves.toBe(true)
    const state = useFilePreviewStore.getState()
    expect(state.file?.id).toBe('doc-9')
    expect(state.mode).toBe('peek')
    expect(state.hidden).toBe(false)
  })

  it('reads the row through the status call the chat route already uses', async () => {
    answerWith(ROW)
    await openFiledDocument({ documentId: 'doc 9/x', projectId: 'proj-1' })
    expect(fetch).toHaveBeenCalledWith('/api/documents/doc%209%2Fx/status')
  })

  it('carries the byline into the pane', async () => {
    answerWith(ROW)
    await openFiledDocument({ documentId: 'doc-9', projectId: 'proj-1' })
    expect(useFilePreviewStore.getState().file?.authoredBy).toBe('agent')
  })

  it('does not bind it as the composer subject', async () => {
    answerWith(ROW)
    await openFiledDocument({ documentId: 'doc-9', projectId: 'proj-1' })
    expect(useChatStore.getState().composerSubject).toBeNull()
  })
})

describe('when the row cannot be read', () => {
  it('says so instead of opening an empty pane', async () => {
    answerWith(null, false)
    await expect(openFiledDocument({ documentId: 'doc-9', projectId: 'proj-1' })).resolves.toBe(false)
    expect(useFilePreviewStore.getState().file).toBeNull()
  })

  it('refuses a body that is not a document', async () => {
    answerWith({ error: 'nope' })
    await expect(openFiledDocument({ documentId: 'doc-9', projectId: 'proj-1' })).resolves.toBe(false)
    expect(useFilePreviewStore.getState().file).toBeNull()
  })
})
