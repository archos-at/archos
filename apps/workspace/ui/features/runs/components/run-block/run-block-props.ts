import type { RunLedger, RunLedgerDoc } from '@/lib/runs/run-ledger-types'

export interface RunBlockReview {
  decision: 'accepted' | 'rejected'
  by?: string | null
  reason?: string | null
}

export interface RunBlockProps {
  ledger: RunLedger
  title?: string | null
  projectId?: string | null
  filesToProject?: boolean
  review?: RunBlockReview | null
  live?: boolean
  connection?: 'live' | 'reconnecting' | 'lost' | null
  defaultOpen?: boolean
  onAnswer?: () => void
  onRetry?: () => void
  onCancel?: (() => void | Promise<void>) | null
  onWriteNow?: (() => void | Promise<void>) | null
  onAddDocument?: (() => void) | null
  addDocumentFailure?: string | null
  onOpenDocument?: ((doc: RunLedgerDoc) => void) | null
  onContinue?: (() => void | Promise<void>) | null
  reviewHref?: string | null
  reportHref?: string | null
  className?: string
}
