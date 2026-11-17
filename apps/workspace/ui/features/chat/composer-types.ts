import type { DocumentVersionState } from '@/lib/documents/lifecycle-types'
import type { DraftMention } from '@/lib/mentions/mention-text'

export interface ComposerSubject {
  resourceType: 'document'
  resourceId: string
  title?: string | null
  filename?: string | null
  shelf?: 'project' | 'office_shelf' | 'session'
  versionId?: string | null
  versionState?: DocumentVersionState | null
}

export interface ComposerPrefill {
  text: string
  mentions?: DraftMention[]
  subject?: ComposerSubject
}
