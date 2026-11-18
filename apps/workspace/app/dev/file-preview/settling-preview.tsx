import type { JSX } from 'react'
import { useEffect } from 'react'
import type { FileItem } from '@/features/documents/components/project-file-workspace'
import { FilePreviewHost } from '@/features/documents/components/file-preview-host'
import { useFilePreviewStore } from '@/features/documents/stores/file-preview-store'
import { FIXTURE } from './fixtures'

export const SETTLING_FIXTURE: FileItem = {
  ...FIXTURE,
  id: 'dev-doc-settling',
  status: 'processing',
  summary: null,
  pageCount: null,
  chunkCount: null,
  contentTypes: null,
  tags: null,
  assignees: [],
}

export let settlingReads = 0

export function settlingStatus(): Record<string, unknown> {
  settlingReads += 1
  const base = { id: SETTLING_FIXTURE.id, filename: SETTLING_FIXTURE.filename, versionCount: 1 }
  if (settlingReads <= 2) return { ...base, status: 'processing' }
  if (settlingReads === 3) return { ...base, status: 'completed', summary: null }
  return {
    ...base,
    status: 'completed',
    summary: FIXTURE.summary,
    pageCount: FIXTURE.pageCount,
    chunkCount: FIXTURE.chunkCount,
    contentTypes: FIXTURE.contentTypes,
    tags: FIXTURE.tags,
  }
}

export function SettlingPreview(): JSX.Element {
  useEffect(() => {
    settlingReads = 0
    useFilePreviewStore.getState().open(SETTLING_FIXTURE, 'modal', { projectId: 'proj-demo' })
  }, [])
  return <FilePreviewHost />
}
