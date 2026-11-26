import { beforeEach, describe, expect, it, vi } from 'vitest'

const sent = vi.hoisted(() => ({ bodies: [] as FormData[], refusal: null as null | { status: number; body: unknown } }))
vi.mock('@/lib/http/xhr-upload', () => {
  class XhrUploadError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly responseText: string
    ) {
      super(message)
    }
  }
  return {
    XhrUploadError,
    XhrNetworkError: class extends Error {},
    xhrUpload: vi.fn(async ({ body }: { body: FormData }) => {
      sent.bodies.push(body)
      if (sent.refusal) throw new XhrUploadError('refused', sent.refusal.status, JSON.stringify(sent.refusal.body))
      return JSON.stringify({ documentId: 'doc-1', status: 'stored' })
    }),
  }
})

import type { TrackedFile } from '../types'
import { uploadTrackedFile, type UploadTrackedFileContext } from './upload-tracked-file'

const file = new File(['%PDF'], 'Brandschutzkonzept.pdf', { type: 'application/pdf' })

function context(shelf: UploadTrackedFileContext['shelf'], asNorm?: boolean): UploadTrackedFileContext {
  return {
    shelf,
    uploadUrl: '/api/documents/upload',
    targetCollection: 'archiv_org-1',
    projectId: shelf === 'project' ? 'project-1' : undefined,
    conversationProjectId: null,
    batchId: null,
    resolvedFolderId: () => null,
    revisionOfFile: () => null,
    onConflictOf: () => null,
    asksAboutConflicts: false,
    ...(asNorm === undefined ? {} : { asNorm }),
    screeningReleased: () => false,
    abortControllers: new Map(),
    failureCopy: {} as UploadTrackedFileContext['failureCopy'],
    outcome: { unchangedCount: 0, uploadedTypes: [], serverStopped: [], heldReplaced: [], nameConflicts: [] },
    updateTrackedFile: vi.fn(),
    setUploadProgress: vi.fn(),
    removeRecentlyDeletedIds: vi.fn(),
    dismissTrackedFiles: vi.fn(),
  }
}

const upload = (shelf: UploadTrackedFileContext['shelf'], asNorm?: boolean) =>
  uploadTrackedFile({ file, tracked: { id: 'tracked-1' } as TrackedFile }, context(shelf, asNorm))

beforeEach(() => {
  sent.bodies = []
  sent.refusal = null
})

describe('the upload request', () => {
  it('says an upload made under the norms is a norm candidate', async () => {
    await upload('office_shelf', true)
    expect(sent.bodies[0].get('asNorm')).toBe('true')
    expect(sent.bodies[0].get('scope')).toBe('office_shelf')
  })

  it('says nothing of it for an Ordner upload or a project', async () => {
    await upload('office_shelf')
    await upload('project', true)
    expect(sent.bodies.map((body) => body.get('asNorm'))).toEqual([null, null])
  })
})

describe('an upload to Meine Ablage (ADR-0193)', () => {
  it('names the personal shelf and no project, and never a norm', async () => {
    await upload('personal', true)
    expect(sent.bodies[0].get('scope')).toBe('personal')
    expect(sent.bodies[0].get('projectId')).toBeNull()
    expect(sent.bodies[0].get('asNorm')).toBeNull()
  })
})

describe('a name the target folder already holds', () => {
  const conflict = {
    reason: 'name_conflict',
    name: 'Brandschutzkonzept.pdf',
    folderId: 'f-1',
    existingDocumentId: 'doc-held',
    existingName: 'Brandschutzkonzept.pdf',
    suggestedName: 'Brandschutzkonzept 2.pdf',
  }

  it('sends the answer the reader gave for it, and none on a shelf without folders', async () => {
    const keepBoth = { ...context('project'), onConflictOf: () => 'keep_both' as const }
    await uploadTrackedFile({ file, tracked: { id: 't-1' } as TrackedFile }, keepBoth)
    await uploadTrackedFile({ file, tracked: { id: 't-2' } as TrackedFile }, { ...context('session'), onConflictOf: () => 'replace' as const })
    await upload('project')
    expect(sent.bodies.map((body) => body.get('onConflict'))).toEqual(['keep_both', null, null])
  })

  it('hands the refusal back to be asked about, when the caller asks, and drops the row', async () => {
    sent.refusal = { status: 409, body: { error: 'taken', code: 'CONFLICT', details: conflict } }
    const asking = { ...context('project'), asksAboutConflicts: true }
    await uploadTrackedFile({ file, tracked: { id: 't-1' } as TrackedFile }, asking)

    expect(asking.outcome.nameConflicts).toEqual([{ file, conflict }])
    expect(asking.dismissTrackedFiles).toHaveBeenCalledWith(['t-1'])
    expect(asking.updateTrackedFile).not.toHaveBeenCalledWith('t-1', expect.objectContaining({ status: 'failed' }))
  })

  it('fails the row in words, never as a silent replacement, when nobody can be asked', async () => {
    sent.refusal = { status: 409, body: { error: 'taken', code: 'CONFLICT', details: conflict } }
    const quiet = { ...context('project'), failureCopy: { nameConflict: (name: string) => `taken: ${name}` } as UploadTrackedFileContext['failureCopy'] }
    await expect(uploadTrackedFile({ file, tracked: { id: 't-1' } as TrackedFile }, quiet)).rejects.toThrow('taken: Brandschutzkonzept.pdf')
    expect(quiet.updateTrackedFile).toHaveBeenCalledWith('t-1', expect.objectContaining({ status: 'failed', retryable: false }))
  })
})
