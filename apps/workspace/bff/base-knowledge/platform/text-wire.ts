import { z } from 'zod'
import type { ChangeRequestStatus } from '@/lib/base-knowledge/wire/vocab'
import { countryIdSchema, sourceIdSchema } from './wire'

const MANIFESTATION_KEY = 'The manifestation the text belongs to, proposed in this draft with platform-knowledge-records-propose.'

const manifestationKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9._-]{0,99}$/, 'the key of a manifestation proposed in this change request')

export const corpusFileNameSchema = z
  .string()
  .trim()
  .regex(/^[^/\\]{1,200}\.pdf$/, 'a PDF file name without a path, e.g. "oib-rl-1-2019.pdf"')

export const textFileName = (manifestationKey: string, sha256: string): string => `${manifestationKey}-${sha256.slice(0, 12)}.pdf`

export const importTextBodySchema = z.object({
  manifestationKey: manifestationKeySchema.describe(MANIFESTATION_KEY),
  sourceId: sourceIdSchema.describe('The configured public source whose hosts the PDF is on, e.g. "at-oib".'),
  url: z.url().max(2000).describe('The PDF; fetched and read by the public-source fetcher, GET only.'),
})
export type ImportTextBody = z.infer<typeof importTextBodySchema>

export const uploadTextFields = { manifestationKey: manifestationKeySchema.describe(MANIFESTATION_KEY) }
export const uploadTextFieldsSchema = z.object(uploadTextFields)

export interface AttachedTextView {
  revisionId: string
  recordId: string
  editionId: string
  corpusFile: string
  origin: 'upload' | 'url' | null
  sha256: string | null
  bytes: number | null
  pages: number | null
  sourceId: string | null
  sourceOrigin: 'built_in' | 'released' | 'draft' | null
  countsAsFetched: boolean
  url: string | null
  attachedBy: string | null
  attachedAt: string | null
}

export interface AttachTextResult {
  text: AttachedTextView
  status: 'written' | 'unchanged'
  stored: boolean
}

export interface TextPlacementView {
  corpusFile: string
  countryId: string
  recordId: string
  editionId: string
  editionLabel: string | null
  workTitle: string | null
  released: boolean
  changeRequestId: string | null
  changeRequestTitle: string | null
  changeRequestStatus: ChangeRequestStatus | null
}

export interface TextPlacementList {
  texts: TextPlacementView[]
  nextCursor: string | null
}

export const TEXT_PLACEMENT_PAGE = 200
export const MAX_TEXT_PLACEMENT_PAGE = 500

export const listTextsQuerySchema = z.object({
  countryId: countryIdSchema.optional().describe('Only the files of this country’s records.'),
  limit: z.coerce.number().int().min(1).max(MAX_TEXT_PLACEMENT_PAGE).optional(),
  cursor: z.string().min(1).max(260).optional().describe('nextCursor of the previous page.'),
})
export type ListTextsQuery = z.infer<typeof listTextsQuerySchema>
