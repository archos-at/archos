import { deleteSessionDocument } from '@/adapters/api/session-documents-client'

const DELETE_ROUTE: Record<'project' | 'office_shelf', (id: string) => string> = {
  project: (id) => `/api/documents/${encodeURIComponent(id)}`,
  office_shelf: (id) => `/api/documents/${encodeURIComponent(id)}`,
}

export async function deleteShelfDocument(
  shelf: 'project' | 'office_shelf' | 'session',
  documentId: string
): Promise<void> {
  if (shelf === 'session') return deleteSessionDocument(documentId)
  const response = await fetch(DELETE_ROUTE[shelf](documentId), { method: 'DELETE' })
  if (response.ok || response.status === 404) return
  const body: unknown = await response.json().catch(() => null)
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message
  throw new Error(typeof message === 'string' && message ? message : `Delete failed: ${response.status}`)
}
