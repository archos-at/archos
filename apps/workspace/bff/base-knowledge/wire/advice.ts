import { z } from 'zod'
import { ADVICE_MODES, ADVICE_TOPICS } from './vocab'

export const advicePolicySchema = z
  .object({
    topics: z
      .partialRecord(z.enum(ADVICE_TOPICS), z.enum(ADVICE_MODES))
      .refine((topics) => Object.keys(topics).length > 0, 'a policy states at least one topic')
      .describe(`Per topic, what an answer may do: ${ADVICE_MODES.join(', ')} (strictest last).`),
  })
  .strict()
export type AdvicePolicy = z.infer<typeof advicePolicySchema>

export const languageTagSchema = z
  .string()
  .regex(/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?$/, 'a BCP 47 tag such as de, de-CH or sr-Latn-RS')

const termText = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\p{Cc}\p{Cf}\u2028\u2029<>{}`]+$/u, 'one line of text without control characters, <, >, {, } or `')

export const terminologyEntrySchema = z
  .object({
    language: languageTagSchema,
    term: termText,
    gloss: termText,
  })
  .strict()

export const terminologySchema = z
  .object({ entries: z.array(terminologyEntrySchema).min(1).max(200) })
  .strict()
  .superRefine((payload, context) => {
    const seen = new Set<string>()
    payload.entries.forEach((entry, index) => {
      const key = `${entry.language}|${entry.term.toLocaleLowerCase('und')}`
      if (seen.has(key))
        context.addIssue({ code: 'custom', path: ['entries', index, 'term'], message: `${entry.term} (${entry.language}) repeats` })
      seen.add(key)
    })
  })
export type Terminology = z.infer<typeof terminologySchema>
