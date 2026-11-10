/**
 * `register` evidence says an official address register in the cell confirmed
 * an address (ADR-0172). Only site resolution writes it, after the register
 * did; a generic profile write (a patch, a replace) may keep what the profile
 * already holds but never add any, or anyone with project:edit could label a
 * typed Gemeinde as register-confirmed. Pure.
 */

import type { ProfileEvidence } from './evidence-schema'
import type { ProjectProfile } from './types'

function registerEvidenceOf(profile: Pick<ProjectProfile, 'facts' | 'assumptions'>): string[] {
  const entries = [...Object.values(profile.facts ?? {}), ...Object.values(profile.assumptions ?? {})]
  const evidence: ProfileEvidence[] = entries.flatMap((entry) => [
    ...(entry?.evidence ?? []),
    ...(entry?.alternatives ?? []).flatMap((alternative) => alternative.evidence ?? []),
  ])
  // A tuple, not JSON.stringify: jsonb stores an object's keys in its own order.
  return evidence.flatMap((item) =>
    item.kind === 'register' ? [[item.addressId, item.label, item.referenceDate, item.resolvedAt].join('\u0000')] : []
  )
}

/** Whether `after` holds a register evidence entry `before` does not. */
export function addsRegisterEvidence(
  before: Pick<ProjectProfile, 'facts' | 'assumptions'>,
  after: Pick<ProjectProfile, 'facts' | 'assumptions'>
): boolean {
  const held = new Set(registerEvidenceOf(before))
  return registerEvidenceOf(after).some((item) => !held.has(item))
}

/** The refusal a generic write gets for it. */
export const REGISTER_EVIDENCE_REFUSAL =
  'Register evidence is written only by project-site-set, after the address register confirmed the address.'
