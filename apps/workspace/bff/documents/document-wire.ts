import { z } from 'zod'
import { MAX_DOCUMENT_NAME_LENGTH } from './display-name'
import { documentSummaryFilterSchema } from './list-query'
import { shelfSelectorFields } from './shelf-scope'
import { MAX_TAGS, MAX_TOPICS, MAX_TOPIC_LENGTH } from './tag-vocabulary'

export const renameDocumentSchema = z.object({
  displayName: z.string().max(MAX_DOCUMENT_NAME_LENGTH).nullable(),
})

export const moveDocumentSchema = z.object({
  folderId: z.guid().nullable(),
})

export const updateTagsSchema = z.object({
  tags: z.array(z.string().min(1).max(128)).max(MAX_TAGS),
  topics: z.array(z.string().min(1).max(MAX_TOPIC_LENGTH)).max(MAX_TOPICS).optional(),
})

export const revisionLinkSchema = z.object({
  older: z.guid(),
  linked: z.boolean(),
})

export const documentFileQuerySchema = z.object({
  versionId: z
    .string()
    .optional()
    .describe('A published or superseded version, from document-version-list.'),
  download: z.string().max(8).optional(),
})

export const documentDownloadQuerySchema = z.object({
  format: z
    .enum(['pdf'])
    .optional()
    .describe(
      'pdf: the PDF the product renders from an office document or a DXF drawing (a DXF at a standard scale), ' +
        'instead of the original file. A stored PDF is itself. 415 for any other file.'
    ),
})

export const documentSummaryQuerySchema = documentSummaryFilterSchema.extend(shelfSelectorFields)
