/**
 * The wire of a country's citation style (`citation_style.v1`, migration 0233,
 * country-as-data plan row 6): how its sources are cited, per language. The
 * interpreter is `@/shared/citation-style`; this is what a record may say.
 *
 * A template is a list of segments with `{field}` placeholders. A segment is
 * printed only when every field in it has a value, so `", {page}"` vanishes on a
 * source without a page. A segment without a field is always printed.
 *
 * Pure zod: the BFF and the browser both read it.
 */

import { z } from 'zod'
import fallbackStyles from '@/shared/citation-style.fallback.json'

const segment = z.string().min(1).max(200)
const template = z.array(segment).min(1).max(12)
const name = z.string().trim().min(1).max(200)
const tokens = z.array(z.string().trim().min(1).max(64)).max(20).default([])

/** The fields each template may name. */
const FIELDS = {
  line: ['title', 'edition', 'locus', 'page', 'publisher', 'place', 'container', 'note', 'accessed', 'url'],
  date: ['day', 'month', 'year'],
  bareLocus: ['locus'],
  page: ['page'],
  quote: ['quote', 'title', 'page'],
  edition: ['month', 'year'],
} as const

const languageStyleSchema = z
  .object({
    language: z.string().regex(/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?$/),
    /** First match wins: by authority, tint, lane prefix or origin. Anything else is a web page or a document. */
    kinds: z
      .array(
        z
          .object({
            match: z.object({ authorities: tokens, tints: tokens, lanePrefixes: tokens, origins: tokens }).strict(),
            type: z.enum(['standard', 'legislation']),
            publisher: name.optional(),
            place: name.optional(),
            container: name.optional(),
          })
          .strict()
      )
      .max(20),
    /** The word before an edition in a title ("Ausgabe Mai 2023"), its month names, and how the line names it. */
    edition: z
      .object({ word: name, label: template, months: z.record(z.string().min(1).max(20), z.number().int().min(1).max(12)) })
      .strict()
      .optional(),
    date: segment,
    /** A locus that is a bare number ("5.1.1"); any other names its own unit. */
    bareLocus: segment,
    page: segment,
    lines: z.object({ standard: template, legislation: template, webpage: template, report: template }).strict(),
    quote: template,
  })
  .strict()
  .superRefine((style, context) => {
    const templates: [string[], readonly string[], readonly string[]][] = [
      ...Object.entries(style.lines).map(([key, text]): [string[], string[], readonly string[]] => [['lines', key], text, FIELDS.line]),
      [['date'], [style.date], FIELDS.date],
      [['bareLocus'], [style.bareLocus], FIELDS.bareLocus],
      [['page'], [style.page], FIELDS.page],
      [['quote'], style.quote, FIELDS.quote],
      ...(style.edition ? [[['edition', 'label'], style.edition.label, FIELDS.edition] as [string[], string[], readonly string[]]] : []),
    ]
    for (const [path, segments, fields] of templates) {
      for (const text of segments) {
        const unknown = [...text.matchAll(/\{([^{}]*)\}/g)].find((match) => !fields.includes(match[1]))
        const problem = unknown
          ? `{${unknown[1]}} is not one of ${fields.map((field) => `{${field}}`).join(', ')}`
          : /[{}]/.test(text.replace(/\{[^{}]*\}/g, '')) && 'an unmatched { or }'
        if (problem) context.addIssue({ code: 'custom', path, message: problem })
      }
    }
  })
export type CitationStyle = z.infer<typeof languageStyleSchema>

/** The payload: a country's styles, one per language. */
export const citationStyleSchema = z
  .object({ styles: z.array(languageStyleSchema).min(1).max(10) })
  .strict()
  .refine((payload) => new Set(payload.styles.map((style) => style.language)).size === payload.styles.length, 'one style per language')
export type CitationStylePayload = z.infer<typeof citationStyleSchema>

/**
 * FALLBACK, delete after rollover: the style a line is written in while no
 * country's `citation_style` ruleset is released (rollover-to-prod.md). It is the
 * payload of the first country's record, the form every line had before.
 */
export const FALLBACK_CITATION_STYLES: CitationStylePayload = citationStyleSchema.parse({ styles: fallbackStyles.styles })
