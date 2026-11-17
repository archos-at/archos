import type { ProfileEvidence } from './evidence-schema'
import type { ProjectAssumption, ProjectFact, ProjectProfile } from './types'

type SiteEntries = Pick<ProjectProfile, 'facts' | 'assumptions'>

function registerClaimsOf(profile: SiteEntries): string[] {
  const sections: [string, Record<string, ProjectFact | ProjectAssumption>][] = [
    ['facts', profile.facts ?? {}],
    ['assumptions', profile.assumptions ?? {}],
  ]
  const claim = (where: string, value: unknown, item: ProfileEvidence): string[] =>
    item.kind === 'register'
      ? [[where, JSON.stringify(value ?? null), item.addressId, item.label, item.referenceDate, item.resolvedAt].join('\u0000')]
      : []
  return sections.flatMap(([section, entries]) =>
    Object.entries(entries).flatMap(([key, entry]) => [
      ...(entry?.evidence ?? []).flatMap((item) => claim(`${section}/${key}`, entry?.value, item)),
      ...(entry?.alternatives ?? []).flatMap((alternative, index) =>
        alternative.evidence.flatMap((item) => claim(`${section}/${key}/alternatives/${index}`, alternative.value, item))
      ),
    ])
  )
}

export function addsRegisterEvidence(before: SiteEntries, after: SiteEntries): boolean {
  const held = new Set(registerClaimsOf(before))
  return registerClaimsOf(after).some((claim) => !held.has(claim))
}

export const REGISTER_EVIDENCE_REFUSAL =
  'Register evidence is written only by project-site-set, after the address register confirmed the address: ' +
  'it cannot be added, moved to another entry, or kept under a changed value.'
