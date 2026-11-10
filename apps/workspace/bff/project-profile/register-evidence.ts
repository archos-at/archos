/**
 * `register` evidence says an official address register in the cell confirmed
 * an address (ADR-0172). Only site resolution writes it, after the register
 * did. A generic profile write (a patch, a replace) may keep it exactly where
 * and on the value it was written, or drop it, but never add it, move it to
 * another entry, or keep it under a changed value: otherwise anyone with
 * project:edit could label a typed Gemeinde as register-confirmed. Pure.
 */

import type { ProfileEvidence } from './evidence-schema'
import type { ProjectAssumption, ProjectFact, ProjectProfile } from './types'

type SiteEntries = Pick<ProjectProfile, 'facts' | 'assumptions'>

/**
 * Each register evidence entry with where it sits and the value it vouches for,
 * as one string. A tuple, not JSON.stringify: jsonb stores an object's keys in
 * its own order.
 */
function registerClaimsOf(profile: SiteEntries): string[] {
  const sections: [string, Record<string, ProjectFact | ProjectAssumption>][] = [
    ['facts', profile.facts ?? {}],
    ['assumptions', profile.assumptions ?? {}],
  ]
  return sections.flatMap(([section, entries]) =>
    Object.entries(entries).flatMap(([key, entry]) => {
      const evidence: ProfileEvidence[] = [
        ...(entry?.evidence ?? []),
        ...(entry?.alternatives ?? []).flatMap((alternative) => alternative.evidence),
      ]
      return evidence.flatMap((item) =>
        item.kind === 'register'
          ? [[section, key, JSON.stringify(entry?.value ?? null), item.addressId, item.label, item.referenceDate, item.resolvedAt].join('\u0000')]
          : []
      )
    })
  )
}

/** Whether `after` holds register evidence `before` did not hold at the same entry, on the same value. */
export function addsRegisterEvidence(before: SiteEntries, after: SiteEntries): boolean {
  const held = new Set(registerClaimsOf(before))
  return registerClaimsOf(after).some((claim) => !held.has(claim))
}

/** The refusal a generic write gets for it. */
export const REGISTER_EVIDENCE_REFUSAL =
  'Register evidence is written only by project-site-set, after the address register confirmed the address: ' +
  'it cannot be added, moved to another entry, or kept under a changed value.'
