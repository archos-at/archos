'use client'

import type { DocumentAuthor } from '@/lib/db/schema/documents'
import { fileItemFromStatus } from './document-question'
import { openFilePeek } from './open-file-peek'

interface DocumentStatusRow {
  id: string
  filename: string
  displayName: string | null
  fileSize: number | null
  contentType: string | null
  status: string | null
  createdAt: string
  errorMessage: string | null
  summary: string | null
  pageCount: number | null
  chunkCount: number | null
  contentTypes: string[] | null
  tags: string[] | null
  authoredBy: DocumentAuthor | null
}

export interface FiledDocumentTarget {
  documentId: string
  projectId: string
  projectName?: string | null
  canCollaborate?: boolean
}

function statusRow(body: unknown): DocumentStatusRow | null {
  if (typeof body !== 'object' || body === null) return null
  const row: Record<string, unknown> = { ...body }
  const text = (key: string): string | null => (typeof row[key] === 'string' ? row[key] : null)
  const count = (key: string): number | null => (typeof row[key] === 'number' ? row[key] : null)
  const list = (key: string): string[] | null => {
    const value = row[key]
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value : null
  }
  const id = text('id')
  const filename = text('filename')
  if (!id || !filename) return null
  return {
    id,
    filename,
    displayName: text('displayName'),
    fileSize: count('fileSize'),
    contentType: text('contentType'),
    status: text('status'),
    createdAt: text('createdAt') ?? new Date().toISOString(),
    errorMessage: text('errorMessage'),
    summary: text('summary'),
    pageCount: count('pageCount'),
    chunkCount: count('chunkCount'),
    contentTypes: list('contentTypes'),
    tags: list('tags'),
    authoredBy: text('authoredBy') === 'agent' ? 'agent' : null,
  }
}

export async function openFiledDocument(target: FiledDocumentTarget): Promise<boolean> {
  let body: unknown = null
  try {
    const response = await fetch(`/api/documents/${encodeURIComponent(target.documentId)}/status`)
    if (!response.ok) return false
    body = await response.json()
  } catch (error) {
    console.debug('[documents] could not read the filed document', error)
    return false
  }
  const row = statusRow(body)
  if (!row) return false

  const file = fileItemFromStatus(row)
  openFilePeek({
    file: row.authoredBy === 'agent' ? { ...file, authoredBy: 'agent' } : file,
    source: 'project',
    projectId: target.projectId,
    projectName: target.projectName,
    canCollaborate: target.canCollaborate,
    bindComposerSubject: false,
  })
  return true
}
