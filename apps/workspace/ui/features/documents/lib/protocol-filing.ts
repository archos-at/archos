import { isNameTakenBody } from '@/lib/documents/name-taken'
import { splitDocumentName } from '@/lib/documents/display-name'
import { protocolFileNameOf, safeFileStem, type AnnotationExportFormat } from '@/lib/annotations/export-request'
import { calendarDayIn, OFFICE_TIME_ZONE } from '@/lib/format'

export interface ProtocolFilingTarget {
  projectId: string
  folderId: string | null
}

export interface FiledProtocol {
  documentId: string
  filename: string
  unchanged: boolean
}

export class ProtocolFilingError extends Error {
  constructor(readonly reason: 'export' | 'name-taken' | 'upload') {
    super(`Filing the Protokoll failed: ${reason}`)
    this.name = 'ProtocolFilingError'
  }
}

export function protocolFilingStem(
  template: (values: { name: string; date: string }) => string,
  name: string,
  now: Date = new Date()
): string {
  return safeFileStem(template({ name, date: calendarDayIn(OFFICE_TIME_ZONE, now) }))
}

export const documentStem = (documentName: string): string => splitDocumentName(documentName).stem

export type ProtocolExportHref = (format: AnnotationExportFormat) => string

async function exportFor(href: ProtocolExportHref) {
  const first = await fetch(href('pdf'))
  if (first.status !== 422) return { response: first, format: 'pdf' as const }
  return { response: await fetch(href('docx')), format: 'docx' as const }
}

export async function fileProtocol(
  href: ProtocolExportHref,
  target: ProtocolFilingTarget,
  stem: string
): Promise<FiledProtocol> {
  const { response: exported, format } = await exportFor(href)
  if (!exported.ok) throw new ProtocolFilingError('export')
  const blob = await exported.blob()
  const filename = protocolFileNameOf(stem, format)
  const form = new FormData()
  form.append('file', new File([blob], filename, { type: blob.type || exported.headers.get('content-type') || '' }))
  form.append('projectId', target.projectId)
  if (target.folderId) form.append('folderId', target.folderId)
  const uploaded = await fetch('/api/documents/upload', { method: 'POST', body: form })
  const body: unknown = await uploaded.json().catch(() => null)
  if (!uploaded.ok) throw new ProtocolFilingError(isNameTakenBody(body) ? 'name-taken' : 'upload')
  const { documentId: filedId, unchanged } = (body ?? {}) as { documentId?: unknown; unchanged?: unknown }
  if (typeof filedId !== 'string' || !filedId) throw new ProtocolFilingError('upload')
  return { documentId: filedId, filename, unchanged: unchanged === true }
}
