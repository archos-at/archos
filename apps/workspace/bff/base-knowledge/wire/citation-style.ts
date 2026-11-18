import { z } from 'zod'

const segment = z.string().min(1).max(200)
const template = z.array(segment).min(1).max(12)
const name = z.string().trim().min(1).max(200)
const tokens = z.array(z.string().trim().min(1).max(64)).max(20).default([])

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
    edition: z
      .object({ word: name, label: template, months: z.record(z.string().min(1).max(20), z.number().int().min(1).max(12)) })
      .strict()
      .optional(),
    date: segment,
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

export const citationStyleSchema = z
  .object({ styles: z.array(languageStyleSchema).min(1).max(10) })
  .strict()
  .refine((payload) => new Set(payload.styles.map((style) => style.language)).size === payload.styles.length, 'one style per language')
export type CitationStylePayload = z.infer<typeof citationStyleSchema>
