/**
 * What the office layer asks of the platform's own base knowledge (ADR-0163,
 * ADR-0165), behind one interface. The platform's records (migration 0205)
 * answer it, behind the `platform-base-knowledge` flag per organization: with
 * the flag off an office reads exactly what the stub answered, nothing.
 *
 * The outcome it serves: a norm the platform lists without text reads, for an
 * office that holds no copy, as "gelistet, kein Text"; for an office that holds
 * one, as its own copy (the office's entry, not this). A platform directive
 * reaches a project's turn only where its authority is competent.
 */

import type { PlatformDirectiveVerdict } from './platform/applicability'

/** An edition the platform lists: designation and label, and whether the platform holds its text. */
export interface ListedEdition {
  designation: string
  title: string
  editionLabel: string
  hasText: boolean
}

/** A platform authority directive that is not excluded for the project: it applies, or its authority is unknown. */
export interface PlatformDirective {
  title: string
  designation: string | null
  editionLabel: string | null
  authorities: string[]
  verdict: Exclude<PlatformDirectiveVerdict, { verdict: 'excluded' }>
}

export interface PlatformKnowledge {
  /** Editions the platform lists, for a country the office is entitled to, whose designation is none of `held`. */
  listedNotHeld(organizationId: string, held: readonly string[]): Promise<ListedEdition[]>
  /** Whether a platform revision was released to stable and the office may read it (design §4.4). */
  isReleased(organizationId: string, revisionId: string): Promise<boolean>
  /** The platform's directives for a project in `territoryId`, those whose authority is not competent there left out. */
  directivesFor(organizationId: string, territoryId: string | null): Promise<PlatformDirective[]>
}

/** The platform as it was before its records: lists nothing, releases nothing. A spec's baseline. */
export const STUB_PLATFORM_KNOWLEDGE: PlatformKnowledge = {
  listedNotHeld: async () => [],
  isReleased: async () => false,
  directivesFor: async () => [],
}

/**
 * The platform's records, loaded on first use: this module stays pure for the
 * pure modules that import its types, and the database is reached only by a
 * server call.
 */
const RECORDS: PlatformKnowledge = {
  listedNotHeld: async (organizationId, held) =>
    (await import('./platform/office-read')).PLATFORM_RECORDS_KNOWLEDGE.listedNotHeld(organizationId, held),
  isReleased: async (organizationId, revisionId) =>
    (await import('./platform/office-read')).PLATFORM_RECORDS_KNOWLEDGE.isReleased(organizationId, revisionId),
  directivesFor: async (organizationId, territoryId) =>
    (await import('./platform/office-read')).PLATFORM_RECORDS_KNOWLEDGE.directivesFor(organizationId, territoryId),
}

let current: PlatformKnowledge = RECORDS

/** The platform the office layer reads. */
export function platformKnowledge(): PlatformKnowledge {
  return current
}

/** Swap the platform: a fake in a spec. Returns the previous one. */
export function usePlatformKnowledge(next: PlatformKnowledge): PlatformKnowledge {
  const previous = current
  current = next
  return previous
}
