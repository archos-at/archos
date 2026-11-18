import type { BimModelSummary } from '@/lib/bim/types'

export interface BimModelHeaderView {
  id: string
  documentId: string
  projectId: string | null
  filename: string
  displayName: string | null
  status: 'pending' | 'extracting' | 'ready' | 'failed'
  schemaVersion: string | null
  elementCount: number
  errorMessage: string | null
  summary: BimModelSummary | null
  updatedAt: string
}
