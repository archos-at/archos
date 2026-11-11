/**
 * The wire of adding one document to a country (Platform → a country → Works
 * and editions → "Add a document"): a PDF, from the publisher's URL or an
 * upload, becomes the text of an edition of a work of that country, inside the
 * country's open draft change request. Pure: the routes, the agent operations
 * and the dialog's prefill read it.
 */

import { z } from 'zod'
import { KNOWLEDGE_WORK_KINDS, type KnowledgeWorkKind } from '@/lib/base-knowledge/wire/vocab'
import { normalizeForQuote, quoteFound } from './quote'

const isoDate = z.iso.date()
const keySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9._-]{0,99}$/)

/** The work the document belongs to: one of the country's, by key, or a new one. */
export const documentWorkSchema = z.union([
  z.object({ workKey: keySchema.describe('A work of this country, from platform-knowledge-work-list.') }),
  z.object({
    title: z.string().trim().min(1).max(300).describe('The work’s title as the document prints it.'),
    designation: z.string().trim().min(1).max(120).nullable().default(null).describe('Its short designation as printed, e.g. a guideline’s number.'),
    kind: z
      .enum(KNOWLEDGE_WORK_KINDS)
      .describe('What the work is: a statute, an ordinance, a model code, a guideline, a commentary (explanatory notes) and so on.'),
  }),
])

const documentFields = {
  work: documentWorkSchema,
  label: z.string().trim().min(1).max(120).describe('The edition as the document prints it, e.g. its date or year; the document must print it.'),
  inForceFrom: isoDate.nullable().default(null).describe('The day this edition applies from.'),
  licenceClass: z.enum(['public_open', 'public_restricted']).default('public_open'),
}

export const addDocumentBodySchema = z.object({
  url: z
    .url()
    .max(2000)
    .describe('The PDF at its publisher, on a host of one of this country’s sources: the platform fetches it itself, so its origin is proven.'),
  ...documentFields,
})
export type AddDocumentBody = z.infer<typeof addDocumentBodySchema>

function parsedJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/** The upload's text fields as form parts: `work` travels as JSON, and an empty `inForceFrom` is none. */
export const uploadDocumentFields = {
  work: z
    .string()
    .max(2000)
    .transform((value, ctx) => {
      const work = documentWorkSchema.safeParse(parsedJson(value))
      if (work.success) return work.data
      ctx.addIssue({ code: 'custom', message: 'work is JSON: {"workKey"} or {"title","designation","kind"}' })
      return z.NEVER
    })
    .describe('The work as JSON: {"workKey"} or {"title","designation","kind"}.'),
  label: documentFields.label,
  inForceFrom: isoDate
    .or(z.literal(''))
    .optional()
    .transform((value) => value || null)
    .describe('The day this edition applies from, YYYY-MM-DD.'),
  publishedAt: z.url().max(2000).describe('Where the publisher publishes the document, for the reviewer to check the file against.'),
  titleText: z
    .string()
    .min(15)
    .max(20000)
    .describe(
      'The document’s title lines copied from the PDF, naming the work and the edition: what the records quote, checked by the reviewer against the file.'
    ),
}
export const uploadDocumentFieldsSchema = z.object(uploadDocumentFields)
export type UploadDocumentFields = z.infer<typeof uploadDocumentFieldsSchema>

export const listWorksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  cursor: keySchema.optional().describe('nextCursor of the previous page: the last workKey it held.'),
})
export type ListWorksQuery = z.infer<typeof listWorksQuerySchema>

/** One work of a country, as the dialog offers it, with its editions' labels. */
export interface CountryWorkView {
  workKey: string
  title: string
  designation: string | null
  kind: KnowledgeWorkKind
  editions: { editionKey: string; label: string }[]
}

/** Where the document went: the request, and the records it now holds. */
export interface AddDocumentResult {
  changeRequestId: string
  changeRequestTitle: string
  /** True when no draft of this country was open and one was opened for it. */
  opened: boolean
  workKey: string
  editionKey: string
  manifestationKey: string
  sha256: string
}

/** A key part from printed words: lower case, no accents, dashes between words. */
export function keyPart(text: string, max = 60): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, max)
    .replace(/[-.]+$/g, '')
}

/** Whether `text` prints `needle` as whole words: "2019" is not in "12019". Both normalized for the quote check. */
function printsWords(text: string, needle: string): boolean {
  const wordChar = /[\p{L}\p{N}]/u
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    if (!wordChar.test(text.charAt(at - 1)) && !wordChar.test(text.charAt(at + needle.length))) return true
  }
  return false
}

/**
 * The fewest words of `text` around where it prints `label`, long enough to be a quote (KC-6): what a record
 * cites to say the document names it. Null when the text does not print it as whole words.
 */
export function quoteNaming(text: string, label: string): string | null {
  const needle = normalizeForQuote(label)
  if (!needle || !printsWords(normalizeForQuote(text), needle)) return null
  const words = text.split(/\s+/).filter(Boolean)
  const span = needle.split(' ').length
  for (let start = 0; start < words.length; start += 1) {
    if (!printsWords(normalizeForQuote(words.slice(start, start + span + 1).join(' ')), needle)) continue
    for (let pad = 0; pad <= 3; pad += 1) {
      const quote = words.slice(Math.max(0, start - pad), start + span + 1 + pad).join(' ')
      if (quoteFound(quote, text)) return quote
    }
  }
  return null
}
