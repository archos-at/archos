/**
 * The wire of a platform text (ADR-0165, "Texts are attached in the request"):
 * the file an edition's manifestation points to, attached inside the draft
 * change request that proposes it, and where each base-corpus file belongs.
 * Pure zod, shared by the routes, the agent operations and the UI.
 */

import { z } from 'zod'
import type { ChangeRequestStatus } from '@/lib/base-knowledge/wire/vocab'
import { countryIdSchema, sourceIdSchema } from './wire'

const MANIFESTATION_KEY = 'The manifestation the text belongs to, proposed in this draft with platform-knowledge-records-propose.'

/** A manifestation's key in the draft, as it was proposed. */
const manifestationKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9._-]{0,99}$/, 'the key of a manifestation proposed in this change request')

/** A base-corpus file name: a PDF's base name, as `manifestation.corpusFile` takes it. */
export const corpusFileNameSchema = z
  .string()
  .trim()
  .regex(/^[^/\\]{1,200}\.pdf$/, 'a PDF file name without a path, e.g. "oib-rl-1-2019.pdf"')

export const importTextBodySchema = z.object({
  manifestationKey: manifestationKeySchema.describe(MANIFESTATION_KEY),
  sourceId: sourceIdSchema.describe('The configured public source whose hosts the PDF is on, e.g. "at-oib".'),
  url: z.url().max(2000).describe('The PDF; fetched and read by the public-source fetcher, GET only.'),
  fileName: corpusFileNameSchema
    .optional()
    .describe('The name the base corpus keeps it under; by default "<manifestationKey>.pdf". A text that replaces a released one takes a new name.'),
})
export type ImportTextBody = z.infer<typeof importTextBodySchema>

/** The text fields of the multipart upload, beside its `file` part. */
export const uploadTextFields = { manifestationKey: manifestationKeySchema.describe(MANIFESTATION_KEY) }
export const uploadTextFieldsSchema = z.object(uploadTextFields)

/** The text of one manifestation of a change request, as a reviewer reads it beside the edition. */
export interface AttachedTextView {
  revisionId: string
  recordId: string
  editionId: string
  /** The base-corpus file the manifestation names. */
  corpusFile: string
  /** upload or url when it was attached in this request; null when the record only names a file the corpus already held. */
  origin: 'upload' | 'url' | null
  sha256: string | null
  bytes: number | null
  pages: number | null
  sourceId: string | null
  url: string | null
  attachedBy: string | null
  attachedAt: string | null
}

/** What attaching a text answers: the manifestation's revision and the file it now names. */
export interface AttachTextResult {
  text: AttachedTextView
  /** written: the manifestation got a revision naming the file; unchanged: it named these bytes already. */
  status: 'written' | 'unchanged'
  /** Whether the bytes were stored now; false when the base corpus already kept them under this name. */
  stored: boolean
}

/** Where one base-corpus file belongs: the record that names it, its country, edition and change request. */
export interface TextPlacementView {
  corpusFile: string
  countryId: string
  recordId: string
  editionId: string
  editionLabel: string | null
  workTitle: string | null
  /** Whether a released manifestation names the file: the country's entitled offices read it. */
  released: boolean
  changeRequestId: string | null
  changeRequestTitle: string | null
  changeRequestStatus: ChangeRequestStatus | null
}

export interface TextPlacementList {
  /** This page, by file name. */
  texts: TextPlacementView[]
  /** Pass as `cursor` for the next page; null on the last. */
  nextCursor: string | null
}

/** A page of placements: the default and the most one call returns. */
export const TEXT_PLACEMENT_PAGE = 200
export const MAX_TEXT_PLACEMENT_PAGE = 500

export const listTextsQuerySchema = z.object({
  countryId: countryIdSchema.optional().describe('Only the files of this country’s records.'),
  limit: z.coerce.number().int().min(1).max(MAX_TEXT_PLACEMENT_PAGE).optional(),
  cursor: z.string().min(1).max(260).optional().describe('nextCursor of the previous page.'),
})
export type ListTextsQuery = z.infer<typeof listTextsQuerySchema>
