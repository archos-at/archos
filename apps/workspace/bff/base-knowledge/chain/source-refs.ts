/**
 * A work's identifiers at its source as the turn carries them (ADR-0175):
 * one `{scheme, value}` per known scheme (`SOURCE_REF_SCHEMES`), sorted. The
 * work's `designation`, kept in the same JSON, and any scheme the agent does
 * not match are not refs. Pure.
 */

import { z } from 'zod'
import { SOURCE_REF_SCHEMES, type SourceRefScheme } from '../wire/vocab'

/** One identifier of a work at its source, by scheme (`SOURCE_REF_SCHEMES`): how a passage read live finds its work. */
export const sourceRefSchema = z.object({ scheme: z.enum(SOURCE_REF_SCHEMES), value: z.string().min(1).max(300) }).strict()
export type SourceRef = z.infer<typeof sourceRefSchema>

const SCHEMES: ReadonlySet<string> = new Set(SOURCE_REF_SCHEMES)

export function sourceRefsOf(identifiers: Readonly<Record<string, unknown>> | null | undefined): SourceRef[] {
  return Object.entries(identifiers ?? {})
    .filter((entry): entry is [SourceRefScheme, string] => SCHEMES.has(entry[0]) && typeof entry[1] === 'string' && entry[1] !== '')
    .map(([scheme, value]) => ({ scheme, value }))
    .sort((a, b) => a.scheme.localeCompare(b.scheme) || a.value.localeCompare(b.value))
}
