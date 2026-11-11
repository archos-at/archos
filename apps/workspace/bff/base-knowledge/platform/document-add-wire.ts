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
    kind: z.enum(KNOWLEDGE_WORK_KINDS).describe('What the work is: a statute, an ordinance, a model code, a guideline, a commentary (explanatory notes) and so on.'),
  }),
])

const documentFields = {
  work: documentWorkSchema,
  label: z.string().trim().min(1).max(120).describe('The edition as the document prints it, e.g. its date or year; the document must print it.'),
  inForceFrom: isoDate.nullable().default(null).describe('The day this edition applies from.'),
  licenceClass: z.enum(['public_open', 'public_restricted']).default('public_open'),
}

export const addDocumentBodySchema = z.object({
  url: z.url().max(2000).describe('The PDF at its publisher, on a host of one of this country’s sources: the platform fetches it itself, so its origin is proven.'),
  ...documentFields,
})
export type AddDocumentBody = z.infer<typeof addDocumentBodySchema>

/** The upload's text fields; `work` travels as JSON in a form field. */
export const uploadDocumentFields = {
  work: z.string().min(2).max(2000).describe('The work as JSON: {"workKey"} or {"title","designation","kind"}.'),
  label: documentFields.label,
  inForceFrom: z.string().optional().describe('The day this edition applies from, YYYY-MM-DD.'),
  publishedAt: z.url().max(2000).describe('Where the publisher publishes the document, for the reviewer to check the file against.'),
  titleText: z
    .string()
    .min(15)
    .max(20000)
    .describe('The document’s title lines copied from the PDF, naming the work and the edition: what the records quote, checked by the reviewer.'),
}
export const uploadDocumentFieldsSchema = z.object({
  work: z.string().transform((value, ctx) => {
    try {
      return documentWorkSchema.parse(JSON.parse(value))
    } catch {
      ctx.addIssue({ code: 'custom', message: 'work is {"workKey"} or {"title","designation","kind"}' })
      return z.NEVER
    }
  }),
  label: documentFields.label,
  inForceFrom: z.preprocess((value) => (value === '' ? null : value), isoDate.nullable().default(null)),
  publishedAt: uploadDocumentFields.publishedAt,
  titleText: uploadDocumentFields.titleText,
})
export type UploadDocumentFields = z.infer<typeof uploadDocumentFieldsSchema>

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

/**
 * The fewest words of `text` around where it prints `label`, long enough to be a quote (KC-6): what a record
 * cites to say the document names it. Null when the text does not print it.
 */
export function quoteNaming(text: string, label: string): string | null {
  const needle = normalizeForQuote(label)
  if (!needle || !normalizeForQuote(text).includes(needle)) return null
  const words = text.split(/\s+/).filter(Boolean)
  const span = needle.split(' ').length
  for (let start = 0; start < words.length; start += 1) {
    const window = words.slice(start, start + span + 1).join(' ')
    if (!normalizeForQuote(window).includes(needle)) continue
    for (let pad = 0; pad <= 3; pad += 1) {
      const quote = words.slice(Math.max(0, start - pad), start + span + 1 + pad).join(' ')
      if (normalizeForQuote(quote).includes(needle) && quoteFound(quote, text)) return quote
    }
  }
  return null
}

/** What the platform can tell from a file name or URL before anything is read: the work it names and the edition's year or date. */
export function guessFromName(name: string, works: readonly CountryWorkView[]): { workKey: string | null; label: string | null; title: string } {
  const stem = decodeURIComponent(name.split(/[?#]/)[0].split('/').pop() ?? '').replace(/\.pdf$/i, '')
  const slug = keyPart(stem, 200)
  const date = /(\d{4}-\d{2}-\d{2})/.exec(stem)?.[1] ?? null
  const year = /(?:^|\D)((?:19|20)\d{2})(?:\D|$)/.exec(stem)?.[1] ?? null
  const named = works
    .map((work) => ({ work, part: keyPart(work.designation ?? work.title, 200) }))
    .filter(({ part }) => part.length > 0 && slug.includes(part))
    .sort((a, b) => b.part.length - a.part.length)[0]
  return { workKey: named?.work.workKey ?? null, label: date ?? year, title: stem.replace(/[_-]+/g, ' ').trim() }
}
