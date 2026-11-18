import { z } from 'zod'
import type { DocumentTypeTag } from '@/lib/documents/tag-vocabulary'
import type { InboundMailSenderClass } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import type { FilingBasis } from '@/lib/proposals/types'

export type { FilingBasis }

export const MAX_JUDGED_DOCUMENTS = 60
export const MAX_JUDGED_FOLDERS = 300
export const MAX_JUDGED_CONVENTIONS = 80
export const MAX_FOLDER_DOC_TYPES = 3

export interface FilingFolderInput {
  path: string
  description: string | null
  docTypes: string[]
}

export interface FilingConventionInput {
  path: string
  description: string | null
  projects: number
  docTypes: string[]
}

export interface FilingDocumentInput {
  id: string
  file: string
  folder: string
  type: string | null
  tags: string[]
  summary: string | null
}

export type FilingPurpose = 'upload' | 'sort'

export interface FilingJudgementInput {
  basis: FilingBasis
  purpose?: FilingPurpose
  locale: string
  folders: FilingFolderInput[]
  conventions: FilingConventionInput[]
  documents: FilingDocumentInput[]
  trace: { batchId: string; projectId: string | null; shelf: 'project' | 'office_shelf' }
}

export const filingFitResponseSchema = z.object({
  moves: z
    .array(
      z.object({
        id: z.string(),
        folder: z.string(),
        reason: z.string(),
        new: z.boolean().optional(),
        description: z.string().nullish(),
        confidence: z.number().min(0).max(1).nullish(),
        type: z.string().nullish(),
      })
    )
    .default([]),
  model: z.string().nullish(),
  error: z.string().nullish(),
  trace_id: z.string().nullish(),
})

export interface FilingMove {
  documentId: string
  folder: string
  reason: string
  newFolder: { description: string | null } | null
  confidence: number | null
}

export interface FilingJudgement {
  moves: FilingMove[]
  traceId: string | null
  error: string | null
}

export interface MailFilingInput {
  locale: string
  folders: FilingFolderInput[]
  conventions: FilingConventionInput[]
  attachments: Array<{ id: string; file: string }>
  mail: {
    subject: string | null
    senderDomain: string | null
    textId: string | null
  }
  trace: { mailId: string; projectId: string; senderClass: InboundMailSenderClass | null }
}

export interface MailPlacement {
  partId: string
  folder: string
  newFolder: { description: string | null } | null
  documentType: DocumentTypeTag | null
  reason: string
}

export interface MailFilingJudgement {
  placements: MailPlacement[]
  traceId: string | null
  error: string | null
}
