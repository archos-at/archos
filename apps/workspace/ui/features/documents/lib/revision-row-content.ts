import type { RevisionLinks } from '@/lib/documents/revision-links'
import { isPendingVersion, type TimelineRow } from '@/lib/documents/revision-timeline'

export function rowChange(row: TimelineRow, summary: RevisionLinks['changeSummary']): string | null {
  if (row.kind === 'linked') return row.entry.changeSummary
  if (row.kind === 'head' || (row.kind === 'version' && row.newest)) return summary?.text ?? null
  return null
}

export function rowHasContent(row: TimelineRow, hasChange: boolean): boolean {
  if (row.kind === 'version') {
    return isPendingVersion(row.version) || Boolean(row.version.reviewComment) || (row.newest && hasChange)
  }
  if (row.kind === 'head') return hasChange
  return true
}
