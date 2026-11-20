/**
 * @vitest-environment node
 *
 * Each uploaded file says whether its name reads as a norm, with the office's
 * standards switched on: `norm_recognized_at_upload`, the bet's first number.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user-1',
    organizationId: 'org-1',
    email: 'test@grid.com',
    role: 'admin',
    permissions: [],
    featureFlags: ['office-standards'],
  }),
}))
vi.mock('@/lib/authz/feature-flags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/authz/feature-flags')>()),
  isOfficeStandardsEnabled: vi.fn(() => true),
}))
vi.mock('@/lib/analytics/posthog-server', () => ({ captureServer: vi.fn() }))
vi.mock('@/lib/base-knowledge/office/norm-intake', () => ({ uploadToOfficeShelf: vi.fn() }))
vi.mock('@/lib/documents/document-dispatch', () => ({ uploadDocument: vi.fn() }))

import { captureServer } from '@/lib/analytics/posthog-server'
import { isOfficeStandardsEnabled } from '@/lib/authz/feature-flags'
import { uploadToOfficeShelf } from '@/lib/base-knowledge/office/norm-intake'
import { uploadDocument } from '@/lib/documents/document-dispatch'
import { POST } from './route'

const BATCH = '7d1f3c1e-0d3a-4d2e-9a53-6d1f9d6c2b11'
const OLDER = '0b8f3c1e-0d3a-4d2e-9a53-6d1f9d6c2b11'

const post = (fileName: string, query: string, fields: Record<string, string> = {}) => {
  const form = new FormData()
  form.set('file', new File(['x'], fileName, { type: 'application/pdf' }))
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  return POST(new NextRequest(`https://grid.test/api/documents/upload${query}`, { method: 'POST', body: form }), {
    params: Promise.resolve({}),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isOfficeStandardsEnabled).mockReturnValue(true)
  const stored = { documentId: 'd1', jobId: null, status: 'uploaded' as const, filename: 'x.pdf' }
  vi.mocked(uploadToOfficeShelf).mockResolvedValue(stored)
  vi.mocked(uploadDocument).mockResolvedValue(stored)
})

describe('POST /api/documents/upload — the norm reading of each file', () => {
  it('counts a file of the Büroablage whose name reads as a norm, in its upload batch', async () => {
    expect((await post('OENORM_B_1600_2017-04-15.pdf', '?scope=office_shelf', { uploadBatchId: BATCH })).status).toBe(200)

    expect(captureServer).toHaveBeenCalledWith({
      event: 'norm_recognized_at_upload',
      distinctId: 'user-1',
      organizationId: 'org-1',
      properties: { shelf: 'office_shelf', recognized: 1, plain: 0, upload_id: BATCH },
    })
  })

  it('counts a plain file of a project as plain', async () => {
    await post('Grundriss_EG.pdf', '', { projectId: 'proj-1' })

    expect(captureServer).toHaveBeenCalledWith(
      expect.objectContaining({ properties: { shelf: 'project', recognized: 0, plain: 1, upload_id: undefined } }),
    )
  })

  it('sends nothing for a new Fassung, or for an office without its own standards', async () => {
    await post('OENORM_B_1600.pdf', '', { projectId: 'proj-1', revisionOf: OLDER })
    vi.mocked(isOfficeStandardsEnabled).mockReturnValue(false)
    await post('OENORM_B_1600.pdf', '?scope=office_shelf')

    expect(captureServer).not.toHaveBeenCalled()
  })
})
