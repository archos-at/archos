import type { SiteAuthority } from '@/lib/site-resolution/wire'

export interface PlatformAddressee {
  name: string
  territoryId: string
  authorityId?: string
}

export type PlatformDirectiveVerdict =
  | { verdict: 'applies'; authority: string; territoryId: string }
  | { verdict: 'excluded' }
  | { verdict: 'authority_unknown' }

export function directiveVerdict(
  addressees: readonly PlatformAddressee[],
  site: SiteAuthority | null,
  territoryId: string | null,
): PlatformDirectiveVerdict {
  if (!territoryId || !site || site.status !== 'decided') return { verdict: 'authority_unknown' }
  const named = addressees.filter((addressee) => addressee.authorityId)
  if (named.length === 0) return { verdict: 'authority_unknown' }
  for (const addressee of named) {
    const body = site.bodies.find((candidate) => candidate.authorityId === addressee.authorityId)
    if (body) return { verdict: 'applies', authority: body.name ?? addressee.name, territoryId }
  }
  return { verdict: 'excluded' }
}

export const workKeyOf = (lowered: string) => lowered.replace(/\s+/g, ' ').trim().replace(/:\d{4}(-\d{2}(-\d{2})?)?$/, '')

export function designationKey(designation: string): string {
  return workKeyOf(designation.toLocaleLowerCase('de'))
}

export interface ListedEdition {
  designation: string
  title: string
  editionLabel: string
  hasText: boolean
}

export interface DirectoryEdition {
  label: string
  issuedOn: string | null
  inForceFrom: string | null
  inForceTo: string | null
}

export interface DirectoryWork {
  designation: string
  title: string
  editions: DirectoryEdition[]
}

export interface PlatformDirective {
  title: string
  designation: string | null
  editionLabel: string | null
  authorities: string[]
  verdict: Exclude<PlatformDirectiveVerdict, { verdict: 'excluded' }>
}

export interface PlatformKnowledge {
  listedNotHeld(organizationId: string, held: readonly string[]): Promise<ListedEdition[]>
  editionsOf(organizationId: string, designations: readonly string[]): Promise<DirectoryWork[]>
  isReleased(organizationId: string, revisionId: string): Promise<boolean>
  directivesFor(organizationId: string, territoryId: string | null): Promise<PlatformDirective[]>
}

export const STUB_PLATFORM_KNOWLEDGE: PlatformKnowledge = {
  listedNotHeld: async () => [],
  editionsOf: async () => [],
  isReleased: async () => false,
  directivesFor: async () => [],
}

const RECORDS: PlatformKnowledge = {
  listedNotHeld: async (organizationId, held) =>
    (await import('./platform/office-read')).PLATFORM_RECORDS_KNOWLEDGE.listedNotHeld(organizationId, held),
  editionsOf: async (organizationId, designations) =>
    (await import('./platform/office-read')).PLATFORM_RECORDS_KNOWLEDGE.editionsOf(organizationId, designations),
  isReleased: async (organizationId, revisionId) =>
    (await import('./platform/office-read')).PLATFORM_RECORDS_KNOWLEDGE.isReleased(organizationId, revisionId),
  directivesFor: async (organizationId, territoryId) =>
    (await import('./platform/office-read')).PLATFORM_RECORDS_KNOWLEDGE.directivesFor(organizationId, territoryId),
}

let current: PlatformKnowledge = RECORDS

export function platformKnowledge(): PlatformKnowledge {
  return current
}

export function usePlatformKnowledge(next: PlatformKnowledge): PlatformKnowledge {
  const previous = current
  current = next
  return previous
}
