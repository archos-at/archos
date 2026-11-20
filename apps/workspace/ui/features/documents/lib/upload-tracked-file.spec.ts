import { beforeEach, describe, expect, it, vi } from 'vitest'

const sent = vi.hoisted(() => ({ bodies: [] as FormData[] }))
vi.mock('@/lib/http/xhr-upload', () => ({
  XhrUploadError: class extends Error {},
  xhrUpload: vi.fn(async ({ body }: { body: FormData }) => {
    sent.bodies.push(body)
    return JSON.stringify({ documentId: 'doc-1', status: 'stored' })
  }),
}))

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
    ...(asNorm === undefined ? {} : { asNorm }),
    screeningReleased: () => false,
    abortControllers: new Map(),
    failureCopy: {} as UploadTrackedFileContext['failureCopy'],
    outcome: { unchangedCount: 0, uploadedTypes: [], serverStopped: [], heldReplaced: [] },
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
