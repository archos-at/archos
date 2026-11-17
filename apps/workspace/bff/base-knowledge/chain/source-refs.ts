/**
 * A work's identifiers at its source as the turn carries them (ADR-0175):
 * one `{scheme, value}` per scheme the work's record states, sorted. The
 * schemes are open words (`identifierSchemeSchema`): a source record declares
 * how its addresses state one, and a passage read there finds its work by
 * scheme and value. The work's `designation`, kept in the same JSON, is not a
 * ref. Pure.
 */

import { z } from 'zod'
import { DESIGNATION_KEY, identifierSchemeSchema } from '../wire/source'

export { DESIGNATION_KEY }

/** The most identifiers a work carries, so the most refs a use does. */
export const MAX_SOURCE_REFS = 8

/** One identifier of a work at its source, by the scheme its source record names: how a passage read live finds its work. */
export const sourceRefSchema = z.object({ scheme: identifierSchemeSchema, value: z.string().min(1).max(300) }).strict()
export type SourceRef = z.infer<typeof sourceRefSchema>

export function sourceRefsOf(identifiers: Readonly<Record<string, unknown>> | null | undefined): SourceRef[] {
  return Object.entries(identifiers ?? {})
    .filter(
      (entry): entry is [string, string] =>
        identifierSchemeSchema.safeParse(entry[0]).success && typeof entry[1] === 'string' && entry[1] !== '',
    )
    .map(([scheme, value]) => ({ scheme, value }))
    .sort((a, b) => a.scheme.localeCompare(b.scheme) || a.value.localeCompare(b.value))
}
