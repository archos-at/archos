import { renderHook } from '@testing-library/react'
import { useFileUpload } from './use-file-upload'

export const FILE_BYTES = 400_000

export const uploadOk = (documentId: string, jobId: string | null = 'job-1') =>
  JSON.stringify({ documentId, jobId, status: 'pending' })

export const makeFiles = (count: number) =>
  Array.from({ length: count }, (_, i) => new File(['x'.repeat(FILE_BYTES)], `plan-${i}.pdf`, { type: 'application/pdf' }))

export const renderUpload = (options: Record<string, unknown> = {}) =>
  renderHook(() => useFileUpload({ collectionName: 'proj-collection', projectId: 'proj-1', ...options }))

export const CHAT = 's_11111111_2222_4333_8444_555555555555'

export const makeFile = () => new File(['x'.repeat(1000)], 'plan.pdf', { type: 'application/pdf' })
