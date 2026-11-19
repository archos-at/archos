import { capturePosthog } from '@/lib/analytics/posthog'
import type { SettleProposalsBody, SettleProposalsResult } from '@/lib/base-knowledge/wire'

export type NormDialogSource = 'office_shelf_upload' | 'folder_migration' | 'review_pending' | 'project_upload' | 'postfach_suggestion'

export interface NormDialogCounts {
  confirmed: number
  not_norm: number
  later: number
  edition_added: number
  duplicate_removed: number
}

const NONE: NormDialogCounts = { confirmed: 0, not_norm: 0, later: 0, edition_added: 0, duplicate_removed: 0 }

const OUTCOME_COUNT: Record<SettleProposalsResult['results'][number]['outcome'], keyof NormDialogCounts | null> = {
  confirmed: 'confirmed',
  not_norm: 'not_norm',
  edition_added: 'edition_added',
  duplicate_removed: 'duplicate_removed',
  edition_missing: 'later',
  failed: null,
}

export function normDialogShown(source: NormDialogSource, rows: number): void {
  capturePosthog('norm_dialog_shown', { rows, source })
}

export function normDialogSettled(source: NormDialogSource, counts: Partial<NormDialogCounts>): void {
  capturePosthog('norm_dialog_settled', { ...NONE, ...counts, source })
}

export function countsOfResults(results: SettleProposalsResult['results']): NormDialogCounts {
  const counts = { ...NONE }
  for (const { outcome } of results) {
    const key = OUTCOME_COUNT[outcome]
    if (key) counts[key] += 1
  }
  return counts
}

export function countsOfRows(rows: readonly SettleProposalsBody['rows'][number][]): Partial<NormDialogCounts> {
  const notNorm = rows.filter((row) => row.notNorm).length
  return { confirmed: rows.length - notNorm, not_norm: notNorm }
}
