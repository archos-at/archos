import type { ProjectLifecycleView, ProjectStatus } from '@/lib/projects/project-status'
import type { ProjectProfile } from '@/lib/project-profile/types'

export interface OverviewDocument {
  id: string
  filename: string
  fileSize: number | null
  contentType: string | null
  status: string | null
  createdAt: Date
}

export interface ProjectOverviewData {
  id: string
  name: string
  collectionName: string
  status: ProjectStatus
  lifecycle: ProjectLifecycleView
  createdAt: string
  profileDisplay: {
    title?: string
    summary?: string
    summaryLocale?: string
    keyFacts?: Array<{ label: string; value: string }>
    missingInfo?: string[]
  } | null
  profile: ProjectProfile | null
  documentCount: number
  totalFileSize: number
  recentDocuments: OverviewDocument[]
}
