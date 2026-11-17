'use client'

import { File, FileText, Image as ImageIcon, type LucideIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { documentStatusFacts, type DocumentStatusVariant } from '@/lib/documents/document-status'
import {
  surfaceStateLabel,
  surfaceStateOf,
  surfaceStateVariant,
  type SurfaceState,
} from '@/lib/documents/surface-state'
import { useTranslations } from '@/i18n'
import type { Translator } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { cn } from '@/lib/utils'
import { IngestionGlyph } from './ingestion-atoms'

export function fileTypeIcon(contentType: string | null | undefined, filename?: string): LucideIcon {
  const type = (contentType ?? '').toLowerCase()
  const name = (filename ?? '').toLowerCase()
  if (type.startsWith('image/')) return ImageIcon
  if (
    type === 'application/pdf' ||
    type.startsWith('text/') ||
    type.includes('word') ||
    /\.(pdf|docx?|txt|md)$/.test(name)
  ) {
    return FileText
  }
  return File
}

export type StatusVariant = DocumentStatusVariant

export function documentStatusVariant(status: string | null | undefined): StatusVariant {
  return surfaceStateVariant(surfaceStateOf(status))
}

export function isSettlingStatus(status: string | null | undefined): boolean {
  return documentStatusFacts(status)?.phase === 'in-flight'
}

export function isCitableStatus(status: string | null | undefined): boolean {
  return documentStatusFacts(status)?.variant === 'success'
}

export function isFailedStatus(status: string | null | undefined): boolean {
  return documentStatusFacts(status)?.variant === 'destructive'
}

export function failedWithPreviousVersion(file: {
  status?: string | null
  versionCount?: number | null
}): boolean {
  return isFailedStatus(file.status) && (file.versionCount ?? 0) > 1
}

export function isNeverIndexed(file: { status?: string | null }): boolean {
  return isNeverIndexedStatus(file.status)
}

export function isHeldStatus(status: string | null | undefined): boolean {
  return surfaceStateOf(status) === 'held'
}

export function isCitable(file: { status?: string | null }): boolean {
  return isCitableStatus(file.status)
}

export function isNeverIndexedStatus(status: string | null | undefined): boolean {
  const facts = documentStatusFacts(status)
  return facts !== null && facts.variant === 'secondary' && facts.phase === 'terminal'
}

function labelOfState(state: SurfaceState, status: string | null | undefined, t: Translator): string {
  if (state === 'unknown' && status) console.warn(`[document-status] Undeclared status "${status}", rendering as unknown`)
  return surfaceStateLabel(state, t)
}

export function documentStatusLabel(status: string | null | undefined, t: Translator): string {
  return labelOfState(surfaceStateOf(status), status, t)
}

interface DocumentStatusBadgeProps {
  status: string | null | undefined
  className?: string
  title?: string
  queueAhead?: number | null
}

export function DocumentStatusBadge({ status, className, title, queueAhead }: DocumentStatusBadgeProps) {
  const t = useTranslations(filesCopy)
  const state = surfaceStateOf(status)
  const variant = surfaceStateVariant(state)
  const waiting = queueAhead != null && queueAhead > 0 && documentStatusFacts(status)?.phase === 'in-flight'
  const label = waiting ? t('status.queuedAhead', { count: queueAhead }) : labelOfState(state, status, t)
  return (
    <Badge
      variant={variant === 'destructive' ? 'danger' : variant === 'info' ? 'secondary' : variant}
      data-variant={variant}
      className={cn('shrink-0', className)}
      title={title ?? label}
    >
      {/* Icon + word: the glyph is what tells „Wartet" from „Wird gelesen"
          and „Abgelegt" from „Unbekannt" (each pair one grey). */}
      <IngestionGlyph mark={waiting ? 'queued' : state} />
      {/* The word gives way, the glyph never does. A caller that caps the
          badge (the Files list's status column) gets an ellipsis at the end
          of the word; the badge's own centring clipped „Wartet · 3 Dateien
          davor" at both edges. */}
      <span className="min-w-0 truncate">{label}</span>
    </Badge>
  )
}
