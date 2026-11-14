/**
 * The citation style an office's lines are written in: the `citation_style`
 * ruleset released for its home country, in force today (country-as-data plan
 * row 6, `@/shared/citation-style`). Read for the browser
 * (`GET /api/citations/style`) and for the door's evidence.
 *
 * FALLBACK, delete after rollover: `null` while no style is released, and the
 * reader then writes the line in the fallback style (`citation-style.fallback.json`).
 */

import 'server-only'
import type { CitationStylePayload } from '@/lib/base-knowledge/wire/citation-style'
import { readRulesetsInForce } from '@/lib/base-knowledge/store/rulesets'
import { selectRecord } from '@/lib/base-knowledge/rulesets/select'
import { findOrganization } from '@/lib/organizations/repository'

export async function citationStylesFor(organizationId: string, now = new Date()): Promise<CitationStylePayload | null> {
  const country = (await findOrganization(organizationId))?.homeCountry
  if (!country) return null
  const read = await readRulesetsInForce(organizationId, { purpose: 'citation_style', territoryIds: [country] })
  const selection = selectRecord(read.rulesets, {
    purpose: 'citation_style',
    chain: [country],
    on: now.toISOString().slice(0, 10),
  })
  if (selection.status !== 'found') return null
  const { body } = selection.ruleset.values
  return body.kind === 'citation_style' ? body.payload : null
}
