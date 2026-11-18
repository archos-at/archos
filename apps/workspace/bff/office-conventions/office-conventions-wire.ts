import { z } from 'zod'
import { PRODUCT_NAME } from '@/lib/brand'

const support = { projects: z.number().int().nonnegative(), of: z.number().int().nonnegative() }
const key = z.string().min(1).max(300)

export const conventionLineSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('filing'), key, docType: z.string(), path: z.string(), ...support }),
  z.object({ kind: z.literal('folder'), key, path: z.string(), ...support }),
  z.object({ kind: z.literal('document_number'), key, shape: z.string(), ...support }),
  z.object({
    kind: z.literal('revision_style'),
    key,
    style: z.enum(['letter', 'number', 'padded_number', 'letter_number']),
    ...support,
  }),
  z.object({ kind: z.literal('file_date'), key, format: z.string(), ...support }),
])
export type ConventionLine = z.infer<typeof conventionLineSchema>
export type ConventionLineKind = ConventionLine['kind']

export const CONVENTION_DECISIONS = ['confirmed', 'declined'] as const
export type ConventionDecision = (typeof CONVENTION_DECISIONS)[number]

export const decideConventionBodySchema = z.object({
  lineKey: key.describe('The key of a line, from office-conventions-list.'),
  decision: z
    .enum([...CONVENTION_DECISIONS, 'undecided'])
    .describe(
      '"confirmed" keeps the line for ' + PRODUCT_NAME + ' even when later counts fall below the threshold; "declined" means ' +
        PRODUCT_NAME + ' never uses it again; "undecided" takes an earlier decision back.'
    ),
})
export type DecideConventionBody = z.infer<typeof decideConventionBodySchema>

export interface ConventionLineView {
  line: ConventionLine
  decision: ConventionDecision | null
  counted: boolean
  decidedBy: string | null
  decidedAt: string | null
}

export interface OfficeConventionsView {
  enabled: boolean
  projects: number
  computedAt: string | null
  lines: ConventionLineView[]
}
