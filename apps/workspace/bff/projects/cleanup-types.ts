import type { CleanupCategory, RuleCandidate } from './cleanup-rules'

export interface CleanupProposalItem {
  documentId: string
  filename: string
  folderPath: string | null
  category: CleanupCategory
  aiReason: string | null
  rule: RuleCandidate['rule'] | null
}

export interface CleanupProposal {
  items: CleanupProposalItem[]
  considered: number
  aiUsed: boolean
  aiError: string | null
}

export const CLEANUP_PARTIALLY_UNDONE_REASON = 'cleanup-partially-undone'
