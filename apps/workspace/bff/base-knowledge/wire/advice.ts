/**
 * The wire of the two prompt-facing ruleset types (design §3.7 and §9b(b),
 * ADR-0174): what a country says about legal advice, and the words it uses.
 *
 * - `advice_policy.v1`: per topic of legal advice, one of three codes
 *   (`assert`, `hedge`, `decline`). Codes only: the text an answer carries for
 *   a code is a fixed template in `rulesets/advice.ts`, so a policy proposed
 *   from a fetched page cannot put an instruction into every office's prompt.
 * - `terminology.v1`: term and gloss pairs keyed by a BCP 47 language tag,
 *   each at most 200 characters on one line. These are the only record text a
 *   prompt may read (design §3.7, "capped term pairs").
 *
 * Pure zod; the content of a country's policy is that country's onboarding.
 */

import { z } from 'zod'
import { ADVICE_MODES, ADVICE_TOPICS } from './vocab'

/** One topic's code. Unknown topics are refused: a code nothing renders would be a silent pass. */
export const advicePolicySchema = z
  .object({
    topics: z
      .partialRecord(z.enum(ADVICE_TOPICS), z.enum(ADVICE_MODES))
      .refine((topics) => Object.keys(topics).length > 0, 'a policy states at least one topic')
      .describe(`Per topic, what an answer may do: ${ADVICE_MODES.join(', ')} (strictest last).`),
  })
  .strict()
export type AdvicePolicy = z.infer<typeof advicePolicySchema>

/**
 * BCP 47 as products use it: a language, then an optional script and region
 * (`de`, `de-CH`, `sr-Latn-RS`). Extensions and private use are refused, since
 * nothing keys on them.
 */
export const languageTagSchema = z
  .string()
  .regex(/^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?$/, 'a BCP 47 tag such as de, de-CH or sr-Latn-RS')

/**
 * One line of at most 200 printable characters: no line break, no control
 * character, no markup bracket, so a pair cannot open a block of its own in a
 * prompt.
 */
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

/** At most 200 pairs per record; one term once per language. */
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
