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

export interface ListedEdition {
  designation: string
  title: string
  editionLabel: string
  hasText: boolean
}

export interface DirectoryEdition {
  designation: string
  editionLabel: string
  startsOn: string | null
  endsOn: string | null
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
  directoryEditions(organizationId: string, designations: readonly string[]): Promise<DirectoryEdition[]>
  isReleased(organizationId: string, revisionId: string): Promise<boolean>
  directivesFor(organizationId: string, territoryId: string | null): Promise<PlatformDirective[]>
}

export const STUB_PLATFORM_KNOWLEDGE: PlatformKnowledge = {
  listedNotHeld: async () => [],
  directoryEditions: async () => [],
  isReleased: async () => false,
  directivesFor: async () => [],
}

const RECORDS: PlatformKnowledge = {
  listedNotHeld: async (organizationId, held) =>
    (await import('./platform/office-read')).PLATFORM_RECORDS_KNOWLEDGE.listedNotHeld(organizationId, held),
  directoryEditions: async (organizationId, designations) =>
    (await import('./platform/office-read')).PLATFORM_RECORDS_KNOWLEDGE.directoryEditions(organizationId, designations),
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
