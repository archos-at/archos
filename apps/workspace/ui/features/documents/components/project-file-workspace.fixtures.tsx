import { type ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import { FilePreviewHost } from './file-preview-host'
import { useFilePreviewStore } from '../stores/file-preview-store'
import type { DocumentWireRow } from '../lib/file-item'

export const existing: DocumentWireRow = {
  id: 'doc-eg',
  filename: 'EG.pdf',
  displayName: null,
  fileSize: 10,
  contentType: 'application/pdf',
  status: 'ready',
  folderId: null,
  createdAt: '2026-06-14T09:00:00.000Z',
  errorMessage: null,
  summary: null,
  pageCount: null,
  chunkCount: null,
  contentTypes: null,
  tags: null,
  assignees: [],
  authoredBy: 'user' as const,
}

export function renderWorkspace(ui: ReactElement) {
  return render(
    <>
      {ui}
      <FilePreviewHost />
    </>,
  )
}

export function findFileButton(name: RegExp) {
  return screen.findByRole('button', {
    name: (accessibleName) => name.test(accessibleName) && !/file actions/i.test(accessibleName),
  })
}

export function resetPreviewStore() {
  useFilePreviewStore.setState({
    file: null,
    mode: 'modal',
    hidden: false,
    peekWidth: 320,
    context: {},
  })
}

export function makeDataTransfer(files: File[]) {
  return {
    items: files.map((f) => ({ kind: 'file', type: f.type })),
    files,
    types: ['Files'],
  }
}
